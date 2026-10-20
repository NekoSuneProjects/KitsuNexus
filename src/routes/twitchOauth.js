'use strict'

const express = require('express')
const crypto = require('node:crypto')
const config = require('../config')
const { TwitchLink } = require('../db')
const twitchOAuth = require('../services/twitchOAuth')
const requireAuth = require('../middleware/requireAuth')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const { verifyUnlinkToken } = require('../auth/twitchCsrf')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()
const STATE_TTL = 5 * 60_000
const STATE_COOKIE = 'kitsunexus_twitch_oauth_state'
const configured = (req, res, next) => twitchOAuth.hasConfig() ? next() : res.status(503).send('Twitch OAuth is not configured on this server.')

// Signed, browser-bound state survives server restarts and load-balanced callbacks.
// Keeping the nonce in an HttpOnly cookie also binds the callback to the browser
// that initiated the flow, even if an attacker obtains a valid signed state.
function createState (userId, now = Date.now()) {
  const payload = `${now}.${crypto.randomBytes(24).toString('hex')}`
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${payload}`).digest('hex')
  return `${payload}.${signature}`
}

function verifyState (state, cookie, userId, now = Date.now()) {
  if (typeof state !== 'string' || typeof cookie !== 'string' || state !== cookie) return false
  const match = /^(\d{13})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(state)
  if (!match || now < Number(match[1]) || now - Number(match[1]) > STATE_TTL) return false
  const payload = `${match[1]}.${match[2]}`
  const expected = crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${payload}`).digest()
  return crypto.timingSafeEqual(expected, Buffer.from(match[3], 'hex'))
}

router.get('/oauth2/twitch/authorize-link', requireAuth, configured, (req, res) => {
  const state = createState(req.user.id)
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true, sameSite: 'lax', secure: config.siteUrl.startsWith('https://'),
    path: '/oauth2/twitch', maxAge: STATE_TTL,
  })
  const url = new URL('https://id.twitch.tv/oauth2/authorize')
  url.searchParams.set('client_id', config.twitchClientId)
  url.searchParams.set('redirect_uri', config.twitchRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.twitchScopes)
  url.searchParams.set('state', state)
  res.redirect(url.toString())
})

router.get('/oauth2/twitch/callback', requireAuth, configured, asyncHandler(async (req, res) => {
  const valid = verifyState(req.query.state, req.cookies?.[STATE_COOKIE], req.user.id)
  res.clearCookie(STATE_COOKIE, { path: '/oauth2/twitch' })
  if (!valid) {
    return res.status(400).send('Invalid or expired Twitch authorization. Please try again.')
  }
  if (req.query.error) return res.status(400).send('Twitch authorization was cancelled or denied.')
  if (typeof req.query.code !== 'string' || !req.query.code) return res.status(400).send('Missing Twitch authorization code.')
  try {
    const result = await twitchOAuth.linkCode(req.user.id, req.query.code)
    if (result.conflict) return res.status(409).send('This Twitch identity is already linked to another KitsuNexus account.')
    return res.redirect('/dashboard#twitch')
  } catch (err) {
    console.warn('[twitchOauth] authorization failed:', err.message)
    return res.status(502).send('Could not authorize Twitch. Please try again.')
  }
}))

router.post('/settings/twitch/unlink', requireAuth, asyncHandler(async (req, res) => {
  if (!verifyUnlinkToken(req)) return res.status(403).send('Invalid unlink request. Reload the dashboard and try again.')
  await twitchOAuth.unlink(req.user.id)
  res.redirect('/dashboard#twitch')
}))

router.get('/api/twitch/credentials', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  if (!twitchOAuth.hasConfig()) return res.status(503).json({ ok: false, error: 'Twitch OAuth is not configured on the server.' })
  try {
    return res.json(await twitchOAuth.credentials(req.userId))
  } catch (err) {
    console.warn('[twitchOauth] token refresh failed:', err.message)
    return res.status(502).json({ ok: false, error: 'Twitch token refresh failed. Please relink Twitch on the dashboard.' })
  }
}))

router.post('/api/twitch/unlink', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await twitchOAuth.unlink(req.userId))
}))

module.exports = router
module.exports.createState = createState
module.exports.verifyState = verifyState

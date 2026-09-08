const express = require('express')
const crypto = require('crypto')
const config = require('../config')
const { exchangeCodeForDiscordUser, exchangeActivityCode, issueBearerToken } = require('../discord/discordOAuth')
const authorizedGuilds = require('../discord/authorizedGuilds')
const { DiscordLink } = require('../db')
const session = require('../auth/session')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()

// View Channels + Connect + Mute Members + Deafen Members — same bitmask as
// the Electron app's per-user bring-your-own-bot invite link.
const BOT_PERMISSIONS = (1024 | 1048576 | 4194304 | 8388608).toString()

// Short-lived CSRF state cache for browser-redirect flows. Tracks WHICH flow
// issued each state so the callback below knows where to send the browser
// afterward: back to Electron's desktop-only loopback, or to /settings/discord.
// Not needed for the Activity SDK flow — that exchange never leaves Discord's
// own client-to-backend RPC, there's no browser navigation.
const STATE_TTL_MS = 5 * 60_000
const pendingStates = new Map()
function issueState (purpose) {
  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, { issuedAt: Date.now(), purpose })
  return state
}
function consumeState (state) {
  const entry = pendingStates.get(state)
  pendingStates.delete(state)
  if (!entry || (Date.now() - entry.issuedAt) > STATE_TTL_MS) return null
  return entry.purpose
}

function buildAuthorizeUrl ({ scope, state, permissions }) {
  const url = new URL('https://discord.com/api/oauth2/authorize')
  url.searchParams.set('client_id', config.discordClientId)
  url.searchParams.set('redirect_uri', config.discordRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  if (permissions) url.searchParams.set('permissions', permissions)
  url.searchParams.set('state', state)
  return url.toString()
}

function requireDiscordConfigured (req, res, next) {
  if (!config.discordClientId || !config.discordClientSecret || !config.discordRedirectUri) {
    return res.status(503).send('Discord integration is not configured on this server yet.')
  }
  next()
}
router.use(['/oauth2/discord', '/api/activity'], requireDiscordConfigured)

// Electron opens a BrowserWindow here for the plain "Log in with Discord"
// flow (Activity status push, official-bot read access to a guild the bot's
// already in). Does NOT offer to add the bot anywhere, and does NOT require
// a website account — this is the Electron app's own narrower identity check.
router.get('/oauth2/discord/authorize', (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify', state: issueState('electron') }))
})

// Website: "Link my Discord account" — identify only. Requires being logged in already
// (see /settings/discord) so the callback knows which account to attach it to.
router.get('/oauth2/discord/authorize-link', requireAuth, (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify', state: issueState('link') }))
})

// Website: "Add the official bot to your server" — combines identify with the bot
// scope in ONE consent screen, so Discord lets the user pick a guild to add the bot
// to as part of logging in. This is the ONLY path that can ever authorize a guild
// (see ../discord/authorizedGuilds.js) — a bot invite link copied from anywhere else
// still gets the bot kicked back out on join.
router.get('/oauth2/discord/authorize-bot', requireAuth, (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify bot', permissions: BOT_PERMISSIONS, state: issueState('link-bot') }))
})

// Discord redirects here after the user authorizes, from any of the flows above. We
// exchange the code ourselves (holds the client secret) and never hand Discord's own
// token to the browser/app. If a guild_id is present, the user just added the bot to
// that guild as part of this same consent screen — authorize it in the whitelist
// regardless of which flow triggered it.
router.get('/oauth2/discord/callback', asyncHandler(async (req, res) => {
  const { code, state, guild_id: guildId } = req.query
  const purpose = state && consumeState(state)
  if (!code || !purpose) {
    return res.status(400).send('Invalid or expired login attempt. Close this window and try again.')
  }
  let discordUser
  try {
    discordUser = await exchangeCodeForDiscordUser(code, config.discordRedirectUri)
  } catch (err) {
    console.warn('[discordOauth] callback failed:', err.message)
    return res.status(500).send('Login failed. Close this window and try again.')
  }

  if (purpose === 'electron') {
    const token = issueBearerToken(discordUser.id)
    return res.redirect(`${config.electronLoopbackRedirect}?token=${encodeURIComponent(token)}`)
  }

  // 'link' / 'link-bot' — website flows. The browser still carries our own session
  // cookie through this whole Discord round-trip (same origin), so we can tell who's
  // linking without Discord needing to know anything about KitsuNexus accounts.
  const cookieToken = req.cookies && req.cookies[session.COOKIE_NAME]
  const payload = cookieToken && session.verify(cookieToken)
  if (!payload) return res.redirect('/login')

  const existing = await DiscordLink.findOne({ where: { discordId: discordUser.id } })
  if (existing && existing.userId !== payload.sub) {
    return res.status(409).send('That Discord account is already linked to a different KitsuNexus account.')
  }
  await DiscordLink.upsert({
    userId: payload.sub,
    discordId: discordUser.id,
    discordUsername: discordUser.global_name || discordUser.username,
    discordAvatar: discordUser.avatar,
  })
  if (guildId) {
    authorizedGuilds.authorize(guildId, discordUser.id)
    console.log(`[discordOauth] guild ${guildId} authorized by Discord user ${discordUser.id}`)
  }
  res.redirect('/settings/discord')
}))

// Called directly by the Activity iframe's Embedded App SDK (commands.authorize
// hands the iframe a code via Discord's own client, no browser navigation).
router.post('/api/activity/token', express.json(), asyncHandler(async (req, res) => {
  const { code } = req.body || {}
  if (!code) return res.status(400).json({ error: 'Missing code' })
  try {
    const { discordUserId, discordAccessToken } = await exchangeActivityCode(code)
    const token = issueBearerToken(discordUserId)
    // access_token: for the iframe's own discordSdk.commands.authenticate() call.
    // token: our bearer token, for Bearer auth against this backend's own API.
    res.json({ access_token: discordAccessToken, token })
  } catch (err) {
    console.warn('[discordOauth] activity token exchange failed:', err.message)
    res.status(500).json({ error: 'Token exchange failed' })
  }
}))

module.exports = router

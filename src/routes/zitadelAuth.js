const express = require('express')
const config = require('../config')
const oidc = require('../auth/zitadelOidc')
const { resolveUser } = require('../auth/zitadelAccount')
const { Device, Favorite, STUB_USER_ID } = require('../db')
const session = require('../auth/session')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()

// Short-lived server-side state for the in-flight login (state -> {nonce, codeVerifier}).
// Same pattern as the Discord OAuth flow's pendingStates (routes/discordOauth.js).
const STATE_TTL_MS = 10 * 60_000
const pending = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.createdAt > STATE_TTL_MS) pending.delete(k)
}, 60_000).unref()

function requireZitadelConfigured (req, res, next) {
  if (!config.zitadelEnabled) return res.status(503).send('SSO login is not enabled on this server.')
  if (!config.zitadelEndpoint || !config.zitadelClientId) {
    return res.status(503).send('SSO login is enabled but not fully configured (missing ZITADEL_ENDPOINT/ZITADEL_CLIENT_ID).')
  }
  next()
}
router.use('/auth/zitadel', requireZitadelConfigured)

router.get('/auth/zitadel/login', asyncHandler(async (req, res) => {
  const state = oidc.randomState()
  const nonce = oidc.randomState()
  const codeVerifier = oidc.generateCodeVerifier()
  pending.set(state, { nonce, codeVerifier, createdAt: Date.now() })
  const url = await oidc.buildAuthorizeUrl({ state, nonce, codeChallenge: oidc.codeChallengeFromVerifier(codeVerifier) })
  res.redirect(url)
}))

router.get('/auth/zitadel/callback', asyncHandler(async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  if (error) return res.status(400).send(`SSO login failed: ${errorDescription || error}`)
  const entry = state && pending.get(String(state))
  if (!code || !entry) return res.status(400).send('Invalid or expired login attempt. Close this window and try again.')
  pending.delete(String(state))

  let payload
  try {
    const tokens = await oidc.exchangeCode({ code: String(code), codeVerifier: entry.codeVerifier })
    payload = await oidc.verifyIdToken(tokens.id_token, { nonce: entry.nonce })
  } catch (err) {
    console.warn('[zitadelAuth] login failed:', err.message)
    return res.status(500).send('SSO login failed. Close this window and try again.')
  }

  const user = await resolveUser(payload)
  if (user.role === 'owner') {
    // Mirrors /setup's stub hand-off — a no-op if nothing was ever attached to the stub.
    await Device.update({ userId: user.id }, { where: { userId: STUB_USER_ID } })
    await Favorite.update({ userId: user.id }, { where: { userId: STUB_USER_ID } })
  }
  session.setCookie(res, session.sign(user))
  res.redirect('/dashboard')
}))

module.exports = router

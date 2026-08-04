const express = require('express')
const crypto = require('crypto')
const { discordClientId, discordRedirectUri, electronLoopbackRedirect } = require('../config')
const { exchangeCodeForDiscordUser, exchangeActivityCode, issueSessionToken } = require('../auth')

const router = express.Router()

// Short-lived CSRF state cache for the browser-redirect flow (Electron login).
// Not needed for the Activity SDK flow — that exchange never leaves Discord's
// own client-to-backend RPC, there's no browser navigation to spoof.
const STATE_TTL_MS = 5 * 60_000
const pendingStates = new Map()
function issueState () {
  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, Date.now())
  return state
}
function consumeState (state) {
  const issuedAt = pendingStates.get(state)
  pendingStates.delete(state)
  return !!issuedAt && (Date.now() - issuedAt) < STATE_TTL_MS
}

// Electron opens a BrowserWindow here.
router.get('/oauth2/discord/authorize', (req, res) => {
  const state = issueState()
  const url = new URL('https://discord.com/api/oauth2/authorize')
  url.searchParams.set('client_id', discordClientId)
  url.searchParams.set('redirect_uri', discordRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify')
  url.searchParams.set('state', state)
  res.redirect(url.toString())
})

// Discord redirects here after the user authorizes. We exchange the code
// ourselves (holds the client secret) and hand Electron only our own session
// JWT, via its local loopback listener — never a Discord token.
router.get('/oauth2/discord/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state || !consumeState(state)) {
    return res.status(400).send('Invalid or expired login attempt. Close this window and try again.')
  }
  try {
    const discordUserId = await exchangeCodeForDiscordUser(code, discordRedirectUri)
    const token = issueSessionToken(discordUserId)
    res.redirect(`${electronLoopbackRedirect}?token=${encodeURIComponent(token)}`)
  } catch (err) {
    console.warn('[oauth] callback failed:', err.message)
    res.status(500).send('Login failed. Close this window and try again.')
  }
})

// Called directly by the Activity iframe's Embedded App SDK (commands.authorize
// hands the iframe a code via Discord's own client, no browser navigation).
router.post('/api/activity/token', express.json(), async (req, res) => {
  const { code } = req.body || {}
  if (!code) return res.status(400).json({ error: 'Missing code' })
  try {
    const { discordUserId, discordAccessToken } = await exchangeActivityCode(code)
    const token = issueSessionToken(discordUserId)
    // access_token: for the iframe's own discordSdk.commands.authenticate() call.
    // token: our session JWT, for Bearer auth against this backend's own API.
    res.json({ access_token: discordAccessToken, token })
  } catch (err) {
    console.warn('[oauth] activity token exchange failed:', err.message)
    res.status(500).json({ error: 'Token exchange failed' })
  }
})

module.exports = router

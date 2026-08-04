const express = require('express')
const crypto = require('crypto')
const { discordClientId, discordRedirectUri, electronLoopbackRedirect } = require('../config')
const { exchangeCodeForDiscordUser, exchangeActivityCode, issueSessionToken } = require('../auth')
const authorizedGuilds = require('../authorizedGuilds')

const router = express.Router()

// View Channels + Connect + Mute Members + Deafen Members — same bitmask as
// the Electron app's per-user bring-your-own-bot invite link
// (modules/integrations/discord/discordBot.js's INVITE_PERMS).
const BOT_PERMISSIONS = (1024 | 1048576 | 4194304 | 8388608).toString()

// Cookie session lifetime for the web dashboard — kept in sync by hand with
// issueSessionToken()'s JWT_TTL default (12h); if you change JWT_TTL, update
// this too, since a session JWT that outlives its cookie just forces a
// silent re-login, and a cookie that outlives the JWT gets rejected as expired.
const DASHBOARD_COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000

// Short-lived CSRF state cache for browser-redirect flows. Tracks WHICH flow
// issued each state so the callback below knows where to send the browser
// afterward: back to Electron's desktop-only loopback, or to the web
// dashboard. Not needed for the Activity SDK flow — that exchange never
// leaves Discord's own client-to-backend RPC, there's no browser navigation.
const STATE_TTL_MS = 5 * 60_000
const pendingStates = new Map()
function issueState (purpose) {
  const state = crypto.randomBytes(16).toString('hex')
  pendingStates.set(state, { issuedAt: Date.now(), purpose })
  return state
}
// Returns the purpose string on success, or null if the state is missing/expired.
function consumeState (state) {
  const entry = pendingStates.get(state)
  pendingStates.delete(state)
  if (!entry || (Date.now() - entry.issuedAt) > STATE_TTL_MS) return null
  return entry.purpose
}

function buildAuthorizeUrl ({ scope, state, permissions }) {
  const url = new URL('https://discord.com/api/oauth2/authorize')
  url.searchParams.set('client_id', discordClientId)
  url.searchParams.set('redirect_uri', discordRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  if (permissions) url.searchParams.set('permissions', permissions)
  url.searchParams.set('state', state)
  return url.toString()
}

// Electron opens a BrowserWindow here for the plain "Log in with Discord"
// flow (Activity status push, official-bot read access to a guild the bot's
// already in). Does NOT offer to add the bot anywhere.
router.get('/oauth2/discord/authorize', (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify', state: issueState('electron') }))
})

// Browser-based login for the web dashboard (see routes/dashboard.js) — lets
// someone check which servers they've authorized without also being
// prompted to add the bot somewhere new.
router.get('/oauth2/discord/authorize-dashboard', (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify', state: issueState('dashboard') }))
})

// "Add the official bot to your server" — combines identify with the bot
// scope in ONE consent screen, so Discord lets the user pick a guild to add
// the bot to as part of logging in. This is the ONLY path that can ever
// authorize a guild (see ../authorizedGuilds.js) — a bot invite link copied
// from anywhere else still gets the bot kicked back out on join. Always a
// browser/dashboard destination afterward — adding a bot to a server isn't
// something the Electron desktop app's loopback login is for.
router.get('/oauth2/discord/authorize-bot', (req, res) => {
  res.redirect(buildAuthorizeUrl({ scope: 'identify bot', permissions: BOT_PERMISSIONS, state: issueState('dashboard') }))
})

// Discord redirects here after the user authorizes, from any of the three
// flows above. We exchange the code ourselves (holds the client secret) and
// never hand Discord's own token to the browser/app — Electron gets our
// session JWT via its local loopback listener, the dashboard gets it as an
// httpOnly cookie. If a guild_id is present, the user just added the bot to
// that guild as part of this same consent screen — authorize it in the
// whitelist regardless of which flow triggered it.
router.get('/oauth2/discord/callback', async (req, res) => {
  const { code, state, guild_id: guildId } = req.query
  const purpose = state && consumeState(state)
  if (!code || !purpose) {
    return res.status(400).send('Invalid or expired login attempt. Close this window and try again.')
  }
  try {
    const discordUserId = await exchangeCodeForDiscordUser(code, discordRedirectUri)
    if (guildId) {
      authorizedGuilds.authorize(guildId, discordUserId)
      console.log(`[oauth] guild ${guildId} authorized by Discord user ${discordUserId}`)
    }
    const token = issueSessionToken(discordUserId)
    if (purpose === 'electron') {
      return res.redirect(`${electronLoopbackRedirect}?token=${encodeURIComponent(token)}`)
    }
    // Dashboard flow — keep the browser right here, no localhost involved.
    res.cookie('session', token, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      maxAge: DASHBOARD_COOKIE_MAX_AGE_MS
    })
    res.redirect('/dashboard')
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

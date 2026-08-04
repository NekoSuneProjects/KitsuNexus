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

// Electron opens a BrowserWindow here for the plain "Log in with Discord"
// flow (Activity status push, official-bot read access to a guild the bot's
// already in). Does NOT offer to add the bot anywhere — see
// /oauth2/discord/authorize-bot for that.
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

// "Add the official bot to your server" — combines identify with the bot
// scope in ONE consent screen, so Discord lets the user pick a guild to add
// the bot to as part of logging in. This is the ONLY path that can ever
// authorize a guild (see ../authorizedGuilds.js) — a bot invite link copied
// from anywhere else still gets the bot kicked back out on join. Deliberately
// not linked from the homepage; share this URL directly with whoever should
// be able to add the bot to their own server.
router.get('/oauth2/discord/authorize-bot', (req, res) => {
  const state = issueState()
  const url = new URL('https://discord.com/api/oauth2/authorize')
  url.searchParams.set('client_id', discordClientId)
  url.searchParams.set('redirect_uri', discordRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify bot')
  url.searchParams.set('permissions', BOT_PERMISSIONS)
  url.searchParams.set('state', state)
  res.redirect(url.toString())
})

// Discord redirects here after the user authorizes (from either flow above).
// We exchange the code ourselves (holds the client secret) and hand Electron
// only our own session JWT via its local loopback listener — never a Discord
// token. If a guild_id is present, the user just added the bot to that guild
// as part of this same consent screen — authorize it in the whitelist.
router.get('/oauth2/discord/callback', async (req, res) => {
  const { code, state, guild_id: guildId } = req.query
  if (!code || !state || !consumeState(state)) {
    return res.status(400).send('Invalid or expired login attempt. Close this window and try again.')
  }
  try {
    const discordUserId = await exchangeCodeForDiscordUser(code, discordRedirectUri)
    if (guildId) {
      authorizedGuilds.authorize(guildId, discordUserId)
      console.log(`[oauth] guild ${guildId} authorized by Discord user ${discordUserId}`)
    }
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

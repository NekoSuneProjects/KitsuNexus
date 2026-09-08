// Discord OAuth2 "identify" code exchange. This is the ONLY place the OAuth
// client secret is used — it must never reach the Electron app or the Activity
// iframe. Mints a short-lived bearer JWT afterward for the Electron/Activity API
// surface (routes/discordStatus.js) — a DIFFERENT, narrower thing from this website's own
// login session (src/auth/session.js): this token only ever proves "I am Discord user X",
// it is not a KitsuNexus account and can't reach /dashboard or /admin.
//
// Ported from NekoSuneAPPS/server/src/auth.js, extended to return the full Discord user
// object (not just the id) so a website account can link it as a named DiscordLink.

const jwt = require('jsonwebtoken')
const config = require('../config')

// redirectUri must exactly match whatever redirect_uri the authorize request used.
async function exchangeCodeForDiscordUser (code, redirectUri) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  })
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
  const { access_token: accessToken } = await tokenRes.json()

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!userRes.ok) throw new Error(`Discord user lookup failed: ${userRes.status} ${await userRes.text()}`)
  return userRes.json() // { id, username, global_name, avatar, ... }
}

// The Embedded App SDK's own authorize flow hands the iframe a `code` directly
// (via Discord client RPC, no HTTP redirect involved) — its documented token
// exchange omits redirect_uri entirely, unlike the standard web OAuth2 flow above.
//
// Returns BOTH the raw Discord access token (the iframe must pass this to its
// own `discordSdk.commands.authenticate()` — Discord's SDK validates that
// token against Discord's servers itself, our session JWT would not work there)
// and our own bearer JWT (what the iframe uses as Bearer auth against OUR API).
async function exchangeActivityCode (code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
      grant_type: 'authorization_code',
      code
    })
  })
  if (!tokenRes.ok) throw new Error(`Discord activity token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
  const { access_token: discordAccessToken } = await tokenRes.json()

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${discordAccessToken}` }
  })
  if (!userRes.ok) throw new Error(`Discord user lookup failed: ${userRes.status} ${await userRes.text()}`)
  const user = await userRes.json()
  return { discordUserId: user.id, discordAccessToken }
}

// Bearer JWT for the Electron app / Activity iframe's own API calls (routes/discordStatus.js) —
// reuses this server's jwtSecret (config.jwtSecret) purely to avoid a second secret to manage;
// it's safe to share because the two token kinds are read from different transports (this one
// only ever arrives as an Authorization header, never as the website's kn_session cookie) and
// carry different payload shapes, so one can't be replayed as the other.
function issueBearerToken (discordUserId) {
  return jwt.sign({ sub: discordUserId }, config.jwtSecret, { expiresIn: '12h' })
}

module.exports = { exchangeCodeForDiscordUser, exchangeActivityCode, issueBearerToken }

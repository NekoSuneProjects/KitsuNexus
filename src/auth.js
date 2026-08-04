// Discord OAuth2 "identify" code exchange. This is the ONLY place the OAuth
// client secret is used — it must never reach the Electron app or the Activity
// iframe. Mints this backend's own short-lived session JWT afterward; that JWT
// (not a Discord token) is what clients hold from here on.

const jwt = require('jsonwebtoken')
const { discordClientId, discordClientSecret, jwtSecret, jwtTtl } = require('./config')

// redirectUri must exactly match whatever redirect_uri the authorize request used.
async function exchangeCodeForDiscordUser (code, redirectUri) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: discordClientId,
      client_secret: discordClientSecret,
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
  const user = await userRes.json()
  return user.id
}

// The Embedded App SDK's own authorize flow hands the iframe a `code` directly
// (via Discord client RPC, no HTTP redirect involved) — its documented token
// exchange omits redirect_uri entirely, unlike the standard web OAuth2 flow above.
//
// Returns BOTH the raw Discord access token (the iframe must pass this to its
// own `discordSdk.commands.authenticate()` — Discord's SDK validates that
// token against Discord's servers itself, our session JWT would not work there)
// and our own session JWT (what the iframe uses as Bearer auth against OUR API).
async function exchangeActivityCode (code) {
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: discordClientId,
      client_secret: discordClientSecret,
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

function issueSessionToken (discordUserId) {
  return jwt.sign({ sub: discordUserId }, jwtSecret, { expiresIn: jwtTtl })
}

module.exports = { exchangeCodeForDiscordUser, exchangeActivityCode, issueSessionToken }

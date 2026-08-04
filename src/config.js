require('dotenv').config()

function required (name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`)
  return v
}

module.exports = {
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordClientSecret: required('DISCORD_CLIENT_SECRET'),
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordRedirectUri: required('DISCORD_REDIRECT_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtTtl: process.env.JWT_TTL || '12h',
  port: Number(process.env.PORT) || 8080,
  // Electron's local OAuth loopback — fixed, matches modules/oauth/providers/twitch.js's
  // established port convention in the NekoSuneAPPS desktop app.
  electronLoopbackRedirect: 'http://localhost:3737/oauth2/discord/callback'
}

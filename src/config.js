require('dotenv').config()
const crypto = require('crypto')

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET not set in .env — using a random one-off secret. ' +
    'Every restart will invalidate existing sessions. Set JWT_SECRET before deploying for real.')
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 8080,
  siteUrl: process.env.SITE_URL || 'http://localhost:8080',
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),

  // Discord bot integration — optional. Unlike the old standalone NekoSuneAPPS/server (which
  // required these to even boot), this server has other jobs (accounts, Favorites sync) that
  // must keep working with no Discord app configured at all — src/index.js only starts the bot
  // gateway when discordBotToken is set, and every Discord route degrades to a clear error
  // instead of crashing the process if these are blank.
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  discordBotToken: process.env.DISCORD_BOT_TOKEN || '',
  discordRedirectUri: process.env.DISCORD_REDIRECT_URI || '',
  discordInviteUrl: process.env.DISCORD_INVITE_URL || '',
  // Electron's local OAuth loopback — fixed, matches modules/oauth/providers/discordIdentity.js's
  // established port/path convention in the KitsuNexus desktop app.
  electronLoopbackRedirect: 'http://localhost:3737/oauth2/discord/callback',
}

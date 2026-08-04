// Whitelist of guilds the shared bot is allowed to be in. A guild only ever
// gets added here by /oauth2/discord/authorize-bot — the combined
// identify+bot OAuth flow where an authenticated Discord user explicitly
// picked that guild during Discord's own consent screen. Anyone who gets
// hold of a raw "add bot to server" link some other way still can't keep the
// bot around: discordBotGateway.js leaves any guild not in this list.
//
// Persisted to disk (not just in-memory) so a backend restart doesn't forget
// every guild that was ever legitimately authorized and kick them all out —
// see docker-compose.yml's volume mount for ./data.

const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(__dirname, '..', 'data')
const FILE = path.join(DATA_DIR, 'authorized-guilds.json')

function load () {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (_) { return {} }
}

let guilds = load()

function save () {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(guilds, null, 2))
}

function isAuthorized (guildId) {
  return Object.prototype.hasOwnProperty.call(guilds, guildId)
}

function authorize (guildId, discordUserId) {
  guilds[guildId] = { authorizedBy: discordUserId, at: new Date().toISOString() }
  save()
}

// Removes a guild from the whitelist. Callers are responsible for also
// making the bot actually leave (see discordBotGateway.js's leaveGuild) —
// this module only owns the persisted list, not the live gateway connection.
function revoke (guildId) {
  delete guilds[guildId]
  save()
}

function all () {
  return { ...guilds }
}

module.exports = { isAuthorized, authorize, revoke, all }

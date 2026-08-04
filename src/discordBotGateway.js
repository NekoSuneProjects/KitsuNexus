// Persistent gateway connection for the shared/official NekoSuneAPPS Discord bot.
// Server-side twin of modules/integrations/discord/discordBot.js in the Electron
// app, generalized from "watch one user" to "answer lookups for any user/channel"
// since this backend serves every installed copy of the app.
//
// Deliberately does NOT hand-roll a channel/voice-state cache: discord.js already
// maintains guild.voiceStates.cache (and VoiceChannel#members derived from it) live
// from gateway events, so lookups just read straight from discord.js's own cache.

const { Client, GatewayIntentBits, Events } = require('discord.js')
const { discordBotToken } = require('./config')
const authorizedGuilds = require('./authorizedGuilds')

let client = null
let ready = false

// Only /oauth2/discord/authorize-bot is allowed to let a guild keep the bot —
// leave anything else immediately, whether it's a guild added before this
// whitelist existed or one added via a leaked raw invite link.
async function enforceWhitelist (guild) {
  if (authorizedGuilds.isAuthorized(guild.id)) return
  console.warn(`[discordBotGateway] leaving unauthorized guild "${guild.name}" (${guild.id}) — never went through /oauth2/discord/authorize-bot`)
  try { await guild.leave() } catch (err) { console.warn('[discordBotGateway] failed to leave guild:', err.message) }
}

async function start () {
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    presence: { status: 'invisible', activities: [] }
  })
  client.once(Events.ClientReady, () => {
    ready = true
    console.log(`[discordBotGateway] logged in as ${client.user.tag}`)
    // Retroactive sweep, e.g. after this whitelist was added to an
    // already-running bot, or if the authorized-guilds data volume was lost.
    for (const guild of client.guilds.cache.values()) enforceWhitelist(guild)
  })
  // Fires the moment the bot is added to any guild, authorized or not.
  client.on(Events.GuildCreate, guild => enforceWhitelist(guild))
  client.on(Events.Error, err => console.warn('[discordBotGateway] error:', err.message))
  await client.login(discordBotToken)
  return client
}

function isReady () { return ready }

// Mirrors discordBot.js's readVoiceState(), generalized to any userId. First
// guild match wins — same accepted ambiguity as the existing per-user bot.
function getUserVoiceState (userId) {
  const state = {
    inVoice: false, channelName: '', userCount: 0,
    selfMute: false, selfDeaf: false, guildId: ''
  }
  if (!client) return state
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(userId)
    const vs = member && member.voice
    if (vs && vs.channelId && vs.channel) {
      state.inVoice = true
      state.channelName = vs.channel.name
      state.userCount = vs.channel.members ? vs.channel.members.size : 0
      state.selfMute = !!(vs.selfMute || vs.serverMute)
      state.selfDeaf = !!(vs.selfDeaf || vs.serverDeaf)
      state.guildId = guild.id
      return state
    }
  }
  return state
}

// Used by the Activity iframe: who's in this voice channel right now.
function getChannelRoster (channelId) {
  if (!client) return null
  const channel = client.channels.cache.get(channelId)
  if (!channel || !channel.isVoiceBased?.()) return null
  return {
    guildId: channel.guildId,
    channelName: channel.name,
    userCount: channel.members.size,
    memberIds: [...channel.members.keys()]
  }
}

async function setMute (guildId, userId, mute) {
  const guild = client && client.guilds.cache.get(guildId)
  const member = guild && guild.members.cache.get(userId)
  if (!member) return { ok: false, error: 'Member not found' }
  try {
    await member.voice.setMute(!!mute, 'NekoSuneAPPS official bot')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

async function setDeaf (guildId, userId, deaf) {
  const guild = client && client.guilds.cache.get(guildId)
  const member = guild && guild.members.cache.get(userId)
  if (!member) return { ok: false, error: 'Member not found' }
  try {
    await member.voice.setDeaf(!!deaf, 'NekoSuneAPPS official bot')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

module.exports = { start, isReady, getUserVoiceState, getChannelRoster, setMute, setDeaf }

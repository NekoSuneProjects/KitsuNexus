// modules/integrations/discord/discordBot.js
// A Discord BOT (gateway) used to read your voice state and server-mute/deafen you
// over OSC — the supported alternative to the allowlist-only rpc.voice.read scope.
//
// You create your own bot in the Developer Portal, paste its TOKEN, and invite it
// to YOUR OWN PRIVATE SERVER (it only ever needs to be there). The bot stays
// invisible (appears offline). It watches one user (your Discord user ID) and:
//   - emits voice state (channel name, user count, self mute/deafen, in-call)
//   - can server-mute / server-deafen you on command (DiscordOSC)
//   - reports "call started / ended" from voice-channel join/leave
// Runs in the MAIN process. Requires the `discord.js` dependency.

let Client, GatewayIntentBits, Events
try {
  ({ Client, GatewayIntentBits, Events } = require('discord.js'))
} catch (err) {
  console.warn('discord.js not installed yet:', err.message)
}

let client = null
let onUpdate = null
let token = ''
let targetUserId = ''
let appId = ''
let lastInVoice = false

// Permissions for the invite link: View Channels + Connect + Mute + Deafen Members.
const INVITE_PERMS = (1024 | 1048576 | 4194304 | 8388608).toString()

const state = {
  connected: false,
  inVoice: false,
  channelName: '',
  userCount: 0,
  selfMute: false,
  selfDeaf: false,
  guildId: '',
  callEvent: '', // 'started' | 'ended' | ''
  error: ''
}

function emit () { if (typeof onUpdate === 'function') onUpdate({ ...state, at: Date.now() }) }

// Resolve the voice state of the watched user across the bot's guilds.
function readVoiceState () {
  state.inVoice = false; state.channelName = ''; state.userCount = 0
  state.selfMute = false; state.selfDeaf = false; state.guildId = ''
  if (!client) return
  for (const guild of client.guilds.cache.values()) {
    const member = guild.members.cache.get(targetUserId)
    const vs = member && member.voice
    if (vs && vs.channelId && vs.channel) {
      state.inVoice = true
      state.channelName = vs.channel.name
      state.userCount = vs.channel.members ? vs.channel.members.size : 0
      state.selfMute = !!(vs.selfMute || vs.serverMute)
      state.selfDeaf = !!(vs.selfDeaf || vs.serverDeaf)
      state.guildId = guild.id
      return
    }
  }
}

function refresh () {
  readVoiceState()
  if (state.inVoice && !lastInVoice) state.callEvent = 'started'
  else if (!state.inVoice && lastInVoice) state.callEvent = 'ended'
  else state.callEvent = ''
  lastInVoice = state.inVoice
  emit()
}

async function startBot (cfg = {}, listener) {
  onUpdate = listener
  token = String(cfg.token || '').trim()
  targetUserId = String(cfg.userId || '').trim()
  if (!Client) { state.error = 'discord.js not installed (run npm install)'; emit(); return { ok: false, error: state.error } }
  if (!token) { state.error = 'No bot token set'; emit(); return { ok: false, error: state.error } }
  if (!targetUserId) { state.error = 'No Discord user ID set'; emit(); return { ok: false, error: state.error } }

  await stopBot()

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
    // Appear offline to everyone.
    presence: { status: 'invisible', activities: [] }
  })

  client.once(Events.ClientReady, c => {
    appId = c.user.id
    state.connected = true
    state.error = ''
    // Make sure we appear offline even after ready.
    try { c.user.setPresence({ status: 'invisible', activities: [] }) } catch (_) {}
    refresh()
  })

  client.on(Events.VoiceStateUpdate, (oldS, newS) => {
    if (oldS.id === targetUserId || newS.id === targetUserId) refresh()
  })

  client.on(Events.Error, err => { state.error = err.message; emit() })

  try {
    await client.login(token)
    return { ok: true }
  } catch (err) {
    state.connected = false
    state.error = err.message
    emit()
    return { ok: false, error: err.message }
  }
}

async function stopBot () {
  state.connected = false; state.inVoice = false; lastInVoice = false
  if (client) {
    try { await client.destroy() } catch (_) {}
    client = null
  }
  emit()
}

// DiscordOSC: server mute / deafen the watched user in their current voice guild.
async function setMute (mute) {
  if (!client || !state.guildId) return { ok: false, error: 'Not in a voice channel' }
  try {
    const guild = client.guilds.cache.get(state.guildId)
    const member = guild && guild.members.cache.get(targetUserId)
    if (!member) return { ok: false, error: 'Member not found' }
    await member.voice.setMute(!!mute, 'NekoSuneAPPS DiscordOSC')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}
async function setDeaf (deaf) {
  if (!client || !state.guildId) return { ok: false, error: 'Not in a voice channel' }
  try {
    const guild = client.guilds.cache.get(state.guildId)
    const member = guild && guild.members.cache.get(targetUserId)
    if (!member) return { ok: false, error: 'Member not found' }
    await member.voice.setDeaf(!!deaf, 'NekoSuneAPPS DiscordOSC')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
}

// Invite link for the user's own private server (needs the bot's application id,
// known after login, or supplied directly).
function inviteUrl (applicationId) {
  const id = applicationId || appId
  if (!id) return ''
  return `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=${INVITE_PERMS}`
}

function getBotState () { return { ...state } }

// ---------------------------------------------------------------------------
// Official NekoSuneAPPS bot mode: no token, no per-user bot to create. Instead
// of running our own discord.js gateway Client, poll the NekoSuneAPPS backend
// (server/, deployed separately — holds the shared bot's token, never this
// app) for the logged-in user's own voice state. Produces the identical
// `state` shape as startBot()/stopBot() above, so renderer.js's `bot:update`
// listener and everything downstream (OSC push, chatbox tokens) needs no
// changes to support this mode.
// ---------------------------------------------------------------------------

let officialTimer = null
let officialOnUpdate = null
const officialState = {
  connected: false, inVoice: false, channelName: '', userCount: 0,
  selfMute: false, selfDeaf: false, guildId: '', callEvent: '', error: ''
}
let officialLastInVoice = false

function emitOfficial () { if (typeof officialOnUpdate === 'function') officialOnUpdate({ ...officialState, at: Date.now() }) }

// The session JWT's payload is signed but not encrypted — decoding it client-side
// (no signature check) just reads the non-sensitive `sub` (Discord user ID) claim
// so we know which path to poll. The backend still verifies the signature on
// every request; nothing here is trusted without that.
function decodeSessionUserId (sessionToken) {
  try {
    const payload = JSON.parse(Buffer.from(sessionToken.split('.')[1], 'base64url').toString('utf8'))
    return payload.sub || ''
  } catch (_) { return '' }
}

async function pollOfficial (backendBaseUrl, sessionToken, discordUserId) {
  try {
    const res = await fetch(`${backendBaseUrl}/api/bot/voice/${discordUserId}`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    })
    if (!res.ok) throw new Error(`Backend returned ${res.status}`)
    const data = await res.json()
    Object.assign(officialState, data)
    officialState.connected = true
    officialState.error = ''
    if (officialState.inVoice && !officialLastInVoice) officialState.callEvent = 'started'
    else if (!officialState.inVoice && officialLastInVoice) officialState.callEvent = 'ended'
    else officialState.callEvent = ''
    officialLastInVoice = officialState.inVoice
  } catch (err) {
    officialState.connected = false
    officialState.error = err.message
  }
  emitOfficial()
}

async function startOfficialBot ({ backendBaseUrl, sessionToken } = {}, listener) {
  officialOnUpdate = listener
  const discordUserId = decodeSessionUserId(String(sessionToken || ''))
  if (!backendBaseUrl || !sessionToken || !discordUserId) {
    officialState.error = 'Log in with Discord first'
    emitOfficial()
    return { ok: false, error: officialState.error }
  }
  await stopOfficialBot()
  await pollOfficial(backendBaseUrl, sessionToken, discordUserId)
  officialTimer = setInterval(() => pollOfficial(backendBaseUrl, sessionToken, discordUserId), 5000)
  return { ok: true }
}

async function stopOfficialBot () {
  if (officialTimer) { clearInterval(officialTimer); officialTimer = null }
  officialState.connected = false; officialState.inVoice = false; officialLastInVoice = false
  emitOfficial()
}

async function setMuteOfficial (backendBaseUrl, sessionToken, mute) {
  const discordUserId = decodeSessionUserId(String(sessionToken || ''))
  if (!discordUserId) return { ok: false, error: 'Log in with Discord first' }
  try {
    const res = await fetch(`${backendBaseUrl}/api/bot/voice/${discordUserId}/mute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mute: !!mute })
    })
    return await res.json()
  } catch (err) { return { ok: false, error: err.message } }
}

async function setDeafOfficial (backendBaseUrl, sessionToken, deaf) {
  const discordUserId = decodeSessionUserId(String(sessionToken || ''))
  if (!discordUserId) return { ok: false, error: 'Log in with Discord first' }
  try {
    const res = await fetch(`${backendBaseUrl}/api/bot/voice/${discordUserId}/deaf`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deaf: !!deaf })
    })
    return await res.json()
  } catch (err) { return { ok: false, error: err.message } }
}

module.exports = {
  startBot, stopBot, setMute, setDeaf, inviteUrl, getBotState,
  startOfficialBot, stopOfficialBot, setMuteOfficial, setDeafOfficial
}

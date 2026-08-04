// modules/integrations/discord/discord.js
// Discord integration with two halves:
//   1. Rich Presence  - shows your VRChat status on your Discord profile.
//   2. Voice detection - reads your current voice channel (name, user count),
//      who is speaking, and your own mute/deafen state, then exposes it to the
//      chatbox and sends it to VRChat as avatar OSC parameters.
//
// Voice needs Discord's private "rpc"/"rpc.voice.read" scope, which Discord only
// grants to approved apps. If it's rejected we fall back to basic auth (Rich
// Presence only) instead of failing. Runs in the MAIN process.
//
// Create an app at https://discord.com/developers/applications, copy the
// Application (Client) ID (and a Client Secret if you want voice detection).

const dgram = require('dgram')

let RPC
try { RPC = require('discord-rpc') } catch (err) { console.warn('discord-rpc not installed yet:', err.message) }

/* ---- minimal OSC encoder (avatar params to VRChat) ---- */
const oscSocket = dgram.createSocket('udp4')
function encodeOscString (v) {
  const data = Buffer.from(`${v}\0`, 'utf8')
  const pad = (4 - (data.length % 4)) % 4
  return Buffer.concat([data, Buffer.alloc(pad)])
}
function oscBool (address, value) {
  return Buffer.concat([encodeOscString(address), encodeOscString(value ? ',T' : ',F')])
}
function oscInt (address, value) {
  const buf = Buffer.alloc(4); buf.writeInt32BE(value | 0, 0)
  return Buffer.concat([encodeOscString(address), encodeOscString(',i'), buf])
}

const PARAM = {
  speaking: '/avatar/parameters/VRCOSC/Discord/Speaking',
  muted: '/avatar/parameters/VRCOSC/Discord/Muted',
  deafened: '/avatar/parameters/VRCOSC/Discord/Deafened',
  inVoice: '/avatar/parameters/VRCOSC/Discord/InVoice',
  userCount: '/avatar/parameters/VRCOSC/Discord/UserCount'
}

let client = null
let onUpdate = null
let currentChannelId = null
let selfId = null
// Presence richness ladder — we keep buttons working even if art assets fail.
//   0 = art assets + buttons   1 = buttons only   2 = art only   3 = text only
// Buttons DO work over the local IPC RPC (no Game SDK needed); you just can't
// see your OWN buttons — only other people viewing your profile do. So if a push
// errors we step DOWN one rung (buttons survive at rung 1) instead of nuking
// everything to text. We remember the first rung that succeeds for the session.
let rpLevel = 0
let rpLogged = false // log the first successful presence push once

const config = {
  clientId: '', // set by the user in the Discord card (no ID is shipped)
  clientSecret: '',
  accessToken: '', // persisted so we don't re-authorize every launch
  oscIp: '127.0.0.1',
  oscPort: 9000,
  extraOscTargets: [],
  enableRichPresence: true,
  rpDetails: 'In VRChat',
  rpState: 'via NekoSuneAPPS',
  enableVoice: false,
  sendVoiceStateOsc: true,
  sendMuteDeafenOsc: true,
  // VRChat world / status enrichment of the presence:
  vrcStatus: 'active', // join | active | ask | busy  (green | blue | orange | red)
  showWorld: true, // master toggle for the world + join button
  vrcProfileUrl: '', // manual override; auto-filled from the VRChat log if blank
  showHeartRate: true, // append ❤️ bpm to the presence
  showNowPlaying: true // show 🎵 song when no world line is available
}

// Live context fed in via setVrcContext(): world (from the VRChat log tracker),
// plus heart rate and now-playing (from main.js).
const vrc = { worldName: '', joinUrl: '', worldUrl: '', profileUrl: '', hrBpm: 0, nowPlaying: '' }

// Privacy gate: only green (Join Me) and blue (Active) reveal where you are.
// Orange (Ask Me) and red (Do Not Disturb) hide the world + join button.
const STATUS = {
  join: { label: 'Join Me', emoji: '🔵', showWorld: true }, // VRChat: Join Me = blue
  active: { label: 'Active', emoji: '🟢', showWorld: true }, // Active = green
  ask: { label: 'Ask Me', emoji: '🟠', showWorld: false },
  busy: { label: 'Do Not Disturb', emoji: '🔴', showWorld: false }
}
function statusInfo () { return STATUS[config.vrcStatus] || STATUS.active }
function worldVisible () { return config.showWorld && statusInfo().showWorld }
function effectiveProfileUrl () { return (config.vrcProfileUrl || '').trim() || vrc.profileUrl || '' }

const state = {
  connected: false,
  voiceAuthorized: false,
  inVoice: false,
  channelName: '',
  userCount: 0,
  selfMute: false,
  selfDeaf: false,
  speaking: false,
  accessToken: '', // emitted so the renderer can persist it (avoids re-auth)
  error: ''
}

let startTimestamp = null

function emit () {
  if (typeof onUpdate === 'function') onUpdate({ ...state, at: Date.now() })
}

function sendOsc (buffer) {
  const targets = [{ host: config.oscIp, port: config.oscPort }, ...(Array.isArray(config.extraOscTargets) ? config.extraOscTargets : [])]
  targets.forEach(target => {
    oscSocket.send(buffer, target.port, target.host || config.oscIp, err => { if (err) console.warn('Discord OSC error:', err.message) })
  })
}

function pushVoiceOsc () {
  if (config.sendMuteDeafenOsc) {
    sendOsc(oscBool(PARAM.muted, state.selfMute))
    sendOsc(oscBool(PARAM.deafened, state.selfDeaf))
  }
  if (config.sendVoiceStateOsc) {
    sendOsc(oscBool(PARAM.inVoice, state.inVoice))
    sendOsc(oscBool(PARAM.speaking, state.speaking))
    sendOsc(oscInt(PARAM.userCount, state.userCount))
  }
}

// Throttle presence updates — Discord RP limits to ~5 updates / 20s. HR/world/song
// changes can fire many times a second, so coalesce them to one push every ~5s.
let _actTimer = null
let _actLast = 0
function setActivity (opts) {
  const wait = 5000 - (Date.now() - _actLast)
  if (wait <= 0) { _actLast = Date.now(); _pushActivity(opts) } else if (!_actTimer) { _actTimer = setTimeout(() => { _actTimer = null; _actLast = Date.now(); _pushActivity() }, wait) }
}

function _pushActivity ({ details, state: st } = {}) {
  if (!client || !state.connected || !config.enableRichPresence) return

  const info = statusInfo()
  const showWorld = worldVisible() && !!vrc.worldName

  // details = status line (+ optional heart rate).
  let detailsLine = details || `${info.emoji} ${info.label}`
  if (!details && config.showHeartRate && vrc.hrBpm > 0) detailsLine += ` · ❤️ ${vrc.hrBpm}`

  // state = where you are. Priority: VRChat world (if status allows) > now playing
  // > the generic fallback. This is what makes the presence "switch" by context.
  let stateLine = st
  if (!stateLine) {
    if (showWorld) stateLine = `In ${vrc.worldName}`
    else if (config.showNowPlaying && vrc.nowPlaying) stateLine = `🎵 ${vrc.nowPlaying}`
    else stateLine = config.rpState || 'In VRChat'
  }

  // Up to 2 buttons. "Join World" only when status reveals the world; profile
  // is always shown if we know your user id. (Discord: 1–2 buttons, label ≤32.)
  const buttons = []
  if (showWorld && vrc.joinUrl) buttons.push({ label: '🌐 Join World', url: vrc.joinUrl })
  const profileUrl = effectiveProfileUrl()
  if (profileUrl) buttons.push({ label: '👤 VRChat Profile', url: profileUrl })

  // Minimal, always-valid presence (text only) + the optional extras.
  const minimal = { details: detailsLine.slice(0, 128), state: stateLine.slice(0, 128), startTimestamp, instance: false }
  const art = { largeImageKey: 'logo', largeImageText: 'NekoSuneAPPS', smallImageKey: 'vrchat', smallImageText: 'VRChat' }

  // Compose the presence for a given rung of the ladder.
  const build = level => {
    const a = Object.assign({}, minimal)
    if (level === 0 || level === 2) Object.assign(a, art) // art on rungs 0 & 2
    if ((level === 0 || level === 1) && buttons.length) a.buttons = buttons.slice(0, 2) // buttons on rungs 0 & 1
    return a
  }

  // Try a rung; on failure step DOWN (richer→leaner) until text-only works.
  const attempt = level => {
    const activity = build(level)
    client.setActivity(activity)
      .then(() => {
        rpLevel = level
        if (!rpLogged) {
          rpLogged = true
          const what = level === 0 ? 'art + buttons' : level === 1 ? 'buttons only (no art assets)' : level === 2 ? 'art only' : 'text only'
          console.log(`[discord] Rich Presence active (${what}):`, activity.details, '·', activity.state)
        }
      })
      .catch(err => {
        if (level < 3) attempt(level + 1)
        else console.warn('Discord setActivity:', err.message)
      })
  }
  attempt(rpLevel) // start from the last rung that worked this session
}

// Called by main when the VRChat world tracker (or the UI status dropdown)
// updates. Stores the latest world/profile context and refreshes the presence.
function setVrcContext (ctx = {}) {
  if (typeof ctx.worldName === 'string') vrc.worldName = ctx.worldName
  if (typeof ctx.joinUrl === 'string') vrc.joinUrl = ctx.joinUrl
  if (typeof ctx.worldUrl === 'string') vrc.worldUrl = ctx.worldUrl
  if (typeof ctx.profileUrl === 'string') vrc.profileUrl = ctx.profileUrl
  if (typeof ctx.vrcStatus === 'string') config.vrcStatus = ctx.vrcStatus
  if (typeof ctx.showWorld === 'boolean') config.showWorld = ctx.showWorld
  if (typeof ctx.vrcProfileUrl === 'string') config.vrcProfileUrl = ctx.vrcProfileUrl
  if (typeof ctx.showHeartRate === 'boolean') config.showHeartRate = ctx.showHeartRate
  if (typeof ctx.showNowPlaying === 'boolean') config.showNowPlaying = ctx.showNowPlaying
  if (typeof ctx.hrBpm === 'number') vrc.hrBpm = ctx.hrBpm
  if (typeof ctx.nowPlaying === 'string') vrc.nowPlaying = ctx.nowPlaying
  setActivity()
}

async function refreshChannel (channelId) {
  currentChannelId = channelId
  if (!channelId) {
    state.inVoice = false; state.channelName = ''; state.userCount = 0
    emit(); pushVoiceOsc(); return
  }
  try {
    const ch = await client.getChannel(channelId)
    state.inVoice = true
    state.channelName = ch?.name || 'Voice'
    state.userCount = Array.isArray(ch?.voice_states) ? ch.voice_states.length : 0
    // (re)subscribe to per-channel voice events
    const args = { channel_id: channelId }
    client.subscribe('VOICE_STATE_CREATE', args).catch(() => {})
    client.subscribe('VOICE_STATE_DELETE', args).catch(() => {})
    client.subscribe('VOICE_STATE_UPDATE', args).catch(() => {})
    client.subscribe('SPEAKING_START', args).catch(() => {})
    client.subscribe('SPEAKING_STOP', args).catch(() => {})
  } catch (err) {
    console.warn('Discord getChannel:', err.message)
  }
  emit(); pushVoiceOsc()
}

async function wireVoice () {
  try {
    // self mute/deafen
    const vs = await client.getVoiceSettings().catch(() => null)
    if (vs) { state.selfMute = !!vs.mute; state.selfDeaf = !!vs.deaf }

    client.subscribe('VOICE_SETTINGS_UPDATE').catch(() => {})
    client.subscribe('VOICE_CHANNEL_SELECT').catch(() => {})

    client.on('VOICE_SETTINGS_UPDATE', d => {
      state.selfMute = !!d.mute; state.selfDeaf = !!d.deaf
      emit(); pushVoiceOsc()
    })
    client.on('VOICE_CHANNEL_SELECT', d => refreshChannel(d?.channel_id || null))
    client.on('VOICE_STATE_CREATE', () => refreshChannel(currentChannelId))
    client.on('VOICE_STATE_DELETE', () => refreshChannel(currentChannelId))
    // SPEAKING_* fire for everyone in the channel; only track our own voice.
    client.on('SPEAKING_START', d => { if (!selfId || d?.user_id === selfId) { state.speaking = true; emit(); pushVoiceOsc() } })
    client.on('SPEAKING_STOP', d => { if (!selfId || d?.user_id === selfId) { state.speaking = false; emit(); pushVoiceOsc() } })

    // jump straight into the channel we're already in, if any
    const sel = await client.getSelectedVoiceChannel().catch(() => null)
    if (sel?.id) await refreshChannel(sel.id)

    state.voiceAuthorized = true
    emit()
  } catch (err) {
    state.voiceAuthorized = false
    console.warn('Discord voice wiring failed:', err.message)
  }
}

async function startDiscord (opts = {}, listener) {
  Object.assign(config, opts)
  onUpdate = listener
  if (!RPC) { state.error = 'discord-rpc not installed (run npm install)'; emit(); return { ok: false, error: state.error } }
  if (!config.clientId) { state.error = 'No Discord Application ID set'; emit(); return { ok: false, error: state.error } }

  await stopDiscord()
  startTimestamp = null // set after ready (Date.now not allowed at module top)
  rpLevel = 0; rpLogged = false // retry the full art+buttons ladder on (re)connect

  const makeClient = () => {
    const c = new RPC.Client({ transport: 'ipc' })
    c.on('ready', () => {
      state.connected = true
      // discord-rpc's Client doesn't actually expose a `startTime` property
      // (confirmed against its source - there is no such field), so this
      // was always reading undefined. With no real anchor, Discord shows
      // its own "time since last update" instead of a fixed elapsed timer -
      // which is exactly why it looked like the timer reset on every status
      // change, since every setActivity() call counts as an update. Anchor
      // it to a real timestamp taken once here, on genuine (re)connect only.
      if (!startTimestamp) startTimestamp = Date.now()
      setActivity()
      emit()
    })
    c.on('disconnected', () => { state.connected = false; emit() })
    return c
  }

  const wantVoice = !!(config.enableVoice && config.clientSecret)

  // 1) Voice path: reuse a saved access token if we have one (no prompt),
  //    otherwise run the authorize flow once.
  if (wantVoice) {
    client = makeClient()
    try {
      let authed = false
      if (config.accessToken) {
        try { await client.login({ clientId: config.clientId, accessToken: config.accessToken }); authed = true } catch (e) {
          console.warn('Discord saved token rejected, re-authorizing:', e.message)
        }
      }
      if (!authed) {
        await client.login({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scopes: ['rpc', 'rpc.voice.read'],
          redirectUri: 'http://localhost:3737/oauth2/discord/callback'
        })
      }
      if (client.accessToken) { state.accessToken = client.accessToken; config.accessToken = client.accessToken }
      selfId = client.user?.id || null
      await wireVoice()
      state.error = ''
      emit()
      return { ok: true, voice: state.voiceAuthorized }
    } catch (err) {
      // rpc.voice.read is an allowlist-only Discord scope; unapproved apps get
      // invalid_scope. Fall back to Rich Presence and explain clearly (no retry spam).
      const scopeBlocked = /invalid_scope|unauthorized|access/i.test(err.message || '')
      state.error = scopeBlocked
        ? 'Voice needs Discord RPC allowlist approval — running Rich Presence only'
        : 'Voice unavailable: ' + err.message
      if (scopeBlocked) {
        console.log('[discord] rpc.voice.read is not allowlisted for this app — using Rich Presence only (this is expected unless Discord approved your app).')
      } else {
        console.warn('[discord] voice login error, using Rich Presence only:', err.message)
      }
      try { await client.destroy() } catch (_) {}
      client = null
    }
  }

  // 2) Basic Rich Presence (no secret, no prompt, always works).
  client = makeClient()
  try {
    await client.login({ clientId: config.clientId })
    emit()
    return { ok: true, voice: false, note: state.error || undefined }
  } catch (err) {
    state.connected = false
    state.error = err.message
    emit()
    return { ok: false, error: err.message }
  }
}

async function stopDiscord () {
  state.connected = false
  state.voiceAuthorized = false
  currentChannelId = null
  if (client) {
    try { await client.destroy() } catch (_) {}
    client = null
  }
  emit()
}

function updateActivity (activity) { setActivity(activity) }
function getDiscordState () { return { ...state } }
function setExtraOscTargets (targets = []) { config.extraOscTargets = Array.isArray(targets) ? targets : [] }

// Read-only snapshot of the live VRChat context for statusPush.js to relay to
// the NekoSuneAPPS backend (Activity panel / official bot) — reuses the exact
// same data already assembled here for Rich Presence instead of re-deriving it.
function getVrcContextSnapshot () {
  return {
    worldName: vrc.worldName,
    joinUrl: vrc.joinUrl,
    worldUrl: vrc.worldUrl,
    profileUrl: effectiveProfileUrl(),
    hrBpm: vrc.hrBpm,
    nowPlaying: vrc.nowPlaying,
    vrcStatus: config.vrcStatus,
    showWorld: config.showWorld,
    showHeartRate: config.showHeartRate,
    showNowPlaying: config.showNowPlaying
  }
}

module.exports = {
  startDiscord, stopDiscord, updateActivity, setVrcContext, getDiscordState,
  setExtraOscTargets, getVrcContextSnapshot
}

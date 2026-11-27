// modules/chatbox/chatboxComposer.js
// Multi-line VRChat chatbox composer.
//
// VRChat's /chatbox/input renders newline-separated text as stacked lines, so the
// chatbox can show several lines at once (like the in-game screenshot):
//
//     💬 Enjoy 🖤              <- ROTATION line (cycles through items each tick)
//     🌍 Smashed | 👥 3 | US   <- own line (always shown)
//     💗 82 | 81 avg | 140 max <- own line
//     03:55 AM                 <- own line
//
// Each source has a MODE:
//   'off'    - not shown
//   'line'   - gets its own permanent line, always visible
//   'rotate' - its text joins the single rotation line (shown one at a time)
//
// Status presets are always rotation items. Only ONE rotation line exists, so
// "less in rotation, more own-lines" is the default - exactly like the screenshot.

const { resolveTokens, formatClock } = require('../status/statusModule')
const clockSync = require('../../time/clockSync')

const MAX_CHATBOX = 144

// Shorten text to at most `max` UTF-16 units without splitting an emoji /
// surrogate pair (a plain .slice() can leave half an emoji, shown as "�").
function clip (text, max, ellipsis = '…') {
  const s = String(text || '')
  if (s.length <= max) return s
  let out = ''
  for (const ch of s) {
    if (out.length + ch.length + ellipsis.length > max) break
    out += ch
  }
  return out.trimEnd() + ellipsis
}

// Fit a multi-line block into VRChat's 144-char cap. Short lines are kept
// whole; only the longest lines are shortened ("…"), each to a fair share of
// what's left. Before, the block stopped at the first line that didn't fit, so
// a first line over 144 chars (e.g. a long song title + progress bar) made the
// message empty: nothing was sent, and every line after it was hidden too.
const MIN_LINE = 12 // below this a line isn't worth showing
function fitLines (lines, max = MAX_CHATBOX) {
  let keep = lines.filter(Boolean)
  // Too many lines for even a short version of each: drop from the bottom.
  while (keep.length > 1 && keep.length * MIN_LINE + (keep.length - 1) > max) keep = keep.slice(0, -1)
  if (keep.join('\n').length <= max) return keep.join('\n')
  let budget = max - (keep.length - 1)
  const caps = new Array(keep.length)
  const order = keep.map((l, i) => i).sort((a, b) => keep[a].length - keep[b].length)
  order.forEach((idx, k) => {
    const share = Math.floor(budget / (order.length - k))
    caps[idx] = Math.min(keep[idx].length, share)
    budget -= caps[idx]
  })
  return keep.map((l, i) => clip(l, caps[i])).join('\n')
}

// How long a manually-sent message stays pinned in the chatbox before the
// automated rotation takes over again (1 minute 30 seconds).
const HOLD_MS = 90000
// While pinned, re-send the text periodically so VRChat keeps showing it even
// when the automated rotation loop isn't running.
const HOLD_REFRESH_MS = 3000

// Fixed render order for own-lines (top to bottom). The rotation line is placed
// at the top by default (rotationPosition = 'top').
const LINE_ORDER = [
  'nowPlaying', 'world', 'discord', 'stats', 'network', 'heartRate', 'weather', 'window',
  'ton', 'tiktok', 'twitch', 'kick', 'clock'
]

class ChatboxComposer {
  constructor ({ sendChatboxMessage, onHoldChange }) {
    this.send = sendChatboxMessage
    this.onHoldChange = typeof onHoldChange === 'function' ? onHoldChange : null
    this.timer = null
    this.rotateIndex = 0
    this.intervalMs = 4000
    this.rotationPosition = 'top' // 'top' | 'bottom'
    this.presets = []
    this.windowShowTitle = false // false = app/process name only; true = full window title

    // Manual-message pin: holdText is shown instead of the automated rotation
    // until holdUntil passes, then the chatbox returns to automated status.
    this.holdText = null
    this.holdUntil = 0
    this.holdTimer = null
    this.holdMs = HOLD_MS

    // per-source mode
    this.modes = {
      status: 'rotate',
      nowPlaying: 'line',
      world: 'off',
      stats: 'line',
      network: 'off',
      heartRate: 'line',
      weather: 'off',
      window: 'off',
      ton: 'off',
      tiktok: 'off',
      twitch: 'off',
      kick: 'off',
      discord: 'off',
      clock: 'line'
    }

    this.data = {
      song: '', artist: '', title: '', songSource: '', songTime: '', songProgress: '', songDuration: '', songBar: '', world: '',
      cpu: 0, cpuTemp: 0, gpu: 0, gpuTemp: 0, ramPct: 0, ramUsed: 0, ramTotal: 0,
      cpuName: '', gpuName: '', vramUsed: 0, vramTotal: 0,
      down: 0, up: 0, ping: 0,
      hr: 0, hrOnline: false, hrAvg: 0, hrMax: 0, hrMin: 0,
      window: '', windowApp: '',
      // each platform keeps its data points separate
      tiktokFollowers: 0, tiktokViewers: 0, tiktokLikes: 0, tiktokVideos: 0, tiktokNew: 0, tiktokLive: false,
      twitchFollowers: 0, twitchViewers: 0, twitchLive: false,
      kickFollowers: 0, kickViewers: 0, kickLive: false,
      discordChannel: '', discordUsers: 0, discordMute: false, discordDeaf: false,
      weather: '',
      // ToNSaveManager (Terrors of Nowhere)
      tonConnected: false, tonRoundActive: false, tonRound: '', tonTerror: '', tonMap: '',
      tonAlive: true, tonPlayers: 0, tonRounds: 0, tonDeaths: 0, tonSurvivals: 0,
      tonDamage: 0, tonStuns: 0
    }
  }

  setMode (key, mode) {
    if (key in this.modes && ['off', 'line', 'rotate'].includes(mode)) this.modes[key] = mode
  }

  setModes (modes = {}) {
    Object.entries(modes).forEach(([k, v]) => this.setMode(k, v))
  }

  setRotationPosition (pos) {
    if (pos === 'top' || pos === 'bottom') this.rotationPosition = pos
  }

  setWindowShowTitle (on) { this.windowShowTitle = !!on }

  // The window text to show, honoring the "full title" toggle. The title can be
  // long, so cap it (the whole block is also capped to 144 in buildMessage).
  windowText () {
    const d = this.data
    if (this.windowShowTitle && d.window) {
      const t = d.window.length > 60 ? d.window.slice(0, 59) + '…' : d.window
      return t
    }
    return d.windowApp || d.window || ''
  }

  setPresets (presets) {
    this.presets = Array.isArray(presets) ? presets.filter(p => String(p).trim()) : []
  }

  update (patch = {}) { Object.assign(this.data, patch) }

  tokenMap () {
    const d = this.data
    const n = v => (Number.isFinite(v) ? v.toLocaleString() : v)
    return {
      // time
      time: formatClock(), date: clockSync.formatDate(new Date()),
      // media
      song: d.song, artist: d.artist, title: d.title,
      songsource: d.songSource, songtime: d.songTime, songprogress: d.songProgress,
      songduration: d.songDuration, songbar: d.songBar,
      // system
      // temps / VRAM are '' when unknown, so the token drops out instead of showing "0"
      cpu: d.cpu, cputemp: d.cpuTemp || '', gpu: d.gpu, gputemp: d.gpuTemp || '',
      cpuname: d.cpuName, gpuname: d.gpuName, vram: d.vramUsed || '', vramtotal: d.vramTotal || '',
      ram: d.ramPct, ramused: d.ramUsed, ramtotal: d.ramTotal,
      // network
      down: d.down, up: d.up, ping: d.ping,
      // heart rate
      hr: d.hr, hravg: d.hrAvg, hrmax: d.hrMax, hrmin: d.hrMin,
      // window / world
      window: this.windowText(), world: d.world, weather: d.weather,
      // TikTok - separate data points
      tiktok: n(d.tiktokFollowers), tiktoklive: n(d.tiktokViewers),
      tiktoklikes: n(d.tiktokLikes), tiktokvideos: n(d.tiktokVideos), tiktoknew: n(d.tiktokNew),
      // Twitch - separate data points
      twitch: n(d.twitchFollowers), twitchlive: n(d.twitchViewers),
      // Kick - separate data points
      kick: n(d.kickFollowers), kicklive: n(d.kickViewers),
      // Discord voice
      discord: d.discordChannel, discordusers: n(d.discordUsers),
      // ToNSaveManager (Terrors of Nowhere)
      ton: d.tonRoundActive
        ? [d.tonRound, d.tonTerror, d.tonAlive ? 'Alive' : 'Dead'].filter(Boolean).join(' · ')
        : (d.tonRounds ? `${d.tonSurvivals}/${d.tonRounds} survived` : ''),
      tonround: d.tonRound, tonterror: d.tonTerror, tonmap: d.tonMap,
      tonalive: d.tonRoundActive ? (d.tonAlive ? 'Alive' : 'Dead') : '',
      tonplayers: n(d.tonPlayers),
      tonrounds: n(d.tonRounds), tondeaths: n(d.tonDeaths), tonsurvivals: n(d.tonSurvivals),
      tonwinrate: d.tonRounds ? Math.round((d.tonSurvivals / d.tonRounds) * 100) + '%' : '',
      tondamage: n(d.tonDamage), tonstuns: n(d.tonStuns)
    }
  }

  // Build the display text for a single source (or '' if it has no data right now).
  lineFor (key) {
    const d = this.data
    switch (key) {
      case 'nowPlaying': {
        if (!d.song) return ''
        // songBar/songTime are the same progress-bar + "elapsed-duration"
        // values already available as {songbar}/{songtime} tokens in Status
        // presets - this line just hadn't been wired to use them, so the
        // Multi-line chatbox's Now Playing line only ever showed the bare
        // song name with no progress/duration at all.
        const extra = [d.songBar, d.songTime].filter(Boolean).join(' ')
        return `🎵 ${d.song}${extra ? ' ' + extra : ''}`
      }
      case 'world': return d.world ? `🌍 ${d.world}` : ''
      case 'stats': return `🖥 CPU ${d.cpu}%${d.cpuTemp ? ' ' + d.cpuTemp + '°C' : ''} | GPU ${d.gpu}%${d.gpuTemp ? ' ' + d.gpuTemp + '°C' : ''} | RAM ${d.ramPct}%`
      case 'network': return `🌐 ↓${d.down} ↑${d.up} Mbps${d.ping ? ' | ' + d.ping + 'ms' : ''}`
      case 'heartRate': {
        if (!d.hrOnline || !d.hr) return ''
        const extra = []
        if (d.hrAvg) extra.push(`${d.hrAvg} avg`)
        if (d.hrMax) extra.push(`${d.hrMax} max`)
        if (d.hrMin) extra.push(`${d.hrMin} min`)
        return `💗 ${d.hr}${extra.length ? ' | ' + extra.join(' | ') : ' bpm'}`
      }
      case 'weather': return d.weather ? `🌦 ${d.weather}` : ''
      case 'window': { const w = this.windowText(); return w ? `🪟 ${w}` : '' }
      case 'ton': {
        if (d.tonRoundActive) {
          const parts = [d.tonRound || 'Round', d.tonTerror].filter(Boolean)
          return `👻 ${parts.join(' · ')}${d.tonAlive ? ' · Alive' : ' · Dead'}`
        }
        if (d.tonRounds) return `👻 ToN: ${d.tonSurvivals}/${d.tonRounds} survived`
        return ''
      }
      case 'tiktok': return d.tiktokFollowers ? `🎬 TikTok: ${d.tiktokFollowers.toLocaleString()} followers` : ''
      case 'twitch': return d.twitchFollowers ? `🟣 Twitch: ${d.twitchFollowers.toLocaleString()} followers` : ''
      case 'kick': return d.kickFollowers ? `🟢 Kick: ${d.kickFollowers.toLocaleString()} followers` : ''
      case 'discord': {
        if (!d.discordChannel) return ''
        const tags = []
        if (d.discordMute) tags.push('🔇')
        if (d.discordDeaf) tags.push('🔈')
        return `💜 ${d.discordChannel} (${d.discordUsers})${tags.length ? ' ' + tags.join('') : ''}`
      }
      case 'clock': return `🕒 ${formatClock()}`
      default: return ''
    }
  }

  // All items eligible for the single rotation line.
  rotationItems () {
    const tokens = this.tokenMap()
    const items = []
    if (this.modes.status === 'rotate') {
      this.presets.forEach(p => { const t = resolveTokens(p, tokens); if (t) items.push(t) })
    } else if (this.modes.status === 'line' && this.presets.length) {
      // status as own-line uses the first preset only
      const t = resolveTokens(this.presets[0], tokens); if (t) items.push(t)
    }
    LINE_ORDER.forEach(key => {
      if (this.modes[key] === 'rotate') { const l = this.lineFor(key); if (l) items.push(l) }
    })
    return items
  }

  // The permanent own-lines, in fixed order.
  fixedLines () {
    const lines = []
    if (this.modes.status === 'line' && this.presets.length) {
      const t = resolveTokens(this.presets[0], this.tokenMap()); if (t) lines.push(t)
    }
    LINE_ORDER.forEach(key => {
      if (this.modes[key] === 'line') { const l = this.lineFor(key); if (l) lines.push(l) }
    })
    return lines
  }

  // Assemble the full multi-line chatbox payload for this tick.
  buildMessage () {
    const fixed = this.fixedLines()
    const rot = this.rotationItems()

    let rotationLine = ''
    if (rot.length) {
      if (this.rotateIndex >= rot.length) this.rotateIndex = 0
      rotationLine = rot[this.rotateIndex]
      this.rotateIndex = (this.rotateIndex + 1) % rot.length
    }

    let lines = []
    if (rotationLine && this.rotationPosition === 'top') lines.push(rotationLine)
    lines = lines.concat(fixed)
    if (rotationLine && this.rotationPosition === 'bottom') lines.push(rotationLine)

    return fitLines(lines, MAX_CHATBOX)
  }

  tick () {
    // While a manual message is pinned, keep showing it (no notify on refresh)
    // instead of the automated rotation, until its hold window expires.
    if (this.holdActive()) {
      if (typeof this.send === 'function') this.send(this.holdText, false)
      return
    }
    if (this.holdText) this.clearHold() // hold just expired -> resume automated
    const msg = this.buildMessage()
    if (msg && typeof this.send === 'function') this.send(msg, false)
  }

  start (intervalMs) {
    if (Number.isFinite(intervalMs)) this.intervalMs = Math.max(1500, intervalMs)
    this.stop()
    this.tick()
    this.timer = setInterval(() => this.tick(), this.intervalMs)
  }

  stop () {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  holdActive () { return !!this.holdText && Date.now() < this.holdUntil }

  // Seconds left on the current pin (0 when not pinned).
  holdRemaining () { return this.holdActive() ? Math.ceil((this.holdUntil - Date.now()) / 1000) : 0 }

  // Clear the pin and let the chatbox return to automated status.
  clearHold () {
    this.holdText = null
    this.holdUntil = 0
    if (this.holdTimer) { clearInterval(this.holdTimer); this.holdTimer = null }
    if (this.onHoldChange) this.onHoldChange(null)
    // If the automated rotation loop is running it repaints on its next tick.
    // If not, clear the box so the pinned text disappears instead of lingering.
    if (!this.timer && typeof this.send === 'function') this.send('', false)
  }

  // Manual message (typed by the user): pin it for holdMs, sent immediately with
  // notify, then the chatbox returns to automated status.
  sendNow (text) {
    const t = clip(String(text), MAX_CHATBOX, '')
    if (!t) return
    this.holdText = t
    this.holdUntil = Date.now() + this.holdMs
    if (typeof this.send === 'function') this.send(t, true)
    if (this.onHoldChange) this.onHoldChange(t)
    // The automated loop refreshes the pin on its own tick. When it isn't
    // running, drive a dedicated refresh timer so the pin survives the full
    // hold window and then clears itself.
    if (!this.timer) {
      if (this.holdTimer) clearInterval(this.holdTimer)
      this.holdTimer = setInterval(() => {
        if (this.holdActive()) { if (typeof this.send === 'function') this.send(this.holdText, false) }
        else this.clearHold()
      }, HOLD_REFRESH_MS)
    }
  }
}

module.exports = { ChatboxComposer, MAX_CHATBOX, LINE_ORDER, HOLD_MS, fitLines, clip }

// modules/vrchat/vrchatWorld.js
// Detects the VRChat world you're currently in by tailing VRChat's rolling
// output log (VRChat does NOT expose world info over OSC). From the log we pull:
//   - current world id + instance id  -> a clickable "launch/join" URL
//   - the world's display name
//   - your own user id (usr_...)       -> your VRChat profile URL
//   - what's playing in the instance   -> see worldMedia.js (Popcorn Palace,
//     VR Dancing, LS Media, ProTV nowplaying, YouTube titles)
// Used to enrich the Discord Rich Presence. Runs in the MAIN process.
//
// Log location:  %USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log_*.txt

const fs = require('fs')
const os = require('os')
const path = require('path')
const { createWorldMediaTracker, lineTime } = require('./worldMedia')

const LOG_DIR = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat')
const POLL_MS = 2000
const { ActivityEvents, parsePortalEvent } = require('./activityEvents')
const activity = new ActivityEvents()
let primingActivity = true

let timer = null
let onUpdate = null
let currentFile = null
let readPos = 0
let tail = '' // carry an unfinished last line between reads

const state = {
  inWorld: false,
  worldId: '',
  instanceId: '',
  // Set only when the instance is an actual VRChat Group instance (instanceId carries a
  // ~group(grp_...) tag) — a real signal that this wasn't just a random public/friends
  // instance, unlike being in a popular hangout world some group happens to also use.
  groupId: '',
  worldName: '',
  userId: '',
  userDisplayName: '',
  joinUrl: '', // launch straight into this instance
  worldUrl: '', // the world's public page
  profileUrl: '', // your VRChat profile
  players: [], // RADAR: display names currently in your instance (from the log)
  playersDetailed: [], // same players, as {id, displayName} - for screenshot metadata
  lastVideo: '', // last video URL played in the instance (from the log)
  lastPortal: '', // who dropped the last portal
  // What's playing in this instance (null when nothing): { source, kind, label,
  // videoName, thumbnailUrl, isPaused, startedAt, endsAt, ... } — see worldMedia.js.
  media: null,
  portalSeq: 0 // increments each portal drop (so repeats are logged)
}

// Radar player set, kept in sync with state.players. playerMap additionally
// tracks each player's usr_ id (when the log line includes one) for the
// screenshot metadata feature - VRCX embeds player IDs, not just names.
const playerSet = new Set()
const playerMap = new Map() // displayName -> usr_id
function syncPlayers () {
  state.players = Array.from(playerSet)
  state.playersDetailed = state.players.map(displayName => ({ id: playerMap.get(displayName) || '', displayName }))
}

// "OnPlayerJoined DisplayName (usr_xxxx-...)" - splits the trailing id off,
// falling back to no id if a line doesn't carry one.
function splitNameAndId (raw) {
  const m = raw.match(/^(.*?)\s*\((usr_[^)]+)\)\s*$/)
  return m ? { displayName: m[1].trim(), id: m[2] } : { displayName: raw.trim(), id: '' }
}

// Media tracker; async YouTube title lookups re-emit when they resolve.
const media = createWorldMediaTracker({ onChange: () => { state.media = media.current(); emit() } })

// Optional listener for timestamped instance events (instance history / charts):
//   { type: 'instance', worldId, instanceId, groupId, at } | { type: 'worldName', name, at }
//   { type: 'join' | 'leave', displayName, userId, at }   | { type: 'left', at }
// `at` is the log line's own time, so replaying a log on startup gives the same
// events again (consumers dedupe on it).
let onEvent = null
function setEventListener (fn) { onEvent = typeof fn === 'function' ? fn : null }
function event (e) { if (onEvent) { try { onEvent(e) } catch (err) { console.warn('vrc world event listener:', err.message) } } }

function buildUrls () {
  state.worldUrl = state.worldId ? `https://vrchat.com/home/world/${state.worldId}` : ''
  state.joinUrl = (state.worldId && state.instanceId)
    ? `https://vrchat.com/home/launch?worldId=${state.worldId}&instanceId=${encodeURIComponent(state.instanceId)}`
    : ''
  state.profileUrl = state.userId ? `https://vrchat.com/home/user/${state.userId}` : ''
}

function emit () {
  buildUrls()
  if (typeof onUpdate === 'function') onUpdate({ ...getVrcWorld(), at: Date.now() })
}

// Leaving the world: a real "[Behaviour] OnLeftRoom", VRChat quitting
// ("VRCApplication: HandleApplicationQuit" - logged with no OnLeftRoom first)
// or VRChat no longer running (crash; see checkVrchatGone).
function leaveWorld (at) {
  if (!state.inWorld && !state.worldId) return false
  event({ type: 'left', at })
  state.inWorld = false
  state.worldId = ''
  state.instanceId = ''
  state.groupId = ''
  state.worldName = ''
  media.reset(); media.setWorld(''); state.media = null
  playerSet.clear(); playerMap.clear(); syncPlayers()
  return true
}

// Parse a single log line and fold any world/user info into state.
// Returns true if something relevant changed.
//
// World/player lines are matched only with VRChat's own "[Behaviour] " prefix.
// Without it, Udon/world debug output and exception stack traces matched too,
// e.g. "  at ÎÍÌ….OnLeftRoom () [0x00000]" blanked the current world.
function processLine (line) {
  activity.process(line)
  // "[Behaviour] Joining wrld_xxxx-...:12345~region(use)~nonce(...)" — a Group instance's id
  // additionally carries a "~group(grp_xxxx)" tag (VRChat's own instance-type marker).
  let m = line.match(/\[Behaviour\] Joining (wrld_[^\s:]+):(\S+)/)
  if (m) {
    state.worldId = m[1]
    state.instanceId = m[2]
    state.groupId = (m[2].match(/~group\(([^)]+)\)/) || [])[1] || ''
    state.inWorld = true
    media.reset(); media.setWorld(m[1]); state.media = null
    playerSet.clear(); playerMap.clear(); syncPlayers() // new instance — radar resets
    event({ type: 'instance', worldId: state.worldId, instanceId: state.instanceId, groupId: state.groupId, at: lineTime(line) })
    return true
  }
  // RADAR: "[Behaviour] OnPlayerJoined <DisplayName> (usr_...)"
  m = line.match(/\[Behaviour\] OnPlayerJoined\s+(.+)$/)
  if (m) {
    const { displayName, id } = splitNameAndId(m[1])
    playerSet.add(displayName)
    if (id) playerMap.set(displayName, id)
    syncPlayers()
    event({ type: 'join', displayName, userId: id, at: lineTime(line) })
    return true
  }
  // "[Behaviour] OnPlayerLeft <DisplayName> (usr_...)"
  m = line.match(/\[Behaviour\] OnPlayerLeft\s+(.+)$/)
  if (m) {
    const { displayName, id } = splitNameAndId(m[1])
    event({ type: 'leave', displayName, userId: id || playerMap.get(displayName) || '', at: lineTime(line) })
    playerSet.delete(displayName)
    playerMap.delete(displayName)
    syncPlayers()
    return true
  }
  // "[Behaviour] Joining or Creating Room: <World Name>"
  m = line.match(/\[Behaviour\] Joining or Creating Room:\s*(.+?)\s*$/)
  if (m) {
    state.worldName = m[1]
    state.inWorld = true
    event({ type: 'worldName', name: m[1], at: lineTime(line) })
    return true
  }
  // "[Behaviour] OnLeftRoom"
  if (/\[Behaviour\] OnLeftRoom\s*$/.test(line)) return leaveWorld(lineTime(line))
  // "VRCApplication: HandleApplicationQuit at 8748.678" - game closed while
  // still in a world (no OnLeftRoom is logged).
  if (/VRCApplication: HandleApplicationQuit\b/.test(line)) return leaveWorld(lineTime(line))
  // World media + video player URLs (media-link history). Covers AVPro
  // "Resolving URL", USharpVideo and SDK2 "User X added URL ..." lines too,
  // which the old single regex missed.
  if (media.processLine(line)) {
    state.media = media.current()
    state.lastVideo = media.lastVideoUrl() || state.lastVideo
    return true
  }
  const portal = parsePortalEvent(line)
  if (portal) {
    state.lastPortal = portal.name
    state.lastPortalDetail = portal.detail
    state.portalSeq++
    return true
  }
  // Older builds: "User Authenticated: DisplayName (usr_xxxx-...)".
  // Current builds: "[Authentication - …] Preforming post login checks for DisplayName (usr_…)"
  // (VRChat's own spelling of "Preforming"; "Performing" accepted in case they fix it).
  m = line.match(/User Authenticated:\s*(.+?)\s*\((usr_[^)]+)\)/) ||
    line.match(/\[Authentication[^\]]*\] P(?:re|er)forming post login checks for\s+(.+?)\s*\((usr_[^)]+)\)/)
  if (m) {
    state.userDisplayName = m[1]
    state.userId = m[2]
    return true
  }
  return false
}

function newestLogFile () {
  let files
  try {
    files = fs.readdirSync(LOG_DIR).filter(f => /^output_log_.*\.txt$/i.test(f))
  } catch (_) {
    return null // VRChat never run / dir missing
  }
  if (!files.length) return null
  let best = null
  let bestMtime = -1
  for (const f of files) {
    try {
      const mt = fs.statSync(path.join(LOG_DIR, f)).mtimeMs
      if (mt > bestMtime) { bestMtime = mt; best = f }
    } catch (_) { /* file vanished mid-scan */ }
  }
  return best ? path.join(LOG_DIR, best) : null
}

function consume (chunk) {
  tail += chunk
  const lines = tail.split(/\r?\n/)
  tail = lines.pop() // last element is the (possibly partial) trailing line
  let changed = false
  for (const line of lines) {
    if (line && processLine(line)) changed = true
  }
  return changed
}

// VRChat crashed or was killed: no OnLeftRoom/HandleApplicationQuit is ever
// logged, so the last world would stay "current" forever (Discord presence,
// chatbox world line, Radar, instance history duration). Once the log has been
// quiet a while and we still think we're in a world, check VRChat is actually
// running. Log silence alone isn't enough: an idle empty world can go quiet.
const GONE_QUIET_MS = 60000
const GONE_CHECK_MS = 30000
let lastGoneCheck = 0
let goneCheckPending = false
let isVrchatRunning = cb => {
  if (process.platform !== 'win32') return cb(true)
  require('child_process').execFile('tasklist', ['/FI', 'IMAGENAME eq VRChat.exe', '/NH'], { windowsHide: true, timeout: 10000 },
    (err, out) => cb(err ? true : /VRChat\.exe/i.test(out || ''))) // on error assume running (don't drop state)
}
function checkVrchatGone (mtimeMs) {
  if (!state.inWorld || goneCheckPending) return
  const now = Date.now()
  if (now - mtimeMs < GONE_QUIET_MS || now - lastGoneCheck < GONE_CHECK_MS) return
  lastGoneCheck = now
  goneCheckPending = true
  isVrchatRunning(running => {
    goneCheckPending = false
    if (!running && state.inWorld && leaveWorld(Math.round(mtimeMs))) emit()
  })
}

function poll () {
  const newest = newestLogFile()
  if (!newest) return

  // A new VRChat session started -> switch to the fresh log, read it whole.
  if (newest !== currentFile) {
    primingActivity = true
    activity.players.clear(); activity.avatars.clear(); activity.events = []
    currentFile = newest
    readPos = 0
    tail = ''
  }

  let size, mtimeMs
  try { const st = fs.statSync(currentFile); size = st.size; mtimeMs = st.mtimeMs } catch (_) { return }
  if (size < readPos) { readPos = 0; tail = ''; primingActivity = true; activity.events = []; activity.players.clear(); activity.avatars.clear() } // log truncated/rotated
  if (size === readPos) { checkVrchatGone(mtimeMs); return } // nothing new

  let fd
  try {
    fd = fs.openSync(currentFile, 'r')
    const len = size - readPos
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, readPos)
    readPos = size
    const changed = consume(buf.toString('utf8'))
    if (primingActivity) { activity.events = []; primingActivity = false }
    if (changed || activity.events.length) emit()
  } catch (_) {
    /* ignore transient read errors */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch (_) {}
  }
}

function startVrcWorld (listener) {
  onUpdate = listener
  stopVrcWorld()
  // Prime state from the current log immediately, then poll for changes.
  poll()
  emit()
  timer = setInterval(poll, POLL_MS)
  return true
}

function stopVrcWorld () {
  if (timer) { clearInterval(timer); timer = null }
}

function getVrcWorld () { return { ...state, media: state.media ? { ...state.media } : null, activityEvents: activity.snapshot(), activitySequence: activity.sequence } }

module.exports = {
  startVrcWorld, stopVrcWorld, getVrcWorld, setEventListener,
  _processLine: processLine,
  _checkVrchatGone: checkVrchatGone,
  _setIsVrchatRunning: fn => { isVrchatRunning = fn; lastGoneCheck = 0 }
}

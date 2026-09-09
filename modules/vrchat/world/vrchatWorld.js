// modules/vrchat/vrchatWorld.js
// Detects the VRChat world you're currently in by tailing VRChat's rolling
// output log (VRChat does NOT expose world info over OSC). From the log we pull:
//   - current world id + instance id  -> a clickable "launch/join" URL
//   - the world's display name
//   - your own user id (usr_...)       -> your VRChat profile URL
// Used to enrich the Discord Rich Presence. Runs in the MAIN process.
//
// Log location:  %USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log_*.txt

const fs = require('fs')
const os = require('os')
const path = require('path')

const LOG_DIR = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat')
const POLL_MS = 5000

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

function buildUrls () {
  state.worldUrl = state.worldId ? `https://vrchat.com/home/world/${state.worldId}` : ''
  state.joinUrl = (state.worldId && state.instanceId)
    ? `https://vrchat.com/home/launch?worldId=${state.worldId}&instanceId=${encodeURIComponent(state.instanceId)}`
    : ''
  state.profileUrl = state.userId ? `https://vrchat.com/home/user/${state.userId}` : ''
}

function emit () {
  buildUrls()
  if (typeof onUpdate === 'function') onUpdate({ ...state, at: Date.now() })
}

// Parse a single log line and fold any world/user info into state.
// Returns true if something relevant changed.
function processLine (line) {
  // "[Behaviour] Joining wrld_xxxx-...:12345~region(use)~nonce(...)" — a Group instance's id
  // additionally carries a "~group(grp_xxxx)" tag (VRChat's own instance-type marker).
  let m = line.match(/Joining (wrld_[^\s:]+):(\S+)/)
  if (m) {
    state.worldId = m[1]
    state.instanceId = m[2]
    state.groupId = (m[2].match(/~group\(([^)]+)\)/) || [])[1] || ''
    state.inWorld = true
    playerSet.clear(); playerMap.clear(); syncPlayers() // new instance — radar resets
    return true
  }
  // RADAR: "[Behaviour] OnPlayerJoined <DisplayName> (usr_...)"
  m = line.match(/OnPlayerJoined\s+(.+)$/)
  if (m && !/OnPlayerJoinComplete/.test(line)) {
    const { displayName, id } = splitNameAndId(m[1])
    playerSet.add(displayName)
    if (id) playerMap.set(displayName, id)
    syncPlayers()
    return true
  }
  // "[Behaviour] OnPlayerLeft <DisplayName> (usr_...)"
  m = line.match(/OnPlayerLeft\s+(.+)$/)
  if (m) {
    const { displayName } = splitNameAndId(m[1])
    playerSet.delete(displayName)
    playerMap.delete(displayName)
    syncPlayers()
    return true
  }
  // "[Behaviour] Joining or Creating Room: <World Name>"
  m = line.match(/Joining or Creating Room:\s*(.+?)\s*$/)
  if (m) {
    state.worldName = m[1]
    state.inWorld = true
    return true
  }
  // "[Behaviour] OnLeftRoom"
  if (/OnLeftRoom\b/.test(line)) {
    state.inWorld = false
    state.worldId = ''
    state.instanceId = ''
    state.groupId = ''
    state.worldName = ''
    playerSet.clear(); playerMap.clear(); syncPlayers()
    return true
  }
  // Video player URLs (for media-link history).
  m = line.match(/\[Video Playback\][^']*resolve URL '([^']+)'/) || line.match(/added URL '([^']+)'/)
  if (m) { state.lastVideo = m[1]; return true }
  // Portal drops (best-effort — log wording varies between VRChat builds).
  if (/dropped a portal/i.test(line)) {
    const nm = (line.match(/([\w .\-]{2,40}?) (?:has )?dropped a portal/i) || [])[1]
    state.lastPortal = (nm ? nm.trim() : 'Someone'); state.portalSeq++
    return true
  }
  // "User Authenticated: DisplayName (usr_xxxx-...)"
  m = line.match(/User Authenticated:\s*(.+?)\s*\((usr_[^)]+)\)/)
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

function poll () {
  const newest = newestLogFile()
  if (!newest) return

  // A new VRChat session started -> switch to the fresh log, read it whole.
  if (newest !== currentFile) {
    currentFile = newest
    readPos = 0
    tail = ''
  }

  let size
  try { size = fs.statSync(currentFile).size } catch (_) { return }
  if (size < readPos) { readPos = 0; tail = '' } // log truncated/rotated
  if (size === readPos) return // nothing new

  let fd
  try {
    fd = fs.openSync(currentFile, 'r')
    const len = size - readPos
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, readPos)
    readPos = size
    if (consume(buf.toString('utf8'))) emit()
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

function getVrcWorld () { return { ...state } }

module.exports = { startVrcWorld, stopVrcWorld, getVrcWorld }

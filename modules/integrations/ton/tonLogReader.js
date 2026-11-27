// modules/integrations/ton/tonLogReader.js
// Reads Terrors of Nowhere data straight from VRChat's own output log, so the app
// works WITHOUT ToNSaveManager's WebSocket (which is off by default). VRChat writes
// a fresh output_log_*.txt each launch; we tail the newest one. ToN's Udon prints
// the lines we need (confirmed from a real log + the open-source ToNSaveManager
// parser, ChrisFeline/ToNSaveManager Utils/LogParser):
//
//   "[TERRORS SAVE CODE CREATED. …]"            -> the NEXT line is the save code
//   "This round is taking place at <Map> (<id>) and the round type is <Type>"
//   "Killers have been set - <a> <b> <c> // Round type is <Type>"   (terror IDs)
//   "You died." / "Respawned? Coward."          -> the local player died
//   "<name> landed a stun!" / "<name> was stunned."
//   "Hit - <n>"                                 -> damage taken
//   "[Behaviour] Entering Room: Terrors of Nowhere" / "OnLeftRoom"
//
// Emits a state object shaped like the ToNSaveManager WS state so the renderer can
// consume it the same way. Session counters only (the log resets each launch); exact
// achievement unlocks still come from decoding a save code. Runs in the MAIN process.

const fs = require('fs')
const os = require('os')
const path = require('path')
const tonData = require('./tonData')

const LOG_DIR = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat')
const POLL_MS = 3000

let timer = null
let onUpdate = null
let onRound = null
let onSave = null
let running = false
let currentFile = null
let readPos = 0
let tail = ''
let priming = false // true during the initial full-log read — suppress callbacks
let displayName = ''
let curRound = null

// Strip VRChat's "2026.06.13 09:56:05 Debug      -  " line prefix to get the message.
const stripPrefix = line => line.replace(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2} \w+\s+-\s+/, '')

const state = {
  source: 'log',
  connected: false, // in the ToN world (data is live)
  error: '',
  roundActive: false,
  roundType: '',
  terror: '',
  terrorIds: [],
  map: '',
  item: '',
  alive: true,
  optedIn: false,
  saboteur: false,
  players: 0,
  // session counters (reset each VRChat launch)
  rounds: 0,
  deaths: 0,
  survivals: 0,
  stuns: 0,
  stunsAll: 0,
  topStunsAll: 0,
  damageTaken: 0,
  lastRound: null,
  at: 0
}

function emit () { state.at = Date.now(); if (typeof onUpdate === 'function') onUpdate({ ...state }) }

function finalizeRound () {
  if (!curRound) return
  const result = curRound.died ? 'Died' : 'Survived'
  state.rounds++
  if (curRound.died) state.deaths++; else state.survivals++
  const rec = {
    roundType: curRound.roundType || 'Round',
    terror: curRound.terror || '',
    map: curRound.map || '',
    result,
    durationSec: Math.max(0, Math.round((Date.now() - curRound.startAt) / 1000)),
    at: Date.now()
  }
  state.lastRound = rec
  if (!priming && typeof onRound === 'function') { try { onRound(rec) } catch (_) {} }
  curRound = null
  state.roundActive = false
}

function processLine (raw) {
  const line = stripPrefix(raw)

  // Save code — wrapped [START]…[END] on one line. The header line ("…DO NOT INCLUDE
  // [START] or [END]") also contains those tokens, so validate the content is a code.
  let m = line.match(/\[START\](.+?)\[END\]/)
  if (m) {
    const code = m[1].trim()
    if (/^[0-9_,]{20,}$/.test(code) && !priming && typeof onSave === 'function') { try { onSave(code) } catch (_) {} }
    return true
  }

  // Round start: location + round type (both are readable names in the log).
  m = line.match(/^This round is taking place at (.+?) \((\d+)\) and the round type is (.+?)\s*$/)
  if (m) {
    finalizeRound()
    state.map = m[1].trim()
    state.roundType = m[3].trim()
    state.roundActive = true
    state.alive = true
    state.terror = ''
    state.terrorIds = []
    curRound = { map: state.map, roundType: state.roundType, terror: '', died: false, startAt: Date.now() }
    return true
  }

  // Terror IDs for the round ("Killers have been set - 31 0 0 // Round type is …").
  m = line.match(/Killers have been set - ([\d ]+?)\s*\/\//)
  if (m) {
    const ids = m[1].trim().split(/\s+/).map(Number).filter(n => n > 0)
    state.terrorIds = ids
    const roster = tonData.get().terrors
    state.terror = ids.length ? ids.map(i => (roster[i - 1] && roster[i - 1].name) || `Terror #${i}`).join(' & ') : ''
    if (curRound) curRound.terror = state.terror
    return true
  }

  // Local player died.
  if (/^You died\.\s*$/.test(line) || /Respawned\? Coward\./.test(line)) {
    state.alive = false
    if (curRound) curRound.died = true
    return true
  }

  // Round finished (ToN prints this at the end; intermission/lobby follows).
  if (/^Verified Round End/.test(line)) { finalizeRound(); return true }

  // Authenticated display name (to attribute "X landed a stun!" to us).
  // Older VRChat: "User Authenticated: Name (usr_…)". Current builds log
  // "[Authentication - …] Preforming post login checks for Name (usr_…)" instead;
  // without it displayName stayed empty and EVERY player's stun counted as ours.
  m = line.match(/User Authenticated:\s*(.+?)\s*\(usr_[^)]+\)/) ||
    line.match(/\[Authentication[^\]]*\] P(?:re|er)forming post login checks for\s+(.+?)\s*\(usr_[^)]+\)/)
  if (m) { displayName = m[1].trim(); return false }

  // Stuns landed by us.
  m = line.match(/^(.+?) landed a stun!/)
  if (m) { if (!displayName || m[1].trim() === displayName) { state.stuns++; state.stunsAll++ } return true }

  // Damage taken.
  m = line.match(/^Hit - (\d+)/)
  if (m) { state.damageTaken += Number(m[1]) || 0; return true }

  // Entering / leaving the ToN world.
  if (/Entering Room: Terrors of Nowhere/i.test(line)) { state.connected = true; return true }
  if (/\[Behaviour\] OnLeftRoom\b/.test(line)) { finalizeRound(); state.connected = false; state.roundActive = false; state.map = ''; state.terror = ''; return true }

  return false
}

function consume (chunk) {
  tail += chunk
  const lines = tail.split(/\r?\n/)
  tail = lines.pop()
  let changed = false
  for (const line of lines) { if (line && processLine(line)) changed = true }
  return changed
}

function newestLogFile () {
  let files
  try { files = fs.readdirSync(LOG_DIR).filter(f => /^output_log_.*\.txt$/i.test(f)) } catch (_) { return null }
  if (!files.length) return null
  let best = null; let bestMtime = -1
  for (const f of files) {
    try { const mt = fs.statSync(path.join(LOG_DIR, f)).mtimeMs; if (mt > bestMtime) { bestMtime = mt; best = f } } catch (_) {}
  }
  return best ? path.join(LOG_DIR, best) : null
}

function poll () {
  if (!running) return
  const newest = newestLogFile()
  if (!newest) return
  let initial = false
  if (newest !== currentFile) { currentFile = newest; readPos = 0; tail = ''; initial = true }
  let size
  try { size = fs.statSync(currentFile).size } catch (_) { return }
  if (size < readPos) { readPos = 0; tail = ''; initial = true }
  if (size === readPos) return
  let fd
  try {
    fd = fs.openSync(currentFile, 'r')
    const len = size - readPos
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, readPos)
    readPos = size
    priming = initial
    const changed = consume(buf.toString('utf8'))
    priming = false
    if (changed || initial) emit()
  } catch (_) { /* transient */ } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch (_) {} }
}

function startTonLog (opts = {}) {
  onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : null
  onRound = typeof opts.onRound === 'function' ? opts.onRound : null
  onSave = typeof opts.onSave === 'function' ? opts.onSave : null
  stopTonLog()
  running = true
  poll()
  emit()
  timer = setInterval(poll, POLL_MS)
  return true
}

function stopTonLog () {
  running = false
  if (timer) { clearInterval(timer); timer = null }
}

function getTonLogState () { return { ...state } }

module.exports = { startTonLog, stopTonLog, getTonLogState }

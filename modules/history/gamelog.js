// modules/history/gamelog.js
// VRChat history / game-log stored in a real SQLite file via sql.js (WASM — no
// native build). Records player join/leave, friend added/removed, world visits,
// and custom alerts. The DB lives next to the app's user data. Runs in MAIN.

const fs = require('fs')
const { openDb, saveDb } = require('../diagnostics/dbFile')
const os = require('os')
const path = require('path')

let SQL = null
let db = null
let dbPath = ''
let saveTimer = null

async function init (userDataDir) {
  if (db) return true
  let initSqlJs
  try { initSqlJs = require('sql.js') } catch (err) { console.warn('sql.js not installed:', err.message); return false }
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
  SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) })
  dbPath = path.join(userDataDir || os.tmpdir(), 'KitsuNexus-history.sqlite')
  try {
    db = openDb(SQL, dbPath).db // safe load: falls back to .bak, never overwrites a damaged file
  } catch (_) { db = new SQL.Database() }
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    name TEXT,
    detail TEXT,
    world TEXT
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)')
  // Migrate older DBs that predate world_id (Cloud Sync's world-visit history sync).
  try { db.run('ALTER TABLE events ADD COLUMN world_id TEXT') } catch (_) { /* column already exists */ }
  // Migrate older DBs that predate group_id (Community Ranks' auto-detected event
  // participation — only set on a 'world' row when that instance was a real VRChat Group
  // instance, per modules/vrchat/world/vrchatWorld.js).
  try { db.run('ALTER TABLE events ADD COLUMN group_id TEXT') } catch (_) { /* column already exists */ }
  // Cap the events table so db.export() stays fast (keep most recent 8000).
  trimEvents()
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, ts INTEGER, type TEXT, sender TEXT, message TEXT, world TEXT, link TEXT, read INTEGER DEFAULT 0
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS notification_history (
    id TEXT, ts INTEGER, type TEXT, sender TEXT, message TEXT, world TEXT, link TEXT, action TEXT, archivedAt INTEGER
  )`)
  // Live friend feed (online/offline/GPS/status/avatar/bio) — its own table and
  // cap, so a busy feed can't push world/join history out of `events`.
  db.run(`CREATE TABLE IF NOT EXISTS feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
    user_id TEXT, name TEXT, detail TEXT, location TEXT, world TEXT
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_feed_ts ON feed(ts)')
  try { db.run('DELETE FROM feed WHERE id NOT IN (SELECT id FROM feed ORDER BY ts DESC LIMIT 10000)') } catch (_) {}
  // Instance history (VRCX-style): one row per instance visit and one per player
  // stay, keyed on the VRChat log's own timestamps so re-reading the same log on
  // startup is a no-op (INSERT OR IGNORE).
  db.run(`CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, instance_id TEXT NOT NULL,
    world_name TEXT, group_id TEXT, joined_at INTEGER NOT NULL, left_at INTEGER,
    UNIQUE(world_id, instance_id, joined_at)
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_instances_joined ON instances(joined_at)')
  db.run(`CREATE TABLE IF NOT EXISTS instance_players (
    session_id INTEGER NOT NULL, name TEXT NOT NULL, user_id TEXT, joined_at INTEGER NOT NULL, left_at INTEGER,
    UNIQUE(session_id, name, joined_at)
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_iplayers_name ON instance_players(name)')
  db.run('CREATE INDEX IF NOT EXISTS idx_iplayers_user ON instance_players(user_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_iplayers_session ON instance_players(session_id)')
  try {
    db.run('DELETE FROM instances WHERE id NOT IN (SELECT id FROM instances ORDER BY joined_at DESC LIMIT 3000)')
    db.run('DELETE FROM instance_players WHERE session_id NOT IN (SELECT id FROM instances)')
  } catch (_) {}
  // Migrate older DBs that predate the read flag.
  try { db.run('ALTER TABLE notifications ADD COLUMN read INTEGER DEFAULT 0') } catch (_) { /* column already exists */ }
  return true
}

// ---- notifications cache (persists until dismissed) ----
function notifExists (id) {
  if (!db) return false
  const st = db.prepare('SELECT 1 FROM notifications WHERE id = :id'); st.bind({ ':id': id })
  const e = st.step(); st.free(); return e
}
// Returns true if this notification was NEW (not previously cached). Existing rows
// keep their read flag (only the content is refreshed); new rows start unread.
function upsertNotif (n) {
  if (!db || !n || !n.id) return false
  const isNew = !notifExists(n.id)
  if (isNew) {
    db.run('INSERT INTO notifications (id,ts,type,sender,message,world,link,read) VALUES (?,?,?,?,?,?,?,0)',
      [n.id, n.ts || Date.now(), n.type || '', n.sender || '', n.message || '', n.world || '', n.link || ''])
  } else {
    db.run('UPDATE notifications SET ts=?,type=?,sender=?,message=?,world=?,link=? WHERE id=?',
      [n.ts || Date.now(), n.type || '', n.sender || '', n.message || '', n.world || '', n.link || '', n.id])
  }
  persist()
  return isNew
}
function listNotifs () {
  if (!db) return []
  const st = db.prepare('SELECT id,ts,type,sender,message,world,link,read FROM notifications ORDER BY ts DESC LIMIT 100')
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
}
function unreadNotifCount () {
  if (!db) return 0
  const st = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0')
  let c = 0; if (st.step()) c = st.getAsObject().c || 0; st.free(); return c
}
function markAllNotifsRead () { if (db) { db.run('UPDATE notifications SET read = 1'); persist() } }
function archiveNotif (id, action = 'removed') {
  if (!db || !id) return
  db.run(`INSERT INTO notification_history (id,ts,type,sender,message,world,link,action,archivedAt)
    SELECT id,ts,type,sender,message,world,link,?,? FROM notifications WHERE id = ?`, [action, Date.now(), id])
}
function removeNotif (id, action = 'removed') { if (db) { archiveNotif(id, action); db.run('DELETE FROM notifications WHERE id = ?', [id]); persist() } }
function reconcileNotifs (activeIds = []) {
  if (!db) return
  const active = new Set(activeIds)
  for (const n of listNotifs()) {
    if (!active.has(n.id)) removeNotif(n.id, 'resolved')
  }
}
function clearNotifs () { if (db) { for (const n of listNotifs()) archiveNotif(n.id, 'cleared'); db.run('DELETE FROM notifications'); persist() } }

function persist () {
  if (!db || !dbPath) return
  clearTimeout(saveTimer)
  // Debounced + coalesced — db.export() serialises the whole DB, so write rarely.
  saveTimer = setTimeout(() => {
    try { saveDb(db, dbPath) } catch (e) { console.warn('history save failed:', e.message) }
  }, 8000)
}

// type: 'join' | 'leave' | 'friend_add' | 'friend_remove' | 'world' | 'alert' | 'group'
// `worldId` (wrld_… ) is only meaningful for type 'world' — used by Cloud Sync's world-visit
// history sync (modules/favorites/cloudSync.js) since `world` here is usually the world NAME,
// not an ID (that's what VRChat's own log file gives us for join/leave events).
// `groupId` (grp_… ) is only meaningful for type 'world' too — set when the instance was a
// real VRChat Group instance (Community Ranks' auto-detected event participation, see
// autoEventCount() below), left blank for a plain public/friends/invite instance.
function log (type, name, detail, world, worldId, groupId) {
  if (!db) return
  db.run('INSERT INTO events (ts,type,name,detail,world,world_id,group_id) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), String(type), name || '', detail || '', world || '', worldId || '', groupId || ''])
  persist()
}

// ---- live friend feed ----
let feedInserts = 0
function logFeed (e = {}) {
  if (!db || !e.type) return
  db.run('INSERT INTO feed (ts,type,user_id,name,detail,location,world) VALUES (?,?,?,?,?,?,?)',
    [e.ts || Date.now(), String(e.type), e.userId || '', e.name || '', String(e.detail || '').slice(0, 2000), e.location || e.status || '', e.worldName || ''])
  if (++feedInserts % 500 === 0) { try { db.run('DELETE FROM feed WHERE id NOT IN (SELECT id FROM feed ORDER BY ts DESC LIMIT 10000)') } catch (_) {} }
  persist()
}
function listFeed (opts = {}) {
  if (!db) return []
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000)
  const conds = []; const bind = {}
  if (opts.type) { conds.push('type = :t'); bind[':t'] = String(opts.type) }
  if (opts.search) { conds.push('(name LIKE :q OR world LIKE :q OR detail LIKE :q)'); bind[':q'] = `%${String(opts.search)}%` }
  const st = db.prepare(`SELECT id,ts,type,user_id AS userId,name,detail,location,world FROM feed${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ORDER BY ts DESC LIMIT ${limit}`)
  st.bind(bind)
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
}
function clearFeed () { if (!db) return; db.run('DELETE FROM feed'); persist() }

// ---- instance history ----
let currentSession = 0
function rows (sql, bind) {
  const st = db.prepare(sql); if (bind) st.bind(bind)
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
}
function closeSession (id, at) {
  if (!id) return
  // Never close with a time before the join (replaying an older log line).
  db.run('UPDATE instance_players SET left_at = ? WHERE session_id = ? AND left_at IS NULL AND joined_at <= ?', [at, id, at])
  db.run('UPDATE instances SET left_at = ? WHERE id = ? AND left_at IS NULL AND joined_at <= ?', [at, id, at])
}
// Events from vrchatWorld.setEventListener().
function instanceEvent (e = {}) {
  if (!db || !e.type) return
  const at = Number(e.at) || Date.now()
  if (e.type === 'instance' && e.worldId && e.instanceId) {
    // A session never closed (crash / log cut) ends when the next one starts.
    if (currentSession) closeSession(currentSession, at)
    else db.run('UPDATE instances SET left_at = ? WHERE left_at IS NULL AND joined_at < ?', [at, at])
    db.run('INSERT OR IGNORE INTO instances (world_id,instance_id,group_id,joined_at) VALUES (?,?,?,?)', [e.worldId, e.instanceId, e.groupId || '', at])
    const r = rows('SELECT id FROM instances WHERE world_id = :w AND instance_id = :i AND joined_at = :t', { ':w': e.worldId, ':i': e.instanceId, ':t': at })
    currentSession = r.length ? r[0].id : 0
  } else if (e.type === 'worldName' && currentSession) {
    db.run('UPDATE instances SET world_name = ? WHERE id = ?', [String(e.name || '').slice(0, 200), currentSession])
  } else if (e.type === 'join' && currentSession && e.displayName) {
    db.run('INSERT OR IGNORE INTO instance_players (session_id,name,user_id,joined_at) VALUES (?,?,?,?)', [currentSession, e.displayName, e.userId || '', at])
  } else if (e.type === 'leave' && currentSession && e.displayName) {
    db.run('UPDATE instance_players SET left_at = ? WHERE session_id = ? AND name = ? AND left_at IS NULL AND joined_at <= ?', [at, currentSession, e.displayName, at])
  } else if (e.type === 'left' && currentSession) {
    closeSession(currentSession, at); currentSession = 0
  } else return
  persist()
}
// Recent instance visits, optionally filtered by world name / id.
function listInstances (opts = {}) {
  if (!db) return []
  const limit = Math.min(parseInt(opts.limit, 10) || 100, 500)
  const where = opts.search ? 'WHERE i.world_name LIKE :q OR i.world_id = :raw' : ''
  return rows(`SELECT i.id, i.world_id AS worldId, i.instance_id AS instanceId, i.world_name AS worldName, i.group_id AS groupId,
      i.joined_at AS joinedAt, i.left_at AS leftAt, (SELECT COUNT(DISTINCT name) FROM instance_players p WHERE p.session_id = i.id) AS players
    FROM instances i ${where} ORDER BY i.joined_at DESC LIMIT ${limit}`, opts.search ? { ':q': `%${opts.search}%`, ':raw': String(opts.search) } : undefined)
}
// One instance visit + every player stay in it (for the timeline chart).
function instanceTimeline (id) {
  if (!db) return null
  const inst = rows('SELECT id, world_id AS worldId, instance_id AS instanceId, world_name AS worldName, joined_at AS joinedAt, left_at AS leftAt FROM instances WHERE id = :id', { ':id': Number(id) })[0]
  if (!inst) return null
  inst.players = rows('SELECT name, user_id AS userId, joined_at AS joinedAt, left_at AS leftAt FROM instance_players WHERE session_id = :id ORDER BY joined_at', { ':id': Number(id) })
  return inst
}
// People you've been in instances with: times met, last seen, time together.
// `now` closes still-open stays (current instance).
function playersMet (opts = {}) {
  if (!db) return []
  const limit = Math.min(parseInt(opts.limit, 10) || 100, 1000)
  const now = Date.now()
  const conds = []; const bind = { ':now': now }
  if (opts.search) { conds.push('p.name LIKE :q'); bind[':q'] = `%${opts.search}%` }
  if (opts.userId) { conds.push('p.user_id = :u'); bind[':u'] = String(opts.userId) }
  if (opts.name) { conds.push('p.name = :n'); bind[':n'] = String(opts.name) }
  if (opts.excludeName) { conds.push('p.name != :x'); bind[':x'] = String(opts.excludeName) }
  return rows(`SELECT p.name, MAX(p.user_id) AS userId, COUNT(DISTINCT p.session_id) AS timesMet,
      MAX(COALESCE(p.left_at, p.joined_at)) AS lastSeen, MIN(p.joined_at) AS firstSeen,
      SUM(MAX(0, COALESCE(p.left_at, :now) - p.joined_at)) AS totalMs,
      (SELECT i.world_name FROM instance_players q JOIN instances i ON i.id = q.session_id WHERE q.name = p.name ORDER BY q.joined_at DESC LIMIT 1) AS lastWorld
    FROM instance_players p ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
    GROUP BY p.name ORDER BY lastSeen DESC LIMIT ${limit}`, bind)
}

function list (opts = {}) {
  if (!db) return []
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000)
  const where = opts.type ? ' WHERE type = :t' : ''
  const stmt = db.prepare(`SELECT id,ts,type,name,detail,world,world_id FROM events${where} ORDER BY ts DESC LIMIT ${limit}`)
  if (opts.type) stmt.bind({ ':t': opts.type })
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// World-visit events (type 'world') with a real world_id, added since `ts` — for Cloud Sync's
// world-visit history push. Entries logged before world_id existed (or without one resolved)
// are skipped, since there's nothing useful to sync for those.
function listWorldVisitsSince (ts) {
  if (!db) return []
  const stmt = db.prepare("SELECT id,ts,name,detail,world_id FROM events WHERE type = 'world' AND world_id != '' AND ts > :ts ORDER BY ts ASC")
  stmt.bind({ ':ts': ts || 0 })
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// Distinct (world, group, calendar day) combinations where a 'world' visit carried a group_id —
// Community Ranks' auto-detected "event participation" (modules/ranks/index.js). Deliberately
// requires an actual VRChat Group instance, not just any visit to a world some group happens to
// use for hangouts, and dedupes per day so repeatedly rejoining/leaving the same instance can't
// be farmed into unlimited credit — rejoining the SAME world+group later the SAME day is free,
// but a genuinely different day (i.e. presumably a different event) counts again.
function countGroupInstanceVisits () {
  if (!db) return 0
  return scalar("SELECT COUNT(*) AS v FROM (SELECT DISTINCT world_id, group_id, date(ts/1000, 'unixepoch') AS d FROM events WHERE type = 'world' AND group_id != '')")
}
function scalar (sql) {
  const st = db.prepare(sql)
  const v = st.step() ? st.getAsObject().v : 0
  st.free()
  return v || 0
}

// Folds a world visit pulled from cloud sync into local history (so History shows visits made
// from other paired devices too), skipping it if this exact visit is already present.
function mergeWorldVisit (worldId, worldName, ts) {
  if (!db || !worldId || !ts) return
  const st = db.prepare("SELECT 1 FROM events WHERE type = 'world' AND world_id = :w AND ts = :ts")
  st.bind({ ':w': worldId, ':ts': ts })
  const exists = st.step(); st.free()
  if (exists) return
  db.run('INSERT INTO events (ts,type,name,detail,world,world_id) VALUES (?,?,?,?,?,?)',
    [ts, 'world', worldName || '', 'Synced from another device', worldName || '', worldId])
  persist()
}

function clear () {
  if (!db) return
  db.run('DELETE FROM events')
  persist()
}

// Delete only events of a given type (e.g. 'ton_round') — leaves other history intact.
function clearType (type) {
  if (!db) return
  db.run('DELETE FROM events WHERE type = ?', [String(type)])
  persist()
}

// History keeps the newest EVENTS_CAP events (db.export() serialises the whole DB).
const EVENTS_CAP = 8000
function trimEvents () {
  try { db.run(`DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT ${EVENTS_CAP})`) } catch (_) {}
}

// VRCX friend-log types → our history types (others, e.g. FriendRequest, are skipped).
const VRCX_FRIEND_TYPES = { Friend: 'friend_add', Unfriend: 'friend_remove', DisplayName: 'name_change', TrustLevel: 'trust_change' }

// Import history from an existing VRCX SQLite DB, matched against VRCX's current schema
// (src/services/database/index.js): gamelog_location, gamelog_join_leave and the per-user
// `usr<id>_friend_log_history` tables. The old version:
//  - reported success with 0 events for any non-database file (sql.js opens any bytes
//    lazily and every per-table error was swallowed);
//  - read a `gamelog_friend` table VRCX doesn't have, so friend history never imported;
//  - added duplicates on every re-import;
//  - was trimmed to the newest 8000 events only at the next app start, so most of a big
//    import silently vanished. Now the cap is applied here and `imported` is what was kept.
async function importVrcx (filePath) {
  if (!SQL || !db) return { ok: false, error: 'History not initialised' }
  let bytes
  try { bytes = fs.readFileSync(filePath) } catch (_) { return { ok: false, error: 'VRCX database not found at ' + filePath } }
  let src
  try { src = new SQL.Database(bytes) } catch (e) { return { ok: false, error: 'Could not open VRCX DB: ' + e.message } }
  const close = () => { try { src.close() } catch (_) {} }
  let tables
  try { tables = new Set((src.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values || []).map(r => r[0])) } catch (_) { close(); return { ok: false, error: 'Not a VRCX database' } }
  const friendTables = [...tables].filter(t => /_friend_log_history$/.test(t))
  if (!tables.has('gamelog_location') && !tables.has('gamelog_join_leave') && !friendTables.length) { close(); return { ok: false, error: 'No VRCX history tables in this file (is it VRCX.sqlite3?)' } }

  const toTs = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0 }
  const all = sql => { try { const st = src.prepare(sql); const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out } catch (_) { return [] } }
  const q = name => `"${String(name).replace(/"/g, '""')}"`
  // Only the newest EVENTS_CAP rows of each table can survive the cap anyway.
  const recent = (table, cols) => all(`SELECT ${cols} FROM ${q(table)} ORDER BY created_at DESC LIMIT ${EVENTS_CAP}`)

  const rows = []
  const worldByLocation = new Map()
  if (tables.has('gamelog_location')) {
    for (const r of recent('gamelog_location', 'created_at, location, world_id, world_name')) {
      if (r.location && r.world_name) worldByLocation.set(r.location, r.world_name)
      rows.push({ ts: toTs(r.created_at), type: 'world', name: r.world_name, world: r.world_name, worldId: r.world_id || String(r.location || '').split(':')[0] })
    }
  }
  if (tables.has('gamelog_join_leave')) {
    for (const r of recent('gamelog_join_leave', 'created_at, type, display_name, location')) {
      const type = r.type === 'OnPlayerLeft' ? 'leave' : r.type === 'OnPlayerJoined' ? 'join' : ''
      if (type) rows.push({ ts: toTs(r.created_at), type, name: r.display_name, world: worldByLocation.get(r.location) || '' })
    }
  }
  for (const t of friendTables) {
    for (const r of recent(t, 'created_at, type, display_name, previous_display_name, trust_level, previous_trust_level')) {
      const type = VRCX_FRIEND_TYPES[r.type]
      if (!type) continue
      const detail = type === 'name_change' ? `${r.previous_display_name || '?'} → ${r.display_name || '?'}`
        : type === 'trust_change' ? `${r.previous_trust_level || '?'} → ${r.trust_level || '?'}` : ''
      rows.push({ ts: toTs(r.created_at), type, name: r.display_name, detail })
    }
  }
  close()

  // Same event already in history: VRCX's own copy (re-import) or the one KitsuNexus
  // logged live from the same VRChat log, whose timestamp differs by a moment.
  const exists = db.prepare('SELECT 1 FROM events WHERE type = ? AND name = ? AND ts BETWEEN ? AND ? LIMIT 1')
  // Once history is full, rows older than the oldest kept event would be trimmed
  // straight away; don't insert them at all.
  const count = db.exec('SELECT count(*), min(ts) FROM events')[0].values[0]
  const floor = count[0] >= EVENTS_CAP ? Number(count[1]) || 0 : 0
  let added = 0; let skipped = 0; let tooOld = 0
  const ids = []
  try {
    db.run('BEGIN')
    for (const ev of rows) {
      if (!ev.ts || !ev.name) { skipped++; continue }
      if (ev.ts < floor) { tooOld++; continue }
      exists.bind([ev.type, ev.name, ev.ts - 5000, ev.ts + 5000]); const dup = exists.step(); exists.reset()
      if (dup) { skipped++; continue }
      db.run('INSERT INTO events (ts,type,name,detail,world,world_id) VALUES (?,?,?,?,?,?)',
        [ev.ts, ev.type, ev.name, ev.detail ? `${ev.detail} (VRCX import)` : '(VRCX import)', ev.world || '', ev.worldId || ''])
      ids.push(db.exec('SELECT last_insert_rowid()')[0].values[0][0])
      added++
    }
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch (_) {}
    exists.free()
    return { ok: false, error: 'Import failed: ' + err.message }
  }
  exists.free()
  trimEvents()
  // Count what's still there after the cap (older imported rows can't fit).
  let kept = 0
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    kept += db.exec(`SELECT count(*) FROM events WHERE id IN (${chunk.join(',')})`)[0].values[0][0]
  }
  persist()
  return { ok: true, imported: kept, duplicates: skipped, droppedByCap: added - kept + tooOld, cap: EVENTS_CAP }
}

function close () { try { if (db) { saveDb(db, dbPath) } } catch (_) {} }

module.exports = { init, log, list, logFeed, listFeed, clearFeed, instanceEvent, listInstances, instanceTimeline, playersMet, listWorldVisitsSince, mergeWorldVisit, countGroupInstanceVisits, clear, clearType, close, importVrcx, upsertNotif, listNotifs, unreadNotifCount, markAllNotifsRead, removeNotif, reconcileNotifs, clearNotifs }

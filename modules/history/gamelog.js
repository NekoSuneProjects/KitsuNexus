// modules/history/gamelog.js
// VRChat history / game-log stored in a real SQLite file via sql.js (WASM — no
// native build). Records player join/leave, friend added/removed, world visits,
// and custom alerts. The DB lives next to the app's user data. Runs in MAIN.

const fs = require('fs')
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
    db = new SQL.Database(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined)
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
  // Cap the events table so db.export() stays fast (keep most recent 8000).
  try { db.run('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY ts DESC LIMIT 8000)') } catch (_) {}
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, ts INTEGER, type TEXT, sender TEXT, message TEXT, world TEXT, link TEXT, read INTEGER DEFAULT 0
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS notification_history (
    id TEXT, ts INTEGER, type TEXT, sender TEXT, message TEXT, world TEXT, link TEXT, action TEXT, archivedAt INTEGER
  )`)
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
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (e) { console.warn('history save failed:', e.message) }
  }, 8000)
}

// type: 'join' | 'leave' | 'friend_add' | 'friend_remove' | 'world' | 'alert' | 'group'
function log (type, name, detail, world) {
  if (!db) return
  db.run('INSERT INTO events (ts,type,name,detail,world) VALUES (?,?,?,?,?)',
    [Date.now(), String(type), name || '', detail || '', world || ''])
  persist()
}

function list (opts = {}) {
  if (!db) return []
  const limit = Math.min(parseInt(opts.limit, 10) || 200, 1000)
  const where = opts.type ? ' WHERE type = :t' : ''
  const stmt = db.prepare(`SELECT id,ts,type,name,detail,world FROM events${where} ORDER BY ts DESC LIMIT ${limit}`)
  if (opts.type) stmt.bind({ ':t': opts.type })
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
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

// Import history from an existing VRCX SQLite DB (best-effort — VRCX schema varies).
async function importVrcx (filePath) {
  if (!SQL || !db) return { ok: false, error: 'History not initialised' }
  let bytes
  try { bytes = fs.readFileSync(filePath) } catch (_) { return { ok: false, error: 'VRCX database not found at ' + filePath } }
  let src
  try { src = new SQL.Database(bytes) } catch (e) { return { ok: false, error: 'Could not open VRCX DB: ' + e.message } }
  const toTs = v => { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : Date.now() }
  let imported = 0
  const tryTable = (sql, mapfn) => {
    try {
      const st = src.prepare(sql)
      while (st.step()) { const ev = mapfn(st.getAsObject()); if (ev) { db.run('INSERT INTO events (ts,type,name,detail,world) VALUES (?,?,?,?,?)', [ev.ts, ev.type, ev.name || '', ev.detail || '', ev.world || '']); imported++ } }
      st.free()
    } catch (_) { /* table not present in this VRCX version */ }
  }
  tryTable('SELECT created_at,type,display_name,location FROM gamelog_join_leave', r => ({ ts: toTs(r.created_at), type: /left/i.test(r.type || '') ? 'leave' : 'join', name: r.display_name, detail: '(VRCX import)', world: r.location }))
  tryTable('SELECT created_at,world_name,location FROM gamelog_location', r => ({ ts: toTs(r.created_at), type: 'world', name: r.world_name, detail: '(VRCX import)', world: r.location }))
  tryTable('SELECT created_at,type,display_name FROM gamelog_friend', r => ({ ts: toTs(r.created_at), type: /unfriend|remove|delete/i.test(r.type || '') ? 'friend_remove' : 'friend_add', name: r.display_name, detail: '(VRCX import)' }))
  try { src.close() } catch (_) {}
  persist()
  return { ok: true, imported }
}

function close () { try { if (db) { fs.writeFileSync(dbPath, Buffer.from(db.export())) } } catch (_) {} }

module.exports = { init, log, list, clear, clearType, close, importVrcx, upsertNotif, listNotifs, unreadNotifCount, markAllNotifsRead, removeNotif, reconcileNotifs, clearNotifs }

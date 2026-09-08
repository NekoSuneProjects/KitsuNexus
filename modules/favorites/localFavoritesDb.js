// modules/favorites/localFavoritesDb.js
// App-local "Local Favorites" store — independent of VRChat's own /favorites API.
// Lets the user favorite ANY user/world/avatar (friend or not) with a personal note
// and an arbitrary collection name. Stored in a real SQLite file via sql.js (WASM —
// no native build), same pattern as modules/history/gamelog.js and
// modules/ranks/rankDb.js. Runs in MAIN. Unlike those, the DB path is not fixed to
// app.getPath('userData') — callers pass an explicit path so it can be relocated.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

let SQL = null
let db = null
let dbPath = ''
let saveTimer = null

function defaultPath (userDataDir) {
  return path.join(userDataDir || os.tmpdir(), 'KitsuNexus-favorites.sqlite')
}

async function init (targetPath) {
  if (db && dbPath === targetPath) return true
  if (db) { flush(); db = null }
  let initSqlJs
  try { initSqlJs = require('sql.js') } catch (err) { console.warn('sql.js not installed:', err.message); return false }
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
  SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) })
  dbPath = targetPath || defaultPath()
  try { fs.mkdirSync(path.dirname(dbPath), { recursive: true }) } catch (_) {}
  try {
    db = new SQL.Database(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined)
  } catch (_) { db = new SQL.Database() }
  db.run(`CREATE TABLE IF NOT EXISTS local_favorites (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    vrchat_id TEXT NOT NULL,
    display_name TEXT,
    image_url TEXT,
    note TEXT,
    collection TEXT DEFAULT 'default',
    added_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_local_favorites_type ON local_favorites(type)')
  db.run('CREATE INDEX IF NOT EXISTS idx_local_favorites_vrchat_id ON local_favorites(vrchat_id)')
  // Migrations for DBs created before a column existed.
  try { db.run("ALTER TABLE local_favorites ADD COLUMN collection TEXT DEFAULT 'default'") } catch (_) {}
  try { db.run('ALTER TABLE local_favorites ADD COLUMN deleted_at INTEGER') } catch (_) {}
  return true
}

function getPath () { return dbPath }

function persist () {
  if (!db || !dbPath) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (e) { console.warn('local favorites save failed:', e.message) }
  }, 8000)
}

function flush () {
  clearTimeout(saveTimer)
  try { if (db && dbPath) fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (e) { console.warn('local favorites flush failed:', e.message) }
}

function findByTarget (type, vrchatId) {
  if (!db) return null
  const st = db.prepare('SELECT * FROM local_favorites WHERE type = :t AND vrchat_id = :v AND deleted_at IS NULL')
  st.bind({ ':t': type, ':v': vrchatId })
  let row = null
  if (st.step()) row = st.getAsObject()
  st.free()
  return row
}

function list (opts = {}) {
  if (!db) return []
  const conds = ['deleted_at IS NULL']
  const params = {}
  if (opts.type) { conds.push('type = :t'); params[':t'] = opts.type }
  if (opts.collection) { conds.push('collection = :c'); params[':c'] = opts.collection }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : ''
  const st = db.prepare(`SELECT * FROM local_favorites${where} ORDER BY added_at DESC`)
  st.bind(params)
  const out = []
  while (st.step()) out.push(st.getAsObject())
  st.free()
  return out
}

// Add, or update in place if this (type, vrchatId) is already favorited.
function add ({ type, vrchatId, displayName, imageUrl, note, collection }) {
  if (!db) return { ok: false, error: 'Local favorites not initialised' }
  if (!type || !vrchatId) return { ok: false, error: 'Missing type or id' }
  const now = Date.now()
  const existing = findByTarget(type, vrchatId)
  if (existing) {
    db.run('UPDATE local_favorites SET display_name=?, image_url=?, note=?, collection=?, updated_at=? WHERE id=?',
      [displayName || existing.display_name || '', imageUrl || existing.image_url || '', note != null ? note : existing.note || '', collection || existing.collection || 'default', now, existing.id])
    persist()
    return { ok: true, id: existing.id, updated: true }
  }
  const id = crypto.randomUUID()
  db.run('INSERT INTO local_favorites (id,type,vrchat_id,display_name,image_url,note,collection,added_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)',
    [id, type, vrchatId, displayName || '', imageUrl || '', note || '', collection || 'default', now, now])
  persist()
  return { ok: true, id }
}

function update (id, { note, collection, displayName, imageUrl } = {}) {
  if (!db || !id) return { ok: false, error: 'Missing id' }
  const st = db.prepare('SELECT * FROM local_favorites WHERE id = :id'); st.bind({ ':id': id })
  if (!st.step()) { st.free(); return { ok: false, error: 'Not found' } }
  const row = st.getAsObject(); st.free()
  db.run('UPDATE local_favorites SET note=?, collection=?, display_name=?, image_url=?, updated_at=? WHERE id=?',
    [note != null ? note : row.note || '', collection || row.collection || 'default', displayName != null ? displayName : row.display_name || '', imageUrl != null ? imageUrl : row.image_url || '', Date.now(), id])
  persist()
  return { ok: true }
}

// Soft delete — keeps a tombstone (deleted_at) so a future cloud sync can propagate removals.
function remove (id) {
  if (!db || !id) return { ok: false, error: 'Missing id' }
  db.run('UPDATE local_favorites SET deleted_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), id])
  persist()
  return { ok: true }
}

function isFavorited (type, vrchatId) { return !!findByTarget(type, vrchatId) }

// Like findByTarget, but also matches soft-deleted rows — needed when merging a remote
// tombstone against a row that might already be (or need to become) deleted locally.
function findByTargetAny (type, vrchatId) {
  if (!db) return null
  const st = db.prepare('SELECT * FROM local_favorites WHERE type = :t AND vrchat_id = :v')
  st.bind({ ':t': type, ':v': vrchatId })
  let row = null
  if (st.step()) row = st.getAsObject()
  st.free()
  return row
}

// Rows changed (added/edited/soft-deleted) since `ts` (ms epoch) — for pushing to cloud sync.
// Includes soft-deleted rows so tombstones propagate.
function listChangedSince (ts) {
  if (!db) return []
  const st = db.prepare('SELECT * FROM local_favorites WHERE updated_at > :ts ORDER BY updated_at ASC')
  st.bind({ ':ts': ts || 0 })
  const out = []
  while (st.step()) out.push(st.getAsObject())
  st.free()
  return out
}

// Applies one favorite pulled from cloud sync, using the same last-write-wins rule as
// importAll(). `item` uses the same snake_case shape as a DB row (deleted_at truthy = tombstone).
function mergeRemote (item) {
  if (!db || !item || !item.type || !item.vrchat_id) return
  const existing = findByTargetAny(item.type, item.vrchat_id)
  if (existing && (existing.updated_at || 0) >= (item.updated_at || 0)) return
  if (item.deleted_at) {
    if (existing) db.run('UPDATE local_favorites SET deleted_at=?, updated_at=? WHERE id=?', [item.deleted_at, item.updated_at, existing.id])
    persist()
    return
  }
  if (existing) {
    db.run('UPDATE local_favorites SET display_name=?, image_url=?, note=?, collection=?, updated_at=?, deleted_at=NULL WHERE id=?',
      [item.display_name || '', item.image_url || '', item.note || '', item.collection || 'default', item.updated_at || Date.now(), existing.id])
  } else {
    db.run('INSERT INTO local_favorites (id,type,vrchat_id,display_name,image_url,note,collection,added_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)',
      [crypto.randomUUID(), item.type, item.vrchat_id, item.display_name || '', item.image_url || '', item.note || '', item.collection || 'default', item.added_at || item.updated_at || Date.now(), item.updated_at || Date.now()])
  }
  persist()
}

function exportAll () {
  return { version: 1, exportedAt: Date.now(), favorites: list() }
}

// Merges by (type, vrchat_id) — newer updated_at wins, matching the future cloud-sync rule.
function importAll (data) {
  if (!db || !data || !Array.isArray(data.favorites)) return { ok: false, error: 'Invalid file' }
  let imported = 0
  for (const f of data.favorites) {
    if (!f || !f.type || !f.vrchat_id) continue
    const existing = findByTarget(f.type, f.vrchat_id)
    if (existing && (existing.updated_at || 0) >= (f.updated_at || 0)) continue
    if (existing) {
      db.run('UPDATE local_favorites SET display_name=?, image_url=?, note=?, collection=?, updated_at=? WHERE id=?',
        [f.display_name || '', f.image_url || '', f.note || '', f.collection || 'default', f.updated_at || Date.now(), existing.id])
    } else {
      db.run('INSERT INTO local_favorites (id,type,vrchat_id,display_name,image_url,note,collection,added_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)',
        [crypto.randomUUID(), f.type, f.vrchat_id, f.display_name || '', f.image_url || '', f.note || '', f.collection || 'default', f.added_at || Date.now(), f.updated_at || Date.now()])
    }
    imported++
  }
  persist()
  return { ok: true, imported }
}

function close () { flush() }

module.exports = { init, getPath, defaultPath, list, add, update, remove, isFavorited, exportAll, importAll, close, listChangedSince, mergeRemote }

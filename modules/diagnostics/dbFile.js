'use strict'

// modules/diagnostics/dbFile.js
// Safe load/save for the sql.js databases (history, local favorites, ranks).
//
// sql.js keeps the whole DB in memory and we write it out with db.export().
// Writing that straight over the live file meant a crash, kill or power loss
// mid-write left a truncated file. The loader then silently started an empty
// DB, and the next save overwrote the damaged file, so all history was lost.
//
//   save: write <file>.tmp, then swap it in; the previous good copy is kept as <file>.bak
//   load: open <file>; if it's unreadable try <file>.bak; if both fail, the
//         broken file is renamed to <file>.corrupt-<time> (kept, never
//         overwritten) and a fresh DB starts.

const fs = require('fs')

function tryOpen (SQL, file) {
  if (!fs.existsSync(file)) return null
  const bytes = fs.readFileSync(file)
  if (!bytes.length) return null
  const db = new SQL.Database(bytes)
  try {
    // Forces SQLite to actually read the header + schema; a damaged file
    // throws here ("file is not a database" / "malformed").
    db.exec('SELECT count(*) FROM sqlite_master')
    return db
  } catch (err) {
    try { db.close() } catch (_) {}
    throw err
  }
}

// Returns { db, restored: '' | 'backup' | 'fresh', error }
function openDb (SQL, file) {
  try {
    const db = tryOpen(SQL, file)
    if (db) return { db, restored: '' }
    // Missing/empty main file: a crash between the two renames in saveDb can
    // leave only the .bak, so look there before starting fresh.
    const bak = tryOpen(SQL, file + '.bak')
    if (bak) return { db: bak, restored: 'backup' }
    return { db: new SQL.Database(), restored: '' }
  } catch (err) {
    let bak = null
    try { bak = tryOpen(SQL, file + '.bak') } catch (_) {}
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`) } catch (_) {}
    console.warn(`[db] ${file} could not be opened (${err.message}); ${bak ? 'restored the last backup' : 'starting a new one'} - the damaged file was kept as .corrupt-*`)
    return { db: bak || new SQL.Database(), restored: bak ? 'backup' : 'fresh', error: err.message }
  }
}

function saveDb (db, file) {
  const tmp = file + '.tmp'
  const data = Buffer.from(db.export())
  const fd = fs.openSync(tmp, 'w')
  try { fs.writeSync(fd, data, 0, data.length, 0); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try {
    if (fs.existsSync(file)) {
      try { fs.rmSync(file + '.bak', { force: true }) } catch (_) {}
      fs.renameSync(file, file + '.bak')
    }
    fs.renameSync(tmp, file)
  } catch (err) {
    // Rename can be refused on Windows (antivirus / indexer holding the file).
    // Fall back to a direct write; the .bak copy is still there.
    fs.writeFileSync(file, data)
    try { fs.rmSync(tmp, { force: true }) } catch (_) {}
    if (!/EPERM|EBUSY|EACCES/.test(err.code || '')) throw err
  }
}

module.exports = { openDb, saveDb }

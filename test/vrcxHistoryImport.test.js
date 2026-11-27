'use strict'
// History "Import VRCX" against VRCX's current schema (src/services/database/index.js).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-vrcx-'))
let gamelog, SQL

test.before(async () => {
  gamelog = require('../modules/history/gamelog')
  await gamelog.init(dir)
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs({ locateFile: f => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), f) })
})
test.after(() => { try { gamelog.close() } catch (_) {} })

function vrcxFile () {
  const db = new SQL.Database()
  db.run('CREATE TABLE gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT)')
  db.run('CREATE TABLE gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER)')
  db.run('CREATE TABLE usr88e0a1ad10a543ed81557b7886bfb3f9_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)')
  const loc = 'wrld_4a65ba53-d8df-40a7-b67d-30c63bff0e95:07696~region(us)'
  db.run('INSERT INTO gamelog_location (created_at,location,world_id,world_name) VALUES (?,?,?,?)', ['2026-11-20T10:00:00.000Z', loc, 'wrld_4a65ba53-d8df-40a7-b67d-30c63bff0e95', 'Drinking Night'])
  db.run('INSERT INTO gamelog_join_leave (created_at,type,display_name,location) VALUES (?,?,?,?)', ['2026-11-20T10:01:00.000Z', 'OnPlayerJoined', 'FumikoEcho', loc])
  db.run('INSERT INTO gamelog_join_leave (created_at,type,display_name,location) VALUES (?,?,?,?)', ['2026-11-20T10:30:00.000Z', 'OnPlayerLeft', 'FumikoEcho', loc])
  db.run('INSERT INTO usr88e0a1ad10a543ed81557b7886bfb3f9_friend_log_history (created_at,type,display_name) VALUES (?,?,?)', ['2026-11-21T09:00:00.000Z', 'Friend', 'NewPal'])
  db.run('INSERT INTO usr88e0a1ad10a543ed81557b7886bfb3f9_friend_log_history (created_at,type,display_name,previous_display_name) VALUES (?,?,?,?)', ['2026-11-21T09:05:00.000Z', 'DisplayName', 'NewName', 'OldName'])
  db.run('INSERT INTO usr88e0a1ad10a543ed81557b7886bfb3f9_friend_log_history (created_at,type,display_name) VALUES (?,?,?)', ['2026-11-21T09:06:00.000Z', 'FriendRequest', 'Someone'])
  const file = path.join(dir, 'VRCX.sqlite3')
  fs.writeFileSync(file, Buffer.from(db.export()))
  return file
}

test('imports locations, joins/leaves (with world name) and the per-user friend log', async () => {
  const r = await gamelog.importVrcx(vrcxFile())
  assert.equal(r.ok, true)
  assert.equal(r.imported, 5, 'world + join + leave + friend + name change (friend request skipped)')
  const join = gamelog.list({ type: 'join' })[0]
  assert.equal(join.name, 'FumikoEcho')
  assert.equal(join.world, 'Drinking Night')
  assert.equal(gamelog.list({ type: 'world' })[0].world_id, 'wrld_4a65ba53-d8df-40a7-b67d-30c63bff0e95')
  assert.equal(gamelog.list({ type: 'friend_add' })[0].name, 'NewPal')
  assert.match(gamelog.list({ type: 'name_change' })[0].detail, /OldName → NewName/)
})

test('re-importing adds nothing', async () => {
  const r = await gamelog.importVrcx(path.join(dir, 'VRCX.sqlite3'))
  assert.equal(r.ok, true)
  assert.equal(r.imported, 0)
  assert.equal(r.duplicates, 5)
})

test('a file that is not a database is rejected instead of "0 imported"', async () => {
  const junk = path.join(dir, 'junk.bin')
  fs.writeFileSync(junk, 'definitely not sqlite '.repeat(40))
  const r = await gamelog.importVrcx(junk)
  assert.equal(r.ok, false)
})

test('a database without VRCX tables is rejected', async () => {
  const other = new SQL.Database(); other.run('CREATE TABLE something (a)')
  const file = path.join(dir, 'other.sqlite'); fs.writeFileSync(file, Buffer.from(other.export()))
  const r = await gamelog.importVrcx(file)
  assert.equal(r.ok, false)
  assert.match(r.error, /No VRCX history tables/)
})

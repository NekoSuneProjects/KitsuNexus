'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const favs = require('../modules/favorites/localFavoritesDb')

// Tables exactly as VRCX creates them (src/services/database/index.js).
async function vrcxDb () {
  const SQL = await require('sql.js')({ locateFile: f => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), f) })
  const db = new SQL.Database()
  db.run('CREATE TABLE cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)')
  db.run('CREATE TABLE cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)')
  db.run('CREATE TABLE favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)')
  db.run('CREATE TABLE favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)')
  db.run('CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)')
  db.run('CREATE TABLE usr0123abcd_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)')
  db.run("INSERT INTO cache_avatar (id,name,thumbnail_image_url) VALUES ('avtr_1','Fox','https://t/1.png')")
  db.run("INSERT INTO favorite_avatar (created_at,avatar_id,group_name) VALUES ('2025-01-02T03:04:05Z','avtr_1','Cute'),('2025-01-02T03:04:05Z','avtr_nocache','Cute')")
  db.run("INSERT INTO cache_world (id,name) VALUES ('wrld_1','Black Cat')")
  db.run("INSERT INTO favorite_world (created_at,world_id,group_name) VALUES ('2025-01-01','wrld_1','Chill')")
  db.run("INSERT INTO usr0123abcd_friend_log_current (user_id,display_name) VALUES ('usr_a','Alice')")
  db.run("INSERT INTO favorite_friend (created_at,user_id,group_name) VALUES ('2025-01-01','usr_a','Besties')")
  return Buffer.from(db.export())
}

test('imports VRCX favourites into local favourites, re-import is a no-op', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-fav-'))
  assert.ok(await favs.init(path.join(dir, 'f.sqlite')))
  favs.add({ type: 'world', vrchatId: 'wrld_1', displayName: 'Black Cat', note: 'my note' }) // already favourited here
  const bytes = await vrcxDb()
  const r = favs.importVrcx(bytes)
  assert.deepEqual({ ...r }, { ok: true, imported: 3, avatar: 2, world: 0, friend: 1, skipped: 1 })
  const fox = favs.list({ type: 'avatar' }).find(f => f.vrchat_id === 'avtr_1')
  assert.equal(fox.display_name, 'Fox'); assert.equal(fox.image_url, 'https://t/1.png'); assert.equal(fox.collection, 'VRCX: Cute')
  assert.equal(fox.added_at, Date.parse('2025-01-02T03:04:05Z'))
  assert.equal(favs.list({ type: 'friend' })[0].display_name, 'Alice')
  assert.equal(favs.list({ type: 'world' })[0].note, 'my note') // existing entry untouched
  assert.equal(favs.importVrcx(bytes).imported, 0)
  assert.equal(favs.importVrcx(Buffer.from('not a db')).ok, false)
  favs.close()
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { openDb, saveDb } = require('../modules/diagnostics/dbFile')

let SQL
test.before(async () => {
  const initSqlJs = require('sql.js')
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
  SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) })
})

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kn-db-')), 'test.sqlite')
const rowsOf = db => db.exec('SELECT v FROM t ORDER BY v')[0]?.values.map(r => r[0]) || []

function makeDb (values) {
  const db = new SQL.Database()
  db.run('CREATE TABLE t (v INTEGER)')
  for (const v of values) db.run('INSERT INTO t VALUES (?)', [v])
  return db
}

test('save + load round-trips and keeps the previous copy as .bak', () => {
  const file = tmpFile()
  saveDb(makeDb([1]), file)
  saveDb(makeDb([1, 2]), file)
  assert.deepEqual(rowsOf(openDb(SQL, file).db), [1, 2])
  assert.ok(fs.existsSync(file + '.bak'))
  assert.ok(!fs.existsSync(file + '.tmp'))
})

test('a truncated (half-written) file restores the last backup instead of wiping history', () => {
  const file = tmpFile()
  saveDb(makeDb([1, 2, 3]), file)
  saveDb(makeDb([1, 2, 3, 4]), file)
  const good = fs.readFileSync(file)
  fs.writeFileSync(file, good.subarray(0, 100)) // simulated crash mid-write
  const r = openDb(SQL, file)
  assert.equal(r.restored, 'backup')
  assert.deepEqual(rowsOf(r.db), [1, 2, 3])
  const kept = fs.readdirSync(path.dirname(file)).filter(f => f.includes('.corrupt-'))
  assert.equal(kept.length, 1, 'damaged file is kept, not overwritten')
})

test('garbage with no backup starts fresh but keeps the damaged file', () => {
  const file = tmpFile()
  fs.writeFileSync(file, Buffer.from('this is not a database at all, definitely not'))
  const r = openDb(SQL, file)
  assert.equal(r.restored, 'fresh')
  assert.doesNotThrow(() => r.db.run('CREATE TABLE IF NOT EXISTS x (a)'))
  assert.equal(fs.readdirSync(path.dirname(file)).filter(f => f.includes('.corrupt-')).length, 1)
})

test('missing main file but present .bak (crash between renames) uses the backup', () => {
  const file = tmpFile()
  saveDb(makeDb([7]), file)
  fs.renameSync(file, file + '.bak')
  const r = openDb(SQL, file)
  assert.equal(r.restored, 'backup')
  assert.deepEqual(rowsOf(r.db), [7])
})

test('no file at all gives an empty DB', () => {
  const r = openDb(SQL, tmpFile())
  assert.equal(r.restored, '')
  assert.doesNotThrow(() => r.db.run('CREATE TABLE x (a)'))
})

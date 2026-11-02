'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { LocalHistory, normalizeEvent, prune, safeCsv } = require('../modules/vrchat/history/localHistory')
test('history validates event types and timestamps', () => {
  assert.throws(() => normalizeEvent({ kind: 'private-profile' }))
  assert.throws(() => normalizeEvent({ kind: 'world', at: Date.now() + 1000000 }))
  assert.equal(normalizeEvent({ kind: 'encounter', name: 'a\nb' }).name, 'a b')
})
test('history prunes old entries and bounds results', () => {
  const now = Date.now()
  const entries = Array.from({ length: 10 }, (_, i) => ({ kind: 'world', at: now - i * 86400000 }))
  assert.equal(prune(entries, { retentionDays: 3, limit: 2 }, now).length, 2)
})
test('CSV protects spreadsheet formulas', () => {
  assert.equal(safeCsv('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(safeCsv('ordinary'), '"ordinary"')
})
test('history persists with a schema and supports clearing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-history-'))
  try {
    const file = path.join(dir, 'history.json')
    const history = new LocalHistory(file)
    assert.deepEqual(history.load(), [])
    history.add({ kind: 'world', worldId: 'wrld_test', name: 'Test' })
    assert.equal(new LocalHistory(file).load().length, 1)
    assert.match(history.exportCsv(), /wrld_test/)
    history.clear()
    assert.equal(new LocalHistory(file).load().length, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('retention changes delete expired data persistently and reject invalid policies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-retention-'))
  try {
    const file = path.join(dir, 'history.json')
    const history = new LocalHistory(file)
    history.add({ kind: 'encounter', name: 'Old', at: Date.now() - 10 * 86400000 })
    history.add({ kind: 'world', name: 'Current' })
    for (const retentionDays of [0, 366, 1.5, Infinity, 'invalid']) assert.throws(() => history.configure({ retentionDays }))
    assert.equal(history.list().length, 2)
    history.configure({ retentionDays: 7 })
    assert.deepEqual(new LocalHistory(file).load().map(e => e.name), ['Current'])
    assert.doesNotMatch(history.exportCsv(), /Old/)
    history.items.push({ kind: 'encounter', name: 'Expired', at: Date.now() - 400 * 86400000 })
    assert.equal(history.list().length, 1)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).events.length, 1)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

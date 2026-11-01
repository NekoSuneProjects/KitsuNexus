'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { snapshot, toCsv, safeCsv } = require('../modules/vrchat/world/worldSnapshotExport')

test('exports public local snapshot fields without credentials', () => {
  const data = snapshot({ worldName: 'Demo', worldId: 'wrld_example', instanceId: '123', players: ['Alice', 'Bob'], password: 'secret', authCookie: 'hidden' }, new Date('2026-11-01T12:00:00Z'))
  assert.equal(data.worldName, 'Demo')
  assert.deepEqual(data.players, ['Alice', 'Bob'])
  assert.equal(data.password, undefined)
  assert.equal(data.authCookie, undefined)
  assert.equal(data.recordedAt, '2026-11-01T12:00:00.000Z')
})
test('CSV quotes special values and guards formula injection', () => {
  const csv = toCsv(snapshot({ worldName: 'A,"B"', players: ['=1+1', '+danger'] }))
  assert.match(csv, /"A,""B"""/)
  assert.match(csv, /"'=1\+1"/)
  assert.match(csv, /"'\+danger"/)
  assert.equal(safeCsv('hello'), '"hello"')
})
test('limits player count and handles malformed inputs', () => {
  const data = snapshot({ players: [...Array(210)].map((_, i) => String(i)).concat(null, {}) })
  assert.equal(data.players.length, 200)
  assert.equal(toCsv(data).split('\r\n').length, 202)
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createServerStatus, parseSummary } = require('../modules/vrchat/status/serverStatus')

const ok = { status: { indicator: 'none', description: 'All Systems Operational' }, components: [{ name: 'API', status: 'operational' }], incidents: [] }
const bad = { status: { indicator: 'major', description: 'Partial System Outage' }, components: [{ name: 'API', status: 'major_outage' }, { name: 'Group', status: 'degraded_performance', group: true }], incidents: [{ name: 'Login issues', status: 'investigating' }, { name: 'Old', status: 'resolved' }] }

test('parses status.vrchat.com summary', () => {
  assert.deepEqual(parseSummary(ok), { ok: true, indicator: 'none', description: 'All Systems Operational', components: [], incidents: [] })
  const b = parseSummary(bad)
  assert.equal(b.ok, false); assert.deepEqual(b.components, ['API']); assert.deepEqual(b.incidents, ['Login issues'])
  assert.equal(parseSummary(null), null)
})

test('reports changes only, ignores failed fetches', async () => {
  const seq = [ok, ok, null, bad, bad, ok]
  const changes = []
  const s = createServerStatus({ fetchJson: async () => seq.shift(), onChange: (cur, prev) => changes.push([cur.ok, prev ? prev.ok : null]) })
  for (let i = 0; i < 6; i++) await s.poll()
  assert.deepEqual(changes, [[true, null], [false, true], [true, false]])
  assert.equal(s.current().ok, true)
})

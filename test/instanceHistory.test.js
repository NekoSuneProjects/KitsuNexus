'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const gamelog = require('../modules/history/gamelog')
const world = require('../modules/vrchat/world/vrchatWorld')

const L = (t, text) => `2026.11.17 ${t} Debug      -  ${text}`
const LOG = [
  L('10:00:00', '[Behaviour] Joining wrld_aaa:111~friends(usr_x)~region(eu)'),
  L('10:00:01', '[Behaviour] Joining or Creating Room: The Black Cat'),
  L('10:00:05', '[Behaviour] OnPlayerJoined Me (usr_me)'),
  L('10:00:05', '[Behaviour] OnPlayerJoined Alice (usr_a)'),
  L('10:10:00', '[Behaviour] OnPlayerJoined Bob (usr_b)'),
  L('10:20:00', '[Behaviour] OnPlayerLeft Bob (usr_b)'),
  L('10:30:00', '[Behaviour] OnLeftRoom'),
  L('10:31:00', '[Behaviour] Joining wrld_bbb:222'),
  L('10:31:01', '[Behaviour] Joining or Creating Room: Movie Night'),
  L('10:31:05', '[Behaviour] OnPlayerJoined Alice (usr_a)')
]

test('instance history from the log: sessions, stays, players met; replay is idempotent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-hist-'))
  assert.ok(await gamelog.init(dir))
  world.setEventListener(e => gamelog.instanceEvent(e))
  for (let pass = 0; pass < 2; pass++) LOG.forEach(l => world._processLine(l)) // second pass = app restart replay

  const inst = gamelog.listInstances()
  assert.equal(inst.length, 2)
  assert.equal(inst[0].worldName, 'Movie Night'); assert.equal(inst[0].leftAt, null)
  assert.equal(inst[1].worldName, 'The Black Cat'); assert.equal(inst[1].players, 3)
  assert.equal(inst[1].leftAt - inst[1].joinedAt, 30 * 60 * 1000)

  const tl = gamelog.instanceTimeline(inst[1].id)
  const bob = tl.players.find(p => p.name === 'Bob')
  assert.equal(bob.leftAt - bob.joinedAt, 10 * 60 * 1000)
  assert.equal(tl.players.find(p => p.name === 'Alice').leftAt, inst[1].leftAt) // closed with the instance

  const met = gamelog.playersMet({ excludeName: 'Me' })
  assert.deepEqual(met.map(m => m.name).sort(), ['Alice', 'Bob'])
  const alice = met.find(m => m.name === 'Alice')
  assert.equal(alice.timesMet, 2); assert.equal(alice.userId, 'usr_a'); assert.equal(alice.lastWorld, 'Movie Night')
  assert.equal(gamelog.playersMet({ userId: 'usr_b' })[0].totalMs, 10 * 60 * 1000)
  assert.equal(gamelog.listInstances({ search: 'Black' }).length, 1)
  world.setEventListener(null)
  gamelog.close()
})

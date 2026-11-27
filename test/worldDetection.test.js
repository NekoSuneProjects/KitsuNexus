'use strict'
// World / instance detection against real current-VRChat log line formats.
const test = require('node:test')
const assert = require('node:assert/strict')
const world = require('../modules/vrchat/world/vrchatWorld')

const L = (text, t = '2026.11.27 09:55:22') => `${t} Debug      -  ${text}`
const WID = 'wrld_3c231334-2f20-442f-924c-a504d9f98543'
const INST = '69510~group(grp_f11ee786-7110-41a4-8bf6-76525a28e438)~groupAccessType(members)~ageGate~region(use)'

function enter () {
  world._processLine(L('[Behaviour] Entering Room: Just B Club 4․0'))
  world._processLine(L(`[Behaviour] Joining ${WID}:${INST}`))
  world._processLine(L('[Behaviour] Joining or Creating Room: Just B Club 4․0'))
  world._processLine(L('[Behaviour] OnPlayerJoined FumikoEcho (usr_6e6bb19c-67c8-4593-882c-47fd7ed76b8d)'))
  world._processLine(L('[Behaviour] OnPlayerJoined -spiritwolf- (usr_7c76921e-a4b6-4daf-a855-b256074ba3af)'))
}

test('detects world, instance, group and players from a real join sequence', () => {
  world._processLine(L('[Behaviour] OnLeftRoom'))
  enter()
  const s = world.getVrcWorld()
  assert.equal(s.inWorld, true)
  assert.equal(s.worldId, WID)
  assert.equal(s.instanceId, INST)
  assert.equal(s.groupId, 'grp_f11ee786-7110-41a4-8bf6-76525a28e438')
  assert.equal(s.worldName, 'Just B Club 4․0')
  assert.deepEqual(s.players, ['FumikoEcho', '-spiritwolf-'])
})

test('exception stack traces mentioning OnLeftRoom do not drop the world', () => {
  enter()
  world._processLine('  at ÎÍÌÎÌÍÎÎÍÍÍÎÎÍÎÍÏÏÌÏÌÎÏ.OnLeftRoom () [0x00000] in <00000000000000000000000000000000>:0 ')
  world._processLine(L('[UdonBehaviour] Debug: OnPlayerJoined Fake Person'))
  world._processLine(L('[MyWorld] Joining wrld_00000000-0000-0000-0000-000000000000:1'))
  const s = world.getVrcWorld()
  assert.equal(s.inWorld, true)
  assert.equal(s.worldId, WID)
  assert.deepEqual(s.players, ['FumikoEcho', '-spiritwolf-'])
})

test('[PlayerLog] duplicate join lines are not counted as extra players', () => {
  enter()
  world._processLine(L('[PlayerLog] OnPlayerJoined: FumikoEcho (VR=True)'))
  assert.equal(world.getVrcWorld().players.length, 2)
})

test('VRChat quitting while in a world leaves the world', () => {
  const events = []
  world.setEventListener(e => events.push(e))
  enter()
  world._processLine(L('VRCApplication: HandleApplicationQuit at 8748.678', '2026.11.27 23:04:04'))
  world.setEventListener(null)
  const s = world.getVrcWorld()
  assert.equal(s.inWorld, false)
  assert.equal(s.worldId, '')
  assert.deepEqual(s.players, [])
  assert.ok(events.some(e => e.type === 'left'), 'emits a left event so instance history closes the visit')
})

test('the local user is read from the current "post login checks" line', () => {
  world._processLine(L('[Authentication - ÎÍÎÏÏÌÍÌÏÏÍÏÎÌÌÏÌÏÌÍÏÌÍ] Preforming post login checks for NekoSuneVR (usr_88e0a1ad-10a5-43ed-8155-7b7886bfb3f9)'))
  const s = world.getVrcWorld()
  assert.equal(s.userDisplayName, 'NekoSuneVR')
  assert.equal(s.userId, 'usr_88e0a1ad-10a5-43ed-8155-7b7886bfb3f9')
})

test('VRChat no longer running (crash) leaves the world after the log goes quiet', async () => {
  enter()
  world._setIsVrchatRunning(cb => cb(false))
  const quietSince = Date.now() - 5 * 60000
  world._checkVrchatGone(quietSince)
  await new Promise(r => setImmediate(r))
  assert.equal(world.getVrcWorld().inWorld, false)
})

test('a quiet log while VRChat is still running keeps the world', async () => {
  enter()
  world._setIsVrchatRunning(cb => cb(true))
  world._checkVrchatGone(Date.now() - 5 * 60000)
  await new Promise(r => setImmediate(r))
  assert.equal(world.getVrcWorld().inWorld, true)
  // recent log activity: no process check at all
  let called = false
  world._setIsVrchatRunning(cb => { called = true; cb(false) })
  world._checkVrchatGone(Date.now())
  assert.equal(called, false)
})

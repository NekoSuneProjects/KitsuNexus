'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

const pushes = []
class FakeClient {
  constructor () { this.handlers = {} }
  on (ev, fn) { this.handlers[ev] = fn }
  async login () { setImmediate(() => this.handlers.ready && this.handlers.ready()) }
  async setActivity (a) { pushes.push(a) }
  async destroy () {}
}
const origLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'discord-rpc') return { Client: FakeClient }
  return origLoad.call(this, request, ...rest)
}
const discord = require('../modules/integrations/discord/discord')
const { modeFromCommandLine } = require('../modules/vrchat/tools/vrMode')
const wait = () => new Promise(r => setTimeout(r, 5200)) // presence pushes are throttled to one per 5s

test('VR / Desktop from VRChat.exe command line', () => {
  assert.equal(modeFromCommandLine('"C:\\VRChat\\VRChat.exe" --no-vr --profile=0'), 'desktop')
  assert.equal(modeFromCommandLine('"C:\\VRChat\\VRChat.exe" --profile=0'), 'vr')
  assert.equal(modeFromCommandLine(''), '')
})

test('party size, instance label, platform and private-instance hiding', async () => {
  await discord.startDiscord({ clientId: '123', enableRichPresence: true })
  await new Promise(r => setTimeout(r, 20))
  discord.setVrcContext({ vrcStatus: 'active', worldName: 'The Black Cat', joinUrl: 'https://vrchat.com/home/launch?x', instanceType: 'friends+', instanceKey: 'abc', playerCount: 5, capacity: 32, platform: 'vr' })
  await wait()
  let a = pushes.at(-1)
  assert.equal(a.partyId, 'abc'); assert.equal(a.partySize, 5); assert.equal(a.partyMax, 32)
  assert.match(a.state, /In The Black Cat \(Friends\+\)/)
  assert.match(a.details, /\(VR\)/)

  // over capacity -> max lifted
  discord.setVrcContext({ playerCount: 40 })
  await wait()
  a = pushes.at(-1)
  assert.equal(a.partySize, 40); assert.equal(a.partyMax, 40)

  // Invite instance hides the world, party and join button even on Active
  discord.setVrcContext({ instanceType: 'invite' })
  await wait()
  a = pushes.at(-1)
  assert.doesNotMatch(a.state, /Black Cat/)
  assert.equal(a.partyId, undefined)
  assert.ok(!(a.buttons || []).some(b => /Join World/.test(b.label)))

  // ...unless the user turns that off
  discord.setVrcContext({ hidePrivateInstances: false })
  await wait()
  assert.match(pushes.at(-1).state, /In The Black Cat \(Invite\)/)
  await discord.stopDiscord()
})

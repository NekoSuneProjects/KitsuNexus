'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('module')

// Fake discord-rpc client that records every presence push.
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

const world = require('../modules/vrchat/world/vrchatWorld')
const discord = require('../modules/integrations/discord/discord')

const ts = d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
const ppLine = (obj, when = new Date()) => `${ts(when)} Debug      -  [VRCX] VideoPlay(PopcornPalace) ${JSON.stringify(obj)}`

test('parses the Popcorn Palace log line and clears it on world change', () => {
  world._processLine('2026.11.17 08:00:00 Debug      -  [Behaviour] Joining wrld_266523e8-9161-40da-acd0-6bd82e075833:12345~region(eu)')
  world._processLine(ppLine({ videoName: 'How to Train Your Dragon - 2025-06-06', videoPos: 60, videoLength: 6000, thumbnailUrl: 'https://img.example/poster.jpg', displayName: 'miner28_3', isPaused: false }))
  const pp = world.getVrcWorld().popcornPalace
  assert.equal(pp.videoName, 'How to Train Your Dragon - 2025-06-06')
  assert.equal(pp.thumbnailUrl, 'https://img.example/poster.jpg')
  assert.ok(pp.endsAt > Date.now())
  assert.ok(Math.abs(pp.endsAt - pp.startedAt - 6000 * 1000) < 2000)

  // non-https thumbnails are dropped, empty name clears
  world._processLine(ppLine({ videoName: 'X', thumbnailUrl: 'javascript:alert(1)' }))
  assert.equal(world.getVrcWorld().popcornPalace.thumbnailUrl, '')
  world._processLine(ppLine({ videoName: '' }))
  assert.equal(world.getVrcWorld().popcornPalace, null)

  world._processLine(ppLine({ videoName: 'Y', videoPos: 1, videoLength: 100 }))
  world._processLine('2026.11.17 08:10:00 Debug      -  [Behaviour] OnLeftRoom')
  assert.equal(world.getVrcWorld().popcornPalace, null)
  // malformed JSON is ignored, not thrown
  assert.doesNotThrow(() => world._processLine('[VRCX] VideoPlay(PopcornPalace) {broken'))
})

test('Discord presence uses the movie poster as the big icon', async () => {
  await discord.startDiscord({ clientId: '123', enableRichPresence: true })
  await new Promise(r => setTimeout(r, 20))
  pushes.length = 0
  const now = Date.now()
  discord.setVrcContext({
    worldName: 'Popcorn Palace',
    vrcStatus: 'active',
    popcornPalace: { videoName: 'Dune', thumbnailUrl: 'https://img.example/dune.jpg', isPaused: false, startedAt: now - 60000, endsAt: now + 600000 }
  })
  await new Promise(r => setTimeout(r, 6000)) // presence pushes are throttled to one per 5s
  const a = pushes.at(-1)
  assert.ok(a, 'presence was pushed')
  assert.equal(a.largeImageKey, 'https://img.example/dune.jpg')
  assert.equal(a.largeImageText, 'Dune')
  assert.equal(a.smallImageKey, 'logo')
  assert.match(a.details, /Dune/)
  assert.match(a.state, /Watching in Popcorn Palace/)
  assert.equal(a.endTimestamp, Math.round(now + 600000))

  // Ask Me / DND hide only the world name + join button; the movie stays.
  pushes.length = 0
  discord.setVrcContext({ vrcStatus: 'busy' })
  await new Promise(r => setTimeout(r, 6000))
  const b = pushes.at(-1)
  assert.equal(b.largeImageKey, 'https://img.example/dune.jpg')
  assert.match(b.details, /Dune/)
  assert.match(b.state, /Watching a movie/)
  assert.doesNotMatch(b.state, /Popcorn Palace/)
  assert.ok(!(b.buttons || []).some(x => /Join World/.test(x.label)))
  await discord.stopDiscord()
})

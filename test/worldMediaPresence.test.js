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
const { createWorldMediaTracker, youtubeId } = require('../modules/vrchat/world/worldMedia')

const ts = d => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ` +
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
const L = text => `${ts(new Date())} Debug      -  ${text}`
const ppLine = obj => L(`[VRCX] VideoPlay(PopcornPalace) ${JSON.stringify(obj)}`)
const tick = () => new Promise(r => setImmediate(r))

test('world tracker: Popcorn Palace parsed and cleared on world change', () => {
  world._processLine(L('[Behaviour] Joining wrld_266523e8-9161-40da-acd0-6bd82e075833:12345~region(eu)'))
  world._processLine(ppLine({ videoName: 'How to Train Your Dragon', videoPos: 60, videoLength: 6000, thumbnailUrl: 'https://img.example/poster.jpg', isPaused: false }))
  const m = world.getVrcWorld().media
  assert.equal(m.source, 'PopcornPalace')
  assert.equal(m.videoName, 'How to Train Your Dragon')
  assert.equal(m.thumbnailUrl, 'https://img.example/poster.jpg')
  assert.ok(Math.abs(m.endsAt - m.startedAt - 6000 * 1000) < 2000)

  world._processLine(ppLine({ videoName: 'X', thumbnailUrl: 'javascript:alert(1)' }))
  assert.equal(world.getVrcWorld().media.thumbnailUrl, '')
  world._processLine(ppLine({ videoName: '' }))
  assert.equal(world.getVrcWorld().media, null)
  world._processLine(ppLine({ videoName: 'Y', videoPos: 1, videoLength: 100 }))
  world._processLine(L('[Behaviour] OnLeftRoom'))
  assert.equal(world.getVrcWorld().media, null)
  assert.doesNotThrow(() => world._processLine('[VRCX] VideoPlay(PopcornPalace) {broken'))
})

test('world tracker: SDK2 / USharpVideo / AVPro URLs reach the media-link history', () => {
  world._processLine(L('User Natsumi-sama added URL https://example.com/a.mp4'))
  assert.equal(world.getVrcWorld().lastVideo, 'https://example.com/a.mp4')
  world._processLine(L('[USharpVideo] Started video load for URL: https://example.com/b.mp4, requested by Someone'))
  assert.equal(world.getVrcWorld().lastVideo, 'https://example.com/b.mp4')
  world._processLine(L("[Video Playback] Resolving URL 'rtspt://topaz.chat/live/x'"))
  assert.equal(world.getVrcWorld().lastVideo, 'rtspt://topaz.chat/live/x')
})

test('media: VR Dancing, LS Media and ProTV nowplaying', async () => {
  const t = createWorldMediaTracker({ lookupTitle: async () => 'YT Title' })
  t.processLine(L('[VRCX] VideoPlay(VRDancing) "https://x/1",10,200,5,"Bob","<b>[12]</b> Cool Song"'))
  let m = t.current()
  assert.equal(m.videoName, 'Cool Song'); assert.equal(m.kind, 'listen'); assert.ok(m.endsAt > Date.now())

  // VRDancing with id -1 = YouTube -> title lookup
  t.processLine(L('[VRCX] VideoPlay(VRDancing) "https://youtu.be/dQw4w9WgXcQ",0,212,-1,"Bob","ignored"'))
  await tick()
  m = t.current()
  assert.equal(m.videoName, 'YT Title'); assert.equal(m.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')

  t.reset()
  t.processLine(L('[VRCX] LSMedia 0,6298.292,Natsumi-sama,The Outfit (2022), 1080p'))
  m = t.current()
  assert.equal(m.source, 'LSMedia'); assert.equal(m.videoName, 'The Outfit (2022)')

  t.reset()
  t.processLine(L('nowplaying {"id":"Main-1","type":"mediaChange","mediaUrl":"https://x/v","mediaName":"ProTV Movie","mediaLength":120,"mediaImage":"https://img/p.jpg"}'))
  t.processLine(L('nowplaying {"id":"Main-1","type":"mediaPlay","mediaTime":30}'))
  m = t.current()
  assert.equal(m.videoName, 'ProTV Movie'); assert.equal(m.thumbnailUrl, 'https://img/p.jpg'); assert.equal(m.isPaused, false)
  t.processLine(L('nowplaying {"id":"Main-1","type":"mediaPause","mediaTime":31}'))
  assert.equal(t.current().isPaused, true)
  t.processLine(L('nowplaying {"id":"Main-1","type":"mediaStop"}'))
  assert.equal(t.current(), null)
})

test('media: generic YouTube URL gets a title; non-YouTube and integration worlds do not', async () => {
  const t = createWorldMediaTracker({ lookupTitle: async id => (id === 'dQw4w9WgXcQ' ? 'Never Gonna' : '') })
  t.processLine(L("[Video Playback] Attempting to resolve URL 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'"))
  await tick()
  assert.equal(t.current().videoName, 'Never Gonna')
  assert.ok(t.current().expiresAt > Date.now()) // unknown length -> expiry
  t.reset()
  t.processLine(L("[Video Playback] Attempting to resolve URL 'https://example.com/private.m3u8'"))
  await tick()
  assert.equal(t.current(), null)
  // a world integration wins over plain URLs
  t.processLine(L('[VRCX] LSMedia 0,100,A,Film,'))
  t.processLine(L("[Video Playback] Attempting to resolve URL 'https://youtu.be/dQw4w9WgXcQ'"))
  await tick()
  assert.equal(t.current().videoName, 'Film')
  assert.equal(youtubeId('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
})

test('Discord presence uses the poster as the big icon, on every status', async () => {
  await discord.startDiscord({ clientId: '123', enableRichPresence: true })
  await new Promise(r => setTimeout(r, 20))
  pushes.length = 0
  const now = Date.now()
  discord.setVrcContext({
    worldName: 'Popcorn Palace',
    vrcStatus: 'active',
    worldMedia: { source: 'PopcornPalace', kind: 'watch', videoName: 'Dune', thumbnailUrl: 'https://img.example/dune.jpg', isPaused: false, startedAt: now - 60000, endsAt: now + 600000 }
  })
  await new Promise(r => setTimeout(r, 6000)) // presence pushes are throttled to one per 5s
  const a = pushes.at(-1)
  assert.equal(a.largeImageKey, 'https://img.example/dune.jpg')
  assert.equal(a.largeImageText, 'Dune')
  assert.equal(a.smallImageKey, 'logo')
  assert.match(a.details, /🍿 Dune/)
  assert.match(a.state, /Watching in Popcorn Palace/)
  assert.equal(a.endTimestamp, Math.round(now + 600000))

  // Ask Me / DND hide only the world name + join button; the media stays.
  pushes.length = 0
  discord.setVrcContext({ vrcStatus: 'busy' })
  await new Promise(r => setTimeout(r, 6000))
  const b = pushes.at(-1)
  assert.equal(b.largeImageKey, 'https://img.example/dune.jpg')
  assert.match(b.state, /Watching a movie/)
  assert.doesNotMatch(b.state, /Popcorn Palace/)
  assert.ok(!(b.buttons || []).some(x => /Join World/.test(x.label)))

  // Dance world wording
  pushes.length = 0
  discord.setVrcContext({ vrcStatus: 'active', worldName: 'PyPyDance', worldMedia: { source: 'nowplaying', kind: 'listen', videoName: 'Song', startedAt: now, endsAt: now + 200000 } })
  await new Promise(r => setTimeout(r, 6000))
  const c = pushes.at(-1)
  assert.match(c.details, /💃 Song/)
  assert.match(c.state, /Dancing in PyPyDance/)
  await discord.stopDiscord()
})

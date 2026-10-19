'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function createDetector ({ spotifyTrack = null, artwork = null } = {}) {
  const pending = []
  const output = { exports: {} }
  const source = fs.readFileSync(path.join(__dirname, '../modules/media/nowPlaying.js'), 'utf8')
  const sandbox = {
    module: output,
    exports: output.exports,
    process: { platform: 'win32', env: {} },
    Date,
    console,
    require (id) {
      if (id === 'child_process') return { execFile: (_bin, args, options, callback) => pending.push({ args, options, callback }) }
      if (id === './artworkLookup') return { lookupArtwork: async () => artwork }
      if (id === './spotifyWindowFallback') return {
        getSpotifyWindowTrack: async () => spotifyTrack,
        shouldTrySpotifyWindowFallback: require('../modules/media/spotifyWindowFallback').shouldTrySpotifyWindowFallback
      }
      throw new Error(`Unexpected require: ${id}`)
    }
  }
  vm.runInNewContext(source, sandbox, { filename: 'nowPlaying.js' })
  return { detector: output.exports, pending }
}

function complete (call, sourceAppId, title) {
  call.callback(null, JSON.stringify({ found: true, sourceAppId, title, artist: 'Example', status: 'Playing', sessions: [{ appId: sourceAppId, status: 'Playing' }] }), '')
}

test('a source change invalidates the previous in-flight query and cached track', async () => {
  const { detector, pending } = createDetector()
  const older = detector.getNowPlaying()
  detector.setPreferredSource('Spotify.exe')
  const current = detector.getNowPlaying()
  assert.equal(pending.length, 2)
  assert.equal(pending[1].options.env.NP_SOURCE, 'spotify.exe')

  complete(pending[1], 'Spotify.exe', 'Current track')
  complete(pending[0], 'firefox.exe', 'Stale track')
  assert.equal((await current).title, 'Current track')
  assert.equal((await older).title, 'Current track')
  assert.equal((await detector.getNowPlaying()).title, 'Current track')
})

test('preferred source selector does not choose an unrelated native session', () => {
  const { detector, pending } = createDetector()
  detector.getNowPlaying()
  const script = pending[0].args.at(-1)
  assert.match(script, /\$null -eq \$session -and \$pref -eq ""/)
  assert.match(script, /\$null -eq \$session -and \$pref -eq "" -and \$sessions\.Count/)
})

test('Spotify accessibility timeline is retained when no Windows media session exists', async () => {
  const spotifyTrack = {
    artist: 'Vance Joy', title: 'Riptide', progressMs: 51000, durationMs: 203000,
    status: 'Playing', detectionMethod: 'spotify-accessibility'
  }
  const { detector, pending } = createDetector({ spotifyTrack })
  const result = detector.getNowPlaying()
  pending[0].callback(null, JSON.stringify({ found: false, sessions: [] }), '')
  const nowPlaying = await result
  assert.equal(nowPlaying.source, 'Spotify')
  assert.equal(nowPlaying.status, 'Playing')
  assert.equal(nowPlaying.progressMs, 51000)
  assert.equal(nowPlaying.durationMs, 203000)
  assert.equal(nowPlaying.detectionMethod, 'spotify-accessibility')
})

test('fast Spotify detection continues while accessibility reports a different song', async () => {
  const spotifyTrack = {
    artist: 'Riot Shift', title: 'New Song', progressMs: 0, durationMs: 0,
    status: 'Unknown', detectionMethod: 'spotify-window-title'
  }
  const { detector, pending } = createDetector({ spotifyTrack })
  const first = detector.getNowPlaying()
  pending[0].callback(null, JSON.stringify({ found: false, sessions: [] }), '')
  assert.equal((await first).title, 'New Song')
  assert.equal((await detector.getSpotifyLive()).title, 'New Song')
})

test('recovers Spotify duration from a verified catalog result when accessibility is stale', async () => {
  const spotifyTrack = {
    artist: 'Riot Shift', title: 'New Track', progressMs: 4000, durationMs: 0,
    status: 'Playing', detectionMethod: 'spotify-window-title'
  }
  const { detector, pending } = createDetector({ spotifyTrack,
    artwork: { image: 'https://is1-ssl.mzstatic.com/art.jpg', durationMs: 192000 } })
  const result = detector.getNowPlaying()
  pending[0].callback(null, JSON.stringify({ found: false, sessions: [] }), '')
  const media = await result
  assert.equal(media.title, 'New Track')
  assert.equal(media.durationMs, 192000)
  assert.equal(media.progressMs, 4000)
})

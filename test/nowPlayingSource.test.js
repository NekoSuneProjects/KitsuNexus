'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function createDetector () {
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
      if (id === './artworkLookup') return { lookupArtwork: async () => null }
      if (id === './spotifyWindowFallback') return {
        getSpotifyWindowTrack: async () => null,
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

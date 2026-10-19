'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseSpotifyWindowTitle, shouldTrySpotifyWindowFallback } = require('../modules/media/spotifyWindowFallback')

test('reads artist and song from Spotify desktop window title', () => {
  assert.deepEqual(parseSpotifyWindowTitle('Queen - Another One Bites The Dust'), {
    artist: 'Queen', title: 'Another One Bites The Dust'
  })
  assert.deepEqual(parseSpotifyWindowTitle('Artist - Track - Live Edit'), {
    artist: 'Artist', title: 'Track - Live Edit'
  })
  assert.deepEqual(parseSpotifyWindowTitle('Björk – Jóga'), {
    artist: 'Björk', title: 'Jóga'
  })
})

test('ignores generic Spotify window titles', () => {
  assert.equal(parseSpotifyWindowTitle('Spotify Premium'), null)
  assert.equal(parseSpotifyWindowTitle('Spotify'), null)
  assert.equal(parseSpotifyWindowTitle(''), null)
})

test('respects source preference, native playing sessions and native Spotify pause', () => {
  assert.equal(shouldTrySpotifyWindowFallback({ found: false }, ''), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Paused', title: 'Video' }, ''), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Playing', title: 'Video' }, ''), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Playing', title: 'Video' }, 'Spotify.exe'), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Paused', title: '' }, 'firefox.exe'), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Paused', title: 'Song' }, ''), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Playing', title: '' }, ''), true)
})

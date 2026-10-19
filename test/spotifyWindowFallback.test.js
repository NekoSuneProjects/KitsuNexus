'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseSpotifyWindowTitle, parseSpotifyWindowResult, createSpotifyTimelineStabilizer, shouldTrySpotifyWindowFallback } = require('../modules/media/spotifyWindowFallback')

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

test('reads Spotify player progress, duration and playback state even with an empty window title', () => {
  const result = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: '—', title: 'Riptide', artist: 'Vance Joy', trackLabel: 'Now playing: Riptide by Vance Joy',
    progressMs: 68000, durationMs: 204000, status: 'Playing', sampledAt: 1000
  }))
  assert.deepEqual(result, {
    artist: 'Vance Joy', title: 'Riptide', progressMs: 68000, durationMs: 204000,
    status: 'Playing', fetchedAt: 1000, detectionMethod: 'spotify-accessibility'
  })
  assert.equal(parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Vance Joy - Riptide', trackLabel: 'Now playing: Riptide by Vance Joy',
    progressMs: 80000, durationMs: 204000,
    status: 'Paused'
  })).status, 'Paused')
})

test('window title wins when Spotify accessibility is still on the previous song', () => {
  const media = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Riot Shift - TILL MY HEART STOPS - KRACH EDIT',
    title: 'FLASHBACK', artist: 'Kronos, Art Of Fighters, Dave Revan',
    trackLabel: 'Now playing: FLASHBACK by Kronos',
    durationMs: 181406, progressMs: 181406,
    status: 'Playing', sampledAt: 1000
  }))
  assert.equal(media.title, 'TILL MY HEART STOPS - KRACH EDIT')
  assert.equal(media.artist, 'Riot Shift')
  assert.equal(media.durationMs, 0)
  assert.equal(media.progressMs, 0)
  assert.equal(media.status, 'Playing')
  assert.equal(media.detectionMethod, 'spotify-window-title')
  assert.ok(media.fetchedAt > 1000)

  const caughtUp = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Riot Shift - TILL MY HEART STOPS - KRACH EDIT',
    title: 'TILL MY HEART STOPS - KRACH EDIT', artist: 'Riot Shift',
    trackLabel: 'Now playing: TILL MY HEART STOPS - KRACH EDIT by Riot Shift',
    durationMs: 189000, progressMs: 10000,
    status: 'Playing', sampledAt: 2000
  }))
  assert.equal(caughtUp.detectionMethod, 'spotify-accessibility')
  assert.equal(caughtUp.progressMs, 10000)
})

test('does not attach an unlabelled slider to a window-title-only song', () => {
  const media = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'New Artist - New Song', progressMs: 30000, durationMs: 200000,
    status: 'Playing', sampledAt: 1000
  }))
  assert.equal(media.title, 'New Song')
  assert.equal(media.detectionMethod, 'spotify-window-title')
  assert.equal(media.status, 'Playing')
  assert.equal(media.durationMs, 0)
})

test('window title fallback does not invent timing or use a different track timeline', () => {
  const media = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Vance Joy - Riptide', trackLabel: 'Now playing: Other Song by Vance Joy',
    progressMs: 60000, durationMs: 200000, status: 'Playing', sampledAt: 1000
  }))
  assert.deepEqual({ ...media, fetchedAt: 0 }, {
    artist: 'Vance Joy', title: 'Riptide', progressMs: 0, durationMs: 0,
    status: 'Playing', fetchedAt: 0, detectionMethod: 'spotify-window-title'
  })
  assert.ok(media.fetchedAt > 1000)
  assert.equal(parseSpotifyWindowResult('not JSON'), null)
  assert.equal(parseSpotifyWindowResult(JSON.stringify({ windowTitle: 'Spotify Premium' })), null)
  assert.equal(parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Vance Joy - Riptide', progressMs: 290000, durationMs: 200000
  })).durationMs, 0)
})

test('recovers the new track duration from a matching Spotify list row', () => {
  const media = parseSpotifyWindowResult(JSON.stringify({
    windowTitle: 'Riot Shift - New Track', title: 'Previous Track', artist: 'Old Artist',
    trackLabel: 'Now playing: Previous Track by Old Artist',
    durationMs: 181406, progressMs: 181406, trackDurationMs: 192000,
    status: 'Playing', sampledAt: 1000
  }))
  assert.equal(media.title, 'New Track')
  assert.equal(media.durationMs, 192000)
  assert.equal(media.progressMs, 0)
  assert.equal(media.detectionMethod, 'spotify-window-title')
})

test('keeps the correct duration and advances elapsed time through a stale slider', () => {
  const stabilize = createSpotifyTimelineStabilizer()
  const sample = (title, at, durationMs, status = 'Playing', method = 'spotify-window-title', position = 0) => stabilize({
    title, artist: 'Riot Shift', fetchedAt: at,
    durationMs, progressMs: position, status, detectionMethod: method
  })
  assert.equal(sample('First Song', 1000, 181000).durationMs, 181000)
  assert.equal(sample('New Track', 4000, 192000).progressMs, 0)
  assert.equal(sample('New Track', 9000, 0).progressMs, 5000)
  const unknownDuration = sample('New Track', 11000, 0)
  assert.equal(unknownDuration.durationMs, 192000)
  assert.equal(unknownDuration.progressMs, 7000)
  assert.equal(sample('New Track', 14000, 0, 'Paused').progressMs, 7000)
  assert.equal(sample('New Track', 16000, 0, 'Playing').durationMs, 192000)
  assert.equal(sample('New Track', 18000, 192500, 'Playing', 'spotify-accessibility', 13500).progressMs, 13500)
})

test('frozen Spotify slider never repeatedly rewinds the playing clock', () => {
  const stabilize = createSpotifyTimelineStabilizer()
  const sample = (at, position, status = 'Playing', title = 'Riptide') => stabilize({
    artist: 'Vance Joy', title, durationMs: 100000, progressMs: position,
    fetchedAt: at, status, detectionMethod: 'spotify-accessibility'
  })
  assert.equal(sample(1000, 50000).progressMs, 50000)
  assert.equal(sample(4000, 50000).progressMs, 53000)
  assert.equal(sample(7000, 50000).progressMs, 56000)
  assert.equal(sample(8500, 50000, 'Paused').progressMs, 56000)
  assert.equal(sample(10000, 50000, 'Paused').progressMs, 56000)
  assert.equal(sample(11000, 50000).progressMs, 56000)
  assert.equal(sample(14000, 50000).progressMs, 59000)
  assert.equal(sample(16000, 51000).progressMs, 61000) // Stale, partially advanced UI position.
  assert.equal(sample(18000, 12000).progressMs, 12000) // Seek backwards.
  assert.equal(sample(21000, 12000).progressMs, 15000)
  assert.equal(sample(23000, 3000, 'Playing', 'New Song').progressMs, 3000)
})

test('respects source preference, native playing sessions and native Spotify pause', () => {
  assert.equal(shouldTrySpotifyWindowFallback({ found: false }, ''), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Paused', title: 'Video' }, ''), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Playing', title: 'Video' }, ''), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Playing', title: 'Video' }, 'Spotify.exe'), true)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Paused', title: '' }, 'firefox.exe'), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Paused', title: 'Song' }, ''), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Playing', title: 'Song' }, 'Spotify.exe'), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Paused', title: '' }, 'Spotify.exe'), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'firefox.exe', status: 'Paused', title: 'Video', sessions: [{ appId: 'Spotify.exe', status: 'Paused' }] }, ''), false)
  assert.equal(shouldTrySpotifyWindowFallback({ found: true, sourceAppId: 'Spotify.exe', status: 'Playing', title: '' }, ''), true)
})

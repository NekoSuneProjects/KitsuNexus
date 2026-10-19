'use strict'

const { execFile } = require('node:child_process')

// Recent Spotify desktop builds can display the track in the main window title
// without registering a Windows GlobalSystemMediaTransportControls session.
// Read only Spotify's own window; no credentials, network access or media keys.
const SPOTIFY_WINDOW_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match " [-–—] " } | Select-Object -First 1',
  'if ($spotify) { [Console]::Out.Write($spotify.MainWindowTitle) }'
].join('\n')

function parseSpotifyWindowTitle (value) {
  const text = String(value || '').trim()
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text)
  if (!match) return null
  const artist = match[1].trim()
  const title = match[2].trim()
  if (!artist || !title || /^spotify(?:\s+(?:free|premium))?$/i.test(artist)) return null
  return { artist, title }
}

function shouldTrySpotifyWindowFallback (media, preferredSource) {
  const preference = String(preferredSource || '').toLowerCase()
  const nativeSource = String(media?.sourceAppId || '').toLowerCase()
  if (preference && !preference.includes('spotify')) return false
  // A valid Spotify session is authoritative, even if Spotify was explicitly
  // selected. Window titles cannot prove whether a track is actually playing.
  if (nativeSource.includes('spotify') && media?.found &&
      (media.title || media.status !== 'Playing')) return false
  // Spotify may be listed but not selected. Never present its stale window
  // title as playing if Windows reports that the Spotify session is paused.
  const sessions = Array.isArray(media?.sessions) ? media.sessions : (media?.sessions ? [media.sessions] : [])
  if (sessions.some(s => String(s?.appId || '').toLowerCase().includes('spotify') &&
      ['Paused', 'Stopped', 'Closed'].includes(s?.status))) return false
  if (preference.includes('spotify')) return true
  return !(media?.found && media?.title && media?.status === 'Playing')
}

function getSpotifyWindowTrack () {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SPOTIFY_WINDOW_SCRIPT], {
      encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 64 * 1024
    }, (error, stdout) => {
      resolve(error ? null : parseSpotifyWindowTitle(stdout))
    })
  })
}

module.exports = { getSpotifyWindowTrack, parseSpotifyWindowTitle, shouldTrySpotifyWindowFallback }

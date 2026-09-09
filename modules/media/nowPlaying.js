const { execFile } = require('child_process')
const { lookupArtwork } = require('./artworkLookup')

const cacheTtlMs = 3000
const transientMissGraceMs = 12000
const transientMissLimit = 3
let cachedResult = null
let cachedAt = 0
let inFlight = null
let preferredSource = '' // '' = Auto; else a substring of the app id (e.g. 'spotify')
let lastSessions = [] // most recent list of available media sessions (for the picker)
let stableMedia = null
let stableMediaKey = ''
let stableMediaSeenAt = 0
let transientMisses = 0

const MEDIA_SESSION_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {',
  "  $_.Name -eq 'AsTask' -and",
  '  $_.GetParameters().Count -eq 1 -and',
  "  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'",
  '})[0]',
  'function Await-WinRt($operation, $resultType) {',
  '  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)',
  '  $task = $asTask.Invoke($null, @($operation))',
  '  $task.Wait() | Out-Null',
  '  return $task.Result',
  '}',
  '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null',
  '$manager = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
  // Preferred source comes in via an env var (no string interpolation into the
  // script -> no injection). Empty = Auto.
  "$pref = ''",
  'try { $pref = [string]$env:NP_SOURCE } catch {}',
  '$sessions = @()',
  'try { $sessions = @($manager.GetSessions()) } catch {}',
  // Picker list: every session app id + its playback status (for the dropdown).
  '$list = @()',
  'foreach ($c in $sessions) {',
  "  $st = 'Unknown'",
  '  try { $st = $c.GetPlaybackInfo().PlaybackStatus.ToString() } catch {}',
  '  $list += @{ appId = [string]$c.SourceAppUserModelId; status = $st }',
  '}',
  // Choose a session: preferred source -> any Playing -> system current -> first.
  '$session = $null',
  "if ($pref -ne '') {",
  '  foreach ($c in $sessions) { if (([string]$c.SourceAppUserModelId).ToLower().Contains($pref.ToLower())) { $session = $c; break } }',
  '}',
  'if ($null -eq $session) {',
  "  foreach ($c in $sessions) { try { if ($c.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $session = $c; break } } catch {} }",
  '}',
  'if ($null -eq $session) { try { $session = $manager.GetCurrentSession() } catch {} }',
  'if ($null -eq $session -and $sessions.Count -gt 0) { $session = $sessions[0] }',
  'if ($null -eq $session) {',
  '  @{ found = $false; sessions = @($list) } | ConvertTo-Json -Compress -Depth 4',
  '  exit 0',
  '}',
  '$props = Await-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
  '$playback = $session.GetPlaybackInfo()',
  '$timeline = $session.GetTimelineProperties()',
  // Native thumbnail extraction (props.Thumbnail.OpenReadAsync()) used to live here. Removed:
  // reading that WinRT stream's .Size through PowerShell's late-bound COM interop is unreliable
  // — measured anywhere from ~2s to blowing the whole script's timeout budget, and calling
  // .Dispose() on the raw stream/reader COM objects throws ("does not contain a method named
  // 'Dispose'", since System.__ComObject doesn't expose IDisposable through late binding) on
  // every single poll. artworkLookup.js's Deezer/iTunes lookup (normalizeMedia, in this same
  // file) already fills in artwork from title/artist with a real, bounded 3.5s timeout — that's
  // the only artwork source now, and it's the reliable one.
  '$image = ""',
  '$imageMime = ""',
  '@{',
  '  found = $true',
  '  sessions = @($list)',
  '  sourceAppId = $session.SourceAppUserModelId',
  '  status = $playback.PlaybackStatus.ToString()',
  '  title = $props.Title',
  '  artist = $props.Artist',
  '  album = $props.AlbumTitle',
  '  durationMs = [int64]([Math]::Max($timeline.EndTime.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds, 0))',
  '  progressMs = [int64]([Math]::Max($timeline.Position.TotalMilliseconds - $timeline.StartTime.TotalMilliseconds, 0))',
  '  image = $image',
  '  imageMime = $imageMime',
  '  fetchedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
  '} | ConvertTo-Json -Compress -Depth 4'
].join('\n')

function normalizeSourceName (sourceAppId) {
  if (!sourceAppId) return ''

  const source = sourceAppId.toLowerCase()
  if (source.includes('spotify')) return 'Spotify'
  if (source.includes('itunes')) return 'iTunes'
  if (source.includes('apple')) return 'Apple Music'
  if (source.includes('vlc')) return 'VLC'
  if (source.includes('chrome')) return 'Chrome'
  if (source.includes('msedge')) return 'Edge'
  if (source.includes('firefox')) return 'Firefox'
  if (source.includes('wmplayer')) return 'Windows Media Player'

  return sourceAppId.replace(/\.exe$/i, '')
}

function normalizeKeyPart (value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function getMediaKey (media) {
  if (!media?.found || !media.title) return ''

  return [
    media.sourceAppId || media.source,
    media.artist,
    media.title,
    media.album
  ].map(normalizeKeyPart).join('|')
}

function cloneMedia (media, extra = {}) {
  return {
    ...media,
    ...extra
  }
}

function clearStableMedia () {
  stableMedia = null
  stableMediaKey = ''
  stableMediaSeenAt = 0
}

function getTransientCachedMedia (miss) {
  if (!stableMedia) return null

  const now = Date.now()
  const insideGrace = now - stableMediaSeenAt < transientMissGraceMs
  if (!insideGrace && transientMisses >= transientMissLimit) {
    return null
  }

  return cloneMedia(stableMedia, {
    cached: true,
    stale: true,
    cacheReason: miss?.error ? 'detector-error' : 'transient-miss',
    lastError: miss?.error || ''
  })
}

// Turn the raw session list from PowerShell into { appId, source, status } and
// remember it so the UI dropdown can list sources even between songs.
function normalizeSessions (raw) {
  const arr = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  const sessions = arr
    .filter(s => s && s.appId)
    .map(s => ({ appId: s.appId, source: normalizeSourceName(s.appId), status: s.status || '' }))
  if (sessions.length) lastSessions = sessions
  return sessions
}

async function normalizeMedia (media) {
  const durationMs = Number(media.durationMs) || 0
  const progressMs = Math.max(0, Math.min(Number(media.progressMs) || 0, durationMs || Number.MAX_SAFE_INTEGER))
  const sessions = normalizeSessions(media.sessions)
  const normalized = {
    found: Boolean(media.found),
    source: normalizeSourceName(media.sourceAppId),
    sourceAppId: media.sourceAppId || '',
    status: media.status || '',
    title: media.title || '',
    artist: media.artist || '',
    album: media.album || '',
    durationMs,
    progressMs,
    image: media.image || '',
    imageMime: media.imageMime || '',
    imageSource: media.image ? 'Windows media session' : '',
    sessions: sessions.length ? sessions : lastSessions,
    preferredSource,
    error: media.error || '',
    fetchedAt: Number(media.fetchedAt) || Date.now()
  }

  const mediaKey = getMediaKey(normalized)
  const sameStableMedia = mediaKey && mediaKey === stableMediaKey

  if (sameStableMedia && stableMedia?.image && !normalized.image) {
    normalized.image = stableMedia.image
    normalized.imageMime = stableMedia.imageMime || normalized.imageMime
    normalized.imageSource = stableMedia.imageSource || normalized.imageSource
  }

  if (normalized.found && !normalized.image) {
    const artwork = await lookupArtwork(normalized)
    if (artwork?.image) {
      normalized.image = artwork.image
      normalized.imageSource = artwork.source
      if (!normalized.album && artwork.album) {
        normalized.album = artwork.album
      }
    }
  }

  return normalized
}

async function resolveNowPlayingResult (media) {
  const normalized = await normalizeMedia(media)
  const mediaKey = getMediaKey(normalized)

  if (!mediaKey) {
    if (normalized.found && normalized.status && normalized.status !== 'Playing') {
      transientMisses = 0
      clearStableMedia()
      return cloneMedia(normalized, { found: false })
    }

    transientMisses += 1
    const cachedMedia = getTransientCachedMedia(normalized)
    return cachedMedia || normalized
  }

  transientMisses = 0
  stableMediaKey = mediaKey
  stableMediaSeenAt = Date.now()
  stableMedia = cloneMedia(normalized, {
    cached: false,
    stale: false,
    cacheReason: ''
  })

  return stableMedia
}

function getNowPlaying () {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      found: false,
      unavailable: true,
      error: 'Windows media sessions are only available on Windows.'
    })
  }

  const now = Date.now()
  if (cachedResult && now - cachedAt < cacheTtlMs) {
    return Promise.resolve(cachedResult)
  }

  if (inFlight) {
    return inFlight
  }

  inFlight = new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', MEDIA_SESSION_SCRIPT],
      {
        // WinRT session/media-properties queries through PowerShell are inherently slow and
        // highly variable — measured 8-13s+ on a normal, otherwise-idle Windows 10 machine with
        // Spotify actively playing, even after removing the (separately fixed) thumbnail-read
        // step. 5s, then 9s, both still timed out regularly and showed "No media detected" on
        // otherwise-working systems; this is deliberately generous rather than "fast but wrong".
        // Safe to be this long: getNowPlaying() already dedupes concurrent calls via `inFlight`
        // and caches the result for cacheTtlMs, so a slow call just gets reused across the
        // renderer's 10s poll interval instead of piling up duplicate PowerShell processes.
        timeout: 18000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        // Preferred source passed safely via env (no script string interpolation).
        env: { ...process.env, NP_SOURCE: preferredSource || '' }
      },
      async (error, stdout, stderr) => {
        if (error) {
          // Surface the real reason (timeout, WinRT load failure, Constrained
          // Language Mode, etc.) so the UI can show something actionable.
          const detail = (stderr || '').toString().trim().split(/\r?\n/)[0]
          const msg = error.killed ? 'Media detector timed out (slow PC or PowerShell blocked)'
            : (detail || error.message)
          cachedResult = await resolveNowPlayingResult({
            found: false,
            error: msg
          })
          cachedAt = Date.now()
          inFlight = null
          resolve(cachedResult)
          return
        }

        try {
          cachedResult = await resolveNowPlayingResult(JSON.parse(stdout.trim() || '{}'))
        } catch (parseError) {
          cachedResult = await resolveNowPlayingResult({
            found: false,
            error: parseError.message
          })
        }

        cachedAt = Date.now()
        inFlight = null
        resolve(cachedResult)
      }
    )
  })

  return inFlight
}

// '' / 'auto' = Auto-pick; otherwise a substring of the app id (e.g. 'spotify').
function setPreferredSource (value) {
  const v = String(value || '').trim().toLowerCase()
  preferredSource = (v === 'auto') ? '' : v
  cachedResult = null // re-query immediately with the new preference
  cachedAt = 0
}
function getPreferredSource () { return preferredSource }
// The media sources seen most recently (for the UI dropdown).
function getSources () { return lastSessions.slice() }

module.exports = {
  getNowPlaying,
  setPreferredSource,
  getPreferredSource,
  getSources
}

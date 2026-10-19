'use strict'

const { execFile } = require('node:child_process')

// Spotify sometimes has no WinRT media session. Its own Windows accessibility
// controls still expose the track, elapsed time, duration and play/pause state.
// Keep the window title as a fallback; no credentials or network access needed.
const SPOTIFY_WINDOW_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$result = @{ windowTitle = ''; title = ''; artist = ''; trackLabel = ''; progressMs = 0; durationMs = 0; trackDurationMs = 0; status = 'Unknown'; sampledAt = 0 }",
  '$spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1',
  'if ($spotify) {',
  '  $result.windowTitle = [string]$spotify.MainWindowTitle',
  '  try {',
  '    Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop',
  '    $root = [System.Windows.Automation.AutomationElement]::FromHandle($spotify.MainWindowHandle)',
  '    $descendants = [System.Windows.Automation.TreeScope]::Descendants',
  '    $groupFilter = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Group)',
  '    $linkFilter = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Hyperlink)',
  '    foreach ($group in $root.FindAll($descendants, $groupFilter)) {',
  "      if ($group.Current.Name -notlike 'Now playing:*') { continue }",
  '      $result.trackLabel = [string]$group.Current.Name',
  '      $links = $group.FindAll($descendants, $linkFilter)',
  '      if ($links.Count -ge 2) {',
  '        $result.title = [string]$links[0].Current.Name',
  '        $artists = @()',
  '        for ($i = 1; $i -lt $links.Count; $i++) { $artists += [string]$links[$i].Current.Name }',
  "        $result.artist = $artists -join ', '",
  '      }',
  '      break',
  '    }',
  '    $sliderFilter = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Slider)',
  '    foreach ($slider in $root.FindAll($descendants, $sliderFilter)) {',
  '      try {',
  '        $range = $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)',
  '        $length = [double]$range.Current.Maximum - [double]$range.Current.Minimum',
  '        if ($length -lt 5000) { continue }',
  '        $position = [double]$range.Current.Value - [double]$range.Current.Minimum',
  '        if ($position -lt 0 -or $position -gt $length) { continue }',
  '        $result.durationMs = [int64][Math]::Round($length)',
  '        $result.progressMs = [int64][Math]::Round($position)',
  '        $result.sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()',
  '        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker',
  '        $parent = $walker.GetParent($slider)',
  '        for ($depth = 0; $parent -and $depth -lt 4; $depth++) {',
  "          if ($parent.Current.Name -eq 'Player controls') { break }",
  '          $parent = $walker.GetParent($parent)',
  '        }',
  "        if ($parent -and $parent.Current.Name -eq 'Player controls') {",
  '          $buttonFilter = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)',
  '          foreach ($button in $parent.FindAll([System.Windows.Automation.TreeScope]::Children, $buttonFilter)) {',
  "            if ($button.Current.Name -eq 'Pause') { $result.status = 'Playing'; break }",
  "            if ($button.Current.Name -eq 'Play') { $result.status = 'Paused'; break }",
  '          }',
  '        }',
  '        break',
  '      } catch {}',
  '    }',
  '  } catch {}',
  '  try { $spotify.Refresh(); $result.windowTitle = [string]$spotify.MainWindowTitle } catch {}',
  '  # During transitions Spotify can retain the old player slider. A visible',
  '  # playlist row for the new song may already contain its actual duration.',
  "  $parts = $result.windowTitle -split ' - ', 2",
  '  if ($parts.Count -eq 2 -and $result.title -ne $parts[1]) {',
  '    try {',
  "      $itemFilter = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::DataItem)",
  "      $songPattern = 'Play\\s+' + [regex]::Escape($parts[1]) + '\\s+by\\s+' + [regex]::Escape($parts[0]) + '(?=\\b|,|$)'",
  '      foreach ($item in $root.FindAll($descendants, $itemFilter)) {',
  '        $name = [string]$item.Current.Name',
  "        if ($name -notmatch $songPattern -or $name -notmatch '(\\d{1,2}:)?\\d{1,2}:\\d{2}\\s+More options for') { continue }",
  '        $clock = $Matches[0] -replace "\\s+More options for$", ""',
  '        $segments = @($clock -split ":")',
  '        $seconds = 0',
  '        foreach ($segment in $segments) { $seconds = $seconds * 60 + [int]$segment }',
  '        if ($seconds -gt 5 -and $seconds -lt 14400) { $result.trackDurationMs = [int64]$seconds * 1000; break }',
  '      }',
  '    } catch {}',
  '  }',
  '}',
  '$result | ConvertTo-Json -Compress -Depth 3'
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

function parseSpotifyWindowResult (value) {
  let raw
  try { raw = JSON.parse(String(value || '')) } catch { return null }
  if (!raw || typeof raw !== 'object') return null

  // Spotify sometimes leaves its accessibility tree on the PREVIOUS song even
  // after its window title changes. Prefer the window title when the song names
  // disagree, and never attach the old slider to the newly playing track.
  const title = String(raw.title || '').trim()
  const artist = String(raw.artist || '').trim()
  const accessibleTrack = title && artist ? { title, artist } : null
  const windowTrack = parseSpotifyWindowTitle(raw.windowTitle)
  const mismatchedTrack = windowTrack && accessibleTrack &&
    windowTrack.title.toLocaleLowerCase() !== accessibleTrack.title.toLocaleLowerCase()
  const track = (mismatchedTrack ? windowTrack : accessibleTrack) || windowTrack
  if (!track) return null

  // Avoid attaching the wrong timeline if the track changes between the
  // window-title and accessibility reads.
  const label = String(raw.trackLabel || '').trim().toLowerCase()
  const trackMatches = !mismatchedTrack && (Boolean(accessibleTrack) ||
    (label && label.startsWith(`now playing: ${track.title} by `.toLowerCase())))
  const durationMs = Number(raw.durationMs)
  const progressMs = Number(raw.progressMs)
  const hasTimeline = trackMatches && Number.isFinite(durationMs) && durationMs > 0 &&
    Number.isFinite(progressMs) && progressMs >= 0 && progressMs <= durationMs
  const listDurationMs = Number(raw.trackDurationMs)
  const hasListDuration = Number.isFinite(listDurationMs) && listDurationMs >= 5000 && listDurationMs <= 14400000
  // The Play/Pause control describes the active player, even when the track
  // label and slider are stale. Preserve it so a new track's clock can run.
  const status = ['Playing', 'Paused'].includes(raw.status) ? raw.status : 'Unknown'

  return {
    ...track,
    durationMs: hasTimeline ? durationMs : (hasListDuration ? listDurationMs : 0),
    progressMs: hasTimeline ? progressMs : 0,
    status,
    fetchedAt: hasTimeline && Number(raw.sampledAt) > 0 ? Number(raw.sampledAt) : Date.now(),
    detectionMethod: hasTimeline ? 'spotify-accessibility' : 'spotify-window-title'
  }
}

// Spotify can stop refreshing its UI Automation slider when its window is in
// the background, even while the Pause button confirms active playback. The
// unchanged slider position must not reset the elapsed time every poll.
function createSpotifyTimelineStabilizer () {
  let previous = null
  return function stabilize (media) {
    if (!media || !['spotify-accessibility', 'spotify-window-title'].includes(media.detectionMethod)) {
      previous = null
      return media
    }

    const sampledAt = Number(media.fetchedAt) || Date.now()
    if (media.detectionMethod === 'spotify-window-title') {
      const sameSong = previous && previous.title === media.title && previous.artist === media.artist
      const durationMs = media.durationMs || (sameSong ? previous.durationMs : 0)
      const elapsedMs = sameSong && previous.status === 'Playing' && media.status === 'Playing'
        ? Math.max(0, sampledAt - previous.fetchedAt) : 0
      const progressMs = sameSong ? previous.progressMs + elapsedMs : 0
      const result = { ...media, durationMs,
        progressMs: durationMs ? Math.min(durationMs, progressMs) : progressMs }
      previous = { ...result, rawProgressMs: 0 }
      return result
    }
    const rawProgressMs = media.progressMs
    const sameTrack = previous?.detectionMethod === 'spotify-accessibility' &&
      previous.title === media.title && previous.artist === media.artist &&
      Math.abs(previous.durationMs - media.durationMs) < 1500 &&
      sampledAt >= previous.fetchedAt

    let progressMs = rawProgressMs
    if (sameTrack) {
      const predicted = Math.min(media.durationMs, previous.progressMs +
        (previous.status === 'Playing' ? sampledAt - previous.fetchedAt : 0))
      const rawMovement = rawProgressMs - previous.rawProgressMs
      if (Math.abs(rawMovement) < 500) {
        // Frozen slider. Advance while playing, but freeze on pause/resume.
        progressMs = media.status === 'Playing' && previous.status === 'Playing'
          ? predicted : previous.progressMs
      } else if (rawMovement > 0 && media.status === 'Playing' && previous.status === 'Playing') {
        // A lagging UI slider must not pull our clock backwards. If the
        // slider jumps ahead (seek), the new observed position wins.
        progressMs = Math.max(predicted, rawProgressMs)
      }
      // A backwards seek or repeat resets the clock to the observed position.
    }

    const result = { ...media, progressMs: Math.max(0, Math.min(progressMs, media.durationMs)) }
    previous = { ...result, rawProgressMs }
    return result
  }
}

const stabilizeTimeline = createSpotifyTimelineStabilizer()
let liveInFlight = null

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
  if (liveInFlight) return liveInFlight
  liveInFlight = new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SPOTIFY_WINDOW_SCRIPT], {
      encoding: 'utf8', windowsHide: true, timeout: 6000, maxBuffer: 64 * 1024
    }, (error, stdout) => {
      resolve(error ? null : stabilizeTimeline(parseSpotifyWindowResult(stdout)))
    })
  })
  return liveInFlight.finally(() => { liveInFlight = null })
}

module.exports = { getSpotifyWindowTrack, parseSpotifyWindowTitle, parseSpotifyWindowResult, createSpotifyTimelineStabilizer, shouldTrySpotifyWindowFallback }

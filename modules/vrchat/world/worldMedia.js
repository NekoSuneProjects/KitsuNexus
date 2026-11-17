// modules/vrchat/world/worldMedia.js
// Works out "what's playing in this instance" from VRChat's output log, for
// Discord Rich Presence. Same log sources VRCX reads:
//   - Popcorn Palace  [VRCX] VideoPlay(PopcornPalace) {json}
//   - VR Dancing      [VRCX] VideoPlay(VRDancing) "url",pos,len,id,"name","title"
//   - LS Media        [VRCX] LSMedia pos,len,displayName,title,quality
//   - ProTV-style     nowplaying {"id":"Main-1","type":"mediaChange",...}  (https://protv.dev/guides/nowplaying)
//   - Any video player URL (AVPro / Unity / SDK2 / USharpVideo) -> YouTube title via oEmbed
// Runs in the MAIN process. One tracker per world tracker; reset on instance change.

const https = require('https')

// Worlds with their own media integration (ids from VRCX). `kind` decides the
// presence wording: 'listen' = dance worlds, 'watch' = cinemas.
const MEDIA_WORLDS = {
  'wrld_f20326da-f1ac-45fc-a062-609723b097b1': { label: 'PyPyDance', kind: 'listen' },
  'wrld_10e5e467-fc65-42ed-8957-f02cace1398c': { label: 'PyPyDance', kind: 'listen' },
  'wrld_04899f23-e182-4a8d-b2c7-2c74c7c15534': { label: 'PyPyDance', kind: 'listen' },
  'wrld_42377cf1-c54f-45ed-8996-5875b0573a83': { label: 'VR Dancing', kind: 'listen' },
  'wrld_dd6d2888-dbdc-47c2-bc98-3d631b2acd7c': { label: 'VR Dancing', kind: 'listen' },
  'wrld_52bdcdab-11cd-4325-9655-0fb120846945': { label: 'ZuwaZuwa Dance', kind: 'listen' },
  'wrld_2d40da63-8f1f-4011-8a9e-414eb8530acd': { label: 'ZuwaZuwa Dance', kind: 'listen' },
  'wrld_74970324-58e8-4239-a17b-2c59dfdf00db': { label: 'LS Media', kind: 'watch' },
  'wrld_db9d878f-6e76-4776-8bf2-15bcdd7fc445': { label: 'LS Media', kind: 'watch' },
  'wrld_435bbf25-f34f-4b8b-82c6-cd809057eb8e': { label: 'LS Media', kind: 'watch' },
  'wrld_f767d1c8-b249-4ecc-a56f-614e433682c8': { label: 'LS Media', kind: 'watch' },
  'wrld_266523e8-9161-40da-acd0-6bd82e075833': { label: 'Popcorn Palace', kind: 'watch' },
  'wrld_27c7e6b2-d938-447e-a270-3d1a873e2cf3': { label: 'Popcorn Palace', kind: 'watch' }
}

// A generic video with no known length is dropped this long after it started.
const UNKNOWN_LENGTH_TTL_MS = 30 * 60 * 1000

/* ---------- small helpers ---------- */

// VRChat log lines start with a local "YYYY.MM.DD HH:MM:SS".
function lineTime (line) {
  const m = String(line).match(/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
  if (!m) return Date.now()
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  return Number.isFinite(t) ? t : Date.now()
}

const httpsOnly = u => (/^https:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '')

function youtubeId (raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch (_) { return '' }
  // Redirector/proxy hosts that wrap the real URL (same list as VRCX).
  if (['https://t-ne.x0.to', 'https://nextnex.com', 'https://r.0cm.org'].includes(url.origin)) {
    try { url = new URL(url.searchParams.get('url') || '') } catch (_) { return '' }
  }
  if (/^https:\/\/u2b\.cx\//.test(raw)) { try { url = new URL(String(raw).slice(15)) } catch (_) { return '' } }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id = ''
  if (host === 'youtu.be') id = url.pathname.split('/')[1]
  else if (host === 'youtube.com') {
    const [, section, pathId] = url.pathname.split('/')
    if (section === 'watch') id = url.searchParams.get('v')
    else if (['shorts', 'live', 'embed'].includes(section)) id = pathId
  }
  return /^[\w-]{11}$/.test(id || '') ? id : ''
}

const ytThumb = id => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '')

// YouTube oEmbed: title without an API key. Cached; failures cache as ''.
const titleCache = new Map()
function fetchYoutubeTitle (id) {
  if (titleCache.has(id)) return titleCache.get(id)
  const p = new Promise(resolve => {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`
    const req = https.get(url, { timeout: 4000, headers: { 'User-Agent': 'KitsuNexus' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve('') }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy() })
      res.on('end', () => { try { resolve(String(JSON.parse(body).title || '').slice(0, 200)) } catch (_) { resolve('') } })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(''))
  })
  titleCache.set(id, p)
  if (titleCache.size > 300) titleCache.delete(titleCache.keys().next().value)
  return p
}

/* ---------- tracker ---------- */

function createWorldMediaTracker ({ onChange, lookupTitle = fetchYoutubeTitle } = {}) {
  let worldId = ''
  let media = null // what we currently report
  let specific = false // a world integration (PP / VRDancing / LSMedia / nowplaying) is active this instance
  let lastVideoUrl = '' // last raw video URL seen (for the media-link history)
  let seq = 0 // guards async title lookups against newer videos
  const producers = new Map() // nowplaying producers by id

  const worldInfo = () => MEDIA_WORLDS[worldId] || null
  const kindFor = fallback => (worldInfo() ? worldInfo().kind : fallback)
  const changed = () => { if (typeof onChange === 'function') onChange() }

  function set (m) {
    media = m ? {
      source: m.source,
      kind: m.kind || 'watch',
      label: m.label || (worldInfo() ? worldInfo().label : ''),
      videoName: String(m.videoName || '').trim().slice(0, 200),
      thumbnailUrl: httpsOnly(m.thumbnailUrl),
      displayName: String(m.displayName || ''),
      isPaused: !!m.isPaused,
      startedAt: m.startedAt || 0,
      endsAt: m.endsAt || 0,
      expiresAt: m.endsAt ? 0 : (m.startedAt || Date.now()) + UNKNOWN_LENGTH_TTL_MS,
      updatedAt: m.updatedAt || Date.now()
    } : null
    if (media && !media.videoName) media = null
  }

  // pos/len in seconds, at = wall clock of the log line.
  const timing = (at, pos, len, speed = 1) => {
    pos = Math.max(0, Number(pos) || 0); len = Math.max(0, Number(len) || 0); speed = speed > 0 ? speed : 1
    return { startedAt: at - (pos / speed) * 1000, endsAt: len > 0 ? at + (Math.max(0, len - pos) / speed) * 1000 : 0 }
  }

  // Resolve a YouTube title, then publish (unless a newer video replaced it).
  function publishYoutube (id, base) {
    const mine = ++seq
    Promise.resolve(lookupTitle(id)).then(title => {
      if (mine !== seq || !title) return
      set({ ...base, videoName: title, thumbnailUrl: base.thumbnailUrl || ytThumb(id) })
      changed()
    }).catch(() => {})
  }

  function popcornPalace (line, at) {
    const idx = line.indexOf('[VRCX] VideoPlay(PopcornPalace)')
    if (idx === -1) return false
    const j = line.indexOf('{', idx)
    if (j === -1) return false
    let d; try { d = JSON.parse(line.slice(j)) } catch (_) { return false }
    specific = true; seq++
    set(d.videoName ? {
      source: 'PopcornPalace', kind: 'watch', label: 'Popcorn Palace', videoName: d.videoName,
      thumbnailUrl: d.thumbnailUrl, displayName: d.displayName, isPaused: d.isPaused,
      ...timing(at, d.videoPos, d.videoLength), updatedAt: at
    } : null)
    return true
  }

  function vrDancing (line, at) {
    const m = /\[VRCX\] VideoPlay\(VRDancing\) "(.+?)",([\d.]+),([\d.]+),(-?[\d.]+),"(.*?)","(.*?)"/.exec(line)
    if (!m) return false
    specific = true; seq++
    let pos = Number(m[2]); const len = Number(m[3])
    if (pos === len) pos = 0
    let name = m[6]
    const cut = name.indexOf(']</b> ')
    if (cut !== -1) name = name.slice(cut + 6)
    const base = { source: 'VRDancing', kind: 'listen', label: 'VR Dancing', displayName: m[5], ...timing(at, pos, len), updatedAt: at }
    const yt = m[4] === '-1' ? youtubeId(m[1]) : ''
    if (yt) { set(null); publishYoutube(yt, base) } else set({ ...base, videoName: name.replace(/<[^>]*>/g, '') })
    return true
  }

  function lsMedia (line, at) {
    const m = /\[VRCX\] LSMedia ([\d.]+),([\d.]+),(.+?),(.+?),(?=[^,]*$)/.exec(line)
    if (!m) return false
    specific = true; seq++
    set({ source: 'LSMedia', kind: 'watch', label: 'LS Media', displayName: m[3], videoName: m[4], ...timing(at, m[1], m[2]), updatedAt: at })
    return true
  }

  // ProTV "nowplaying" spec: several producers (screens); follow the
  // high-priority one, else the most recently changed one that isn't stopped.
  function nowPlayingSpec (line, at) {
    const k = line.indexOf('nowplaying {')
    if (k === -1) return false
    const end = line.lastIndexOf('}')
    let ev; try { ev = JSON.parse(line.slice(k + 11, end + 1)) } catch (_) { return false }
    if (!ev || typeof ev.id !== 'string' || !ev.id || typeof ev.type !== 'string') return false
    specific = true
    let p = producers.get(ev.id)
    if (!p) { p = { id: ev.id, hasMedia: false, url: '', name: '', image: '', owner: '', length: 0, speed: 1, high: false, pos: 0, wall: at, paused: false, stopped: false, last: 0 }; producers.set(ev.id, p) }
    const posNow = () => (p.paused || p.stopped) ? p.pos : Math.min(p.pos + ((at - p.wall) / 1000) * p.speed, p.length || Infinity)
    const anchor = t => { p.pos = typeof t === 'number' ? Math.max(0, t) : posNow(); p.wall = at }
    switch (ev.type) {
      case 'mediaChange': {
        let url = typeof ev.mediaUrl === 'string' ? ev.mediaUrl : ''
        try { url = decodeURI(url) } catch (_) {}
        Object.assign(p, {
          hasMedia: true, url, name: typeof ev.mediaName === 'string' ? ev.mediaName : '',
          image: httpsOnly(ev.mediaImage) || ytThumb(youtubeId(url)), owner: typeof ev.mediaOwnerName === 'string' ? ev.mediaOwnerName : '',
          length: ev.mediaLength > 0 ? ev.mediaLength : 0, speed: ev.mediaSpeed > 0 ? ev.mediaSpeed : 1,
          high: ev.highPriority === true, pos: 0, wall: at, paused: false, stopped: false, last: ++seq
        })
        break
      }
      case 'mediaInfo':
        if (ev.mediaSpeed > 0) { anchor(); p.speed = ev.mediaSpeed }
        if (typeof ev.mediaName === 'string') p.name = ev.mediaName
        if (typeof ev.mediaImage === 'string') p.image = httpsOnly(ev.mediaImage) || ytThumb(youtubeId(p.url))
        break
      case 'mediaPlay': anchor(ev.mediaTime); p.paused = false; p.stopped = false; break
      case 'mediaPause': anchor(ev.mediaTime); p.paused = true; break
      case 'mediaSeek': anchor(ev.mediaTime); break
      case 'mediaStop': anchor(); p.stopped = true; break
      default: return true // mediaLoading / mediaError / unknown: nothing to show
    }
    let best = null
    for (const q of producers.values()) {
      if (!q.hasMedia || q.stopped) continue
      if (!best || (q.high && !best.high) || (q.high === best.high && q.last > best.last)) best = q
    }
    if (!best) { set(null); return true }
    const speed = best.speed > 0 ? best.speed : 1
    const bestPos = (best.paused || best.stopped) ? best.pos : best.pos + ((at - best.wall) / 1000) * speed
    const base = { source: 'nowplaying', kind: kindFor('watch'), displayName: best.owner, thumbnailUrl: best.image, isPaused: best.paused, ...timing(at, bestPos, best.length, speed), updatedAt: at }
    if (best.name) { seq++; set({ ...base, videoName: best.name }) } else {
      const yt = youtubeId(best.url)
      if (yt) publishYoutube(yt, base); else set(null)
    }
    return true
  }

  // Plain video player URLs. VRChat's own lines + USharpVideo + SDK2.
  function genericVideo (line, at) {
    let m = /\[Video Playback\] (?:Attempting to resolve|Resolving) URL '([^']+)'/.exec(line)
    let url = m && m[1]; let who = ''
    if (!url) { m = /\[USharpVideo\] Started video load for URL: (.+?), requested by (.+)$/.exec(line); if (m) { url = m[1]; who = m[2] } }
    if (!url) { m = /\bUser (.+?) added URL (\S+)/.exec(line); if (m) { url = m[2]; who = m[1] } }
    if (!url) { m = /added URL '([^']+)'/.exec(line); if (m) url = m[1] }
    if (!url) return false
    lastVideoUrl = url.trim()
    // Worlds with their own integration report better data; YouTube on a
    // world that has none still gets a title.
    if (specific || producers.size) return true
    const yt = youtubeId(url)
    if (!yt) return true // non-YouTube URLs aren't shown (could be private streams)
    const base = { source: 'video', kind: kindFor('watch'), displayName: who, startedAt: at, endsAt: 0, updatedAt: at }
    publishYoutube(yt, base)
    return true
  }

  return {
    setWorld (id) { worldId = String(id || '') },
    // Returns true if the line was a media line (handled).
    processLine (line) {
      if (!line) return false
      const at = lineTime(line)
      return popcornPalace(line, at) || vrDancing(line, at) || lsMedia(line, at) || nowPlayingSpec(line, at) || genericVideo(line, at)
    },
    reset () { media = null; specific = false; producers.clear(); seq++ },
    current () { return media ? { ...media } : null },
    lastVideoUrl () { return lastVideoUrl }
  }
}

module.exports = { createWorldMediaTracker, youtubeId, lineTime, MEDIA_WORLDS }

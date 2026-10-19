const https = require('https')

const cache = new Map()
const cacheTtlMs = 30 * 60 * 1000
const requestTimeoutMs = 3500
const maxResponseBytes = 1024 * 1024
const maxCacheEntries = 200

function cacheArtwork (key, result) {
  // Long-running sessions should not retain an unlimited number of tracks.
  if (cache.has(key)) cache.delete(key)
  cache.set(key, { cachedAt: Date.now(), result })
  if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value)
}

function normalizeKeyPart (value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function getCacheKey (media) {
  return [media.artist, media.title, media.album]
    .map(normalizeKeyPart)
    .join('|')
}

function isCloseMatch (candidate, media) {
  const candidateTitle = normalizeKeyPart(candidate.title)
  const candidateArtist = normalizeKeyPart(candidate.artist)
  const title = normalizeKeyPart(media.title)
  const artist = normalizeKeyPart(media.artist)

  if (!title || !artist || !candidateTitle || !candidateArtist) return false

  return (
    candidateTitle.includes(title) ||
    title.includes(candidateTitle)
  ) && (
    candidateArtist.includes(artist) ||
    artist.includes(candidateArtist)
  )
}

function matchingDuration (candidate, media, durationMs) {
  // Only reuse a catalog duration for the exact track title. Similar remixes
  // can share artwork but have substantially different runtimes.
  return normalizeKeyPart(candidate.title) === normalizeKeyPart(media.title) &&
    isCloseMatch(candidate, media) && Number.isFinite(durationMs) &&
    durationMs >= 5000 && durationMs <= 14400000 ? durationMs : 0
}

function safeArtworkUrl (value, allowedRoot) {
  try {
    const url = new URL(String(value || ''))
    const hostname = url.hostname.toLowerCase()
    // Artwork URLs are sent to the renderer. Do not let a provider response
    // turn a music search into a request to an arbitrary/local URL.
    if (url.protocol !== 'https:' || url.username || url.password ||
        (hostname !== allowedRoot && !hostname.endsWith(`.${allowedRoot}`))) return ''
    return url.href
  } catch {
    return ''
  }
}

function getJson (url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'KitsuNexus/' + require('../../package.json').version + ' (https://github.com/NekoSuneProjects/KitsuNexus)'
      }
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      if (Number(response.headers['content-length']) > maxResponseBytes) {
        response.destroy()
        reject(new Error('Artwork response exceeds size limit'))
        return
      }

      let body = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', chunk => {
        bytes += Buffer.byteLength(chunk, 'utf8')
        if (bytes > maxResponseBytes) {
          response.destroy()
          reject(new Error('Artwork response exceeds size limit'))
          return
        }
        body += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
      response.on('error', reject)
      response.on('aborted', () => reject(new Error('Artwork response interrupted')))
    })

    request.setTimeout(requestTimeoutMs, () => {
      request.destroy(new Error('Artwork lookup timed out'))
    })
    request.on('error', reject)
  })
}

function getBestItunesArtworkUrl (result) {
  const image = result.artworkUrl100 || result.artworkUrl60 || result.artworkUrl30 || ''
  return safeArtworkUrl(image.replace(/\d+x\d+bb\.(jpg|png)$/i, '600x600bb.$1'), 'mzstatic.com')
}

async function lookupItunesArtwork (media) {
  const term = [media.artist, media.title, media.album].filter(Boolean).join(' ')
  if (!term) return null

  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    limit: '10'
  }).toString()}`

  const data = await getJson(url)
  const result = (data.results || []).find(item => isCloseMatch({
    title: item.trackName,
    artist: item.artistName
  }, media))

  const image = result ? getBestItunesArtworkUrl(result) : ''
  if (!image) return null

  return {
    image,
    source: 'iTunes Search',
    album: result.collectionName || '',
    durationMs: matchingDuration({ title: result.trackName, artist: result.artistName }, media, Number(result.trackTimeMillis))
  }
}

async function lookupDeezerArtwork (media) {
  const queryParts = []
  if (media.artist) queryParts.push(`artist:"${media.artist}"`)
  if (media.title) queryParts.push(`track:"${media.title}"`)
  if (media.album) queryParts.push(`album:"${media.album}"`)
  const query = queryParts.length > 0 ? queryParts.join(' ') : [media.artist, media.title].filter(Boolean).join(' ')
  if (!query) return null

  const url = `https://api.deezer.com/search/track?${new URLSearchParams({
    q: query,
    limit: '10'
  }).toString()}`

  const data = await getJson(url)
  const result = (data.data || []).find(item => isCloseMatch({
    title: item.title,
    artist: item.artist?.name
  }, media))

  const image = safeArtworkUrl(result?.album?.cover_xl || result?.album?.cover_big || result?.artist?.picture_xl || '', 'dzcdn.net')
  if (!image) return null

  return {
    image,
    source: 'Deezer Search',
    album: result.album?.title || '',
    durationMs: matchingDuration({ title: result.title, artist: result.artist?.name }, media, Number(result.duration) * 1000)
  }
}

async function lookupArtwork (media) {
  if (!media || !media.title || !media.artist) return null

  const cacheKey = getCacheKey(media)
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < cacheTtlMs) {
    return cached.result
  }

  const lookups = [
    lookupDeezerArtwork,
    lookupItunesArtwork
  ]

  for (const lookup of lookups) {
    try {
      const result = await lookup(media)
      if (result?.image) {
        cacheArtwork(cacheKey, result)
        return result
      }
    } catch {
      // Try the next provider.
    }
  }

  cacheArtwork(cacheKey, null)
  return null
}

module.exports = {
  lookupArtwork
}

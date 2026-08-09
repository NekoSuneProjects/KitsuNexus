'use strict'

const os = require('os')
const path = require('path')

const MAX_AUDIO_BYTES = 12 * 1024 * 1024
const ACRCLOUD_MAX_AUDIO_BYTES = 5 * 1024 * 1024

function clean (value) { return String(value || '').trim() }

function optionalNodeShazamCandidates () {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return [
    clean(process.env.NEKOSUNE_NODE_SHAZAM_PATH),
    path.join(appData, 'NekoSuneAPPSVRC', 'optional-providers', 'node_modules', 'node-shazam'),
    'node-shazam'
  ].filter(Boolean)
}

function loadOptionalNodeShazam () {
  for (const candidate of optionalNodeShazamCandidates()) {
    try { return { module: require(candidate), location: candidate } } catch (_) {}
  }
  return null
}

function getProviderStatus () {
  const optionalShazam = loadOptionalNodeShazam()
  return {
    audd: true,
    acrcloud: true,
    nodeShazam: !!optionalShazam,
    nodeShazamBundled: false,
    order: ['audd', 'acrcloud', 'node-shazam']
  }
}

function normalizeAudD (song) {
  if (!song) return null
  const spotifyUrl = typeof song.streamingUrl === 'function' ? song.streamingUrl('spotify') : ''
  return {
    artist: song.artist || '',
    title: song.title || '',
    album: song.album || '',
    release_date: song.releaseDate || '',
    label: song.label || '',
    timecode: song.timecode || '',
    song_link: song.songLink || spotifyUrl || '',
    artwork: song.thumbnailUrl || ''
  }
}

async function recognizeWithAudD (audio, token) {
  const apiToken = clean(token)
  if (!apiToken) throw new Error('AudD token is not configured.')
  const { AudD } = require('@audd/sdk')
  const client = new AudD(apiToken, { maxRetries: 1 })
  try {
    const song = await client.recognize(audio, { returnMetadata: ['spotify', 'apple_music'], timeoutMs: 30000 })
    return normalizeAudD(song)
  } finally {
    if (typeof client.close === 'function') client.close()
  }
}

function normalizeAcrCloud (payload) {
  if (Number(payload?.status?.code) !== 0) {
    throw new Error(payload?.status?.msg || `ACRCloud returned status ${payload?.status?.code ?? 'unknown'}.`)
  }
  const song = payload?.metadata?.music?.[0]
  if (!song) return null
  const spotifyId = song.external_metadata?.spotify?.track?.id
  const youtubeId = song.external_metadata?.youtube?.vid
  return {
    artist: (song.artists || []).map(artist => artist.name).filter(Boolean).join(', '),
    title: song.title || '',
    album: song.album?.name || '',
    release_date: song.release_date || '',
    label: song.label || '',
    timecode: song.play_offset_ms != null ? `${Math.round(Number(song.play_offset_ms) / 1000)}s` : '',
    song_link: spotifyId ? `https://open.spotify.com/track/${spotifyId}` : youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : '',
    artwork: ''
  }
}

async function recognizeWithAcrCloud (audio, credentials = {}) {
  const host = clean(credentials.host)
  const accessKey = clean(credentials.accessKey)
  const accessSecret = clean(credentials.accessSecret)
  if (!host || !accessKey || !accessSecret) throw new Error('ACRCloud host, access key and access secret are required.')
  if (audio.length > ACRCLOUD_MAX_AUDIO_BYTES) throw new Error('ACRCloud audio clips must be smaller than 5 MB.')
  const ACRCloud = require('acrcloud')
  const client = new ACRCloud({ host, access_key: accessKey, access_secret: accessSecret, data_type: 'audio' })
  return normalizeAcrCloud(await client.identify(audio))
}

function normalizeNodeShazam (payload) {
  if (!payload) return null
  if (payload.title || payload.artist) {
    return { artist: payload.artist || '', title: payload.title || '', album: payload.album || '', release_date: payload.year || '', song_link: '', artwork: '' }
  }
  const track = payload.track
  if (!track) return null
  const songSection = (track.sections || []).find(section => section.type === 'SONG')
  const metadata = Object.fromEntries((songSection?.metadata || []).map(item => [item.title, item.text]))
  return {
    artist: track.subtitle || '',
    title: track.title || '',
    album: metadata.Album || '',
    release_date: metadata.Released || '',
    label: '',
    timecode: '',
    song_link: track.share?.href || track.url || '',
    artwork: track.images?.coverarthq || track.images?.coverart || ''
  }
}

async function recognizeWithNodeShazam (audio) {
  const optional = loadOptionalNodeShazam()
  if (!optional) {
    throw new Error('node-shazam is not installed. It is an optional GPL-2.0 external fallback and is not bundled with NekoSuneAPPSVRC.')
  }
  const { Shazam } = optional.module
  const client = new Shazam()
  return normalizeNodeShazam(await client.recognise(audio, 'en', false))
}

function providerOrder (request = {}) {
  const provider = clean(request.provider || 'auto').toLowerCase()
  if (provider !== 'auto') return [provider]
  const order = []
  if (clean(request.token)) order.push('audd')
  if (clean(request.acrHost) && clean(request.acrAccessKey) && clean(request.acrAccessSecret)) order.push('acrcloud')
  order.push('node-shazam')
  return order
}

async function recognizeAudio ({ audio, token, provider = 'auto', acrHost, acrAccessKey, acrAccessSecret } = {}) {
  const data = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || '')
  if (!data.length) throw new Error('No desktop audio was captured.')
  if (data.length > MAX_AUDIO_BYTES) throw new Error('Audio clip is larger than 12 MB.')

  const attempts = []
  for (const name of providerOrder({ provider, token, acrHost, acrAccessKey, acrAccessSecret })) {
    try {
      let match
      if (name === 'audd') match = await recognizeWithAudD(data, token)
      else if (name === 'acrcloud') match = await recognizeWithAcrCloud(data, { host: acrHost, accessKey: acrAccessKey, accessSecret: acrAccessSecret })
      else if (name === 'node-shazam') match = await recognizeWithNodeShazam(data)
      else throw new Error(`Unknown song recognition provider: ${name}`)
      return { ok: true, provider: name, match, attempts }
    } catch (err) {
      attempts.push({ provider: name, error: err.message })
      if (clean(provider).toLowerCase() !== 'auto') throw err
    }
  }
  const summary = attempts.map(attempt => `${attempt.provider}: ${attempt.error}`).join(' | ')
  throw new Error(summary || 'Configure at least one song recognition provider.')
}

module.exports = {
  recognizeAudio,
  getProviderStatus,
  providerOrder,
  normalizeAudD,
  normalizeAcrCloud,
  normalizeNodeShazam,
  loadOptionalNodeShazam,
  MAX_AUDIO_BYTES,
  ACRCLOUD_MAX_AUDIO_BYTES
}

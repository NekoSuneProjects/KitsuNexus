// Loopback input bridge for devices that Pulsoid/HypeRate do not
// support directly. Device-specific software only has to POST a BPM value to
// this loopback server; this module handles the rest of NekoSuneAPPSVRC and can
// optionally mirror the reading to Pulsoid's write API.

const http = require('http')
const https = require('https')

const DEFAULT_PORT = 7392
const STALE_MS = 15000
const MAX_BODY_BYTES = 16 * 1024
const PULSOID_URL = new URL('https://dev.pulsoid.net/api/v1/data')

let server = null
let onUpdate = null
let staleTimer = null
let lastBpm = 0
let lastReadingAt = 0
let relayEnabled = false
let relayToken = ''
let sumBpm = 0
let countBpm = 0
let maxBpm = 0
let minBpm = 0

function resetSession () {
  lastBpm = 0; lastReadingAt = 0
  sumBpm = 0; countBpm = 0; maxBpm = 0; minBpm = 0
}

function recordBpm (bpm) {
  sumBpm += bpm; countBpm += 1
  maxBpm = maxBpm ? Math.max(maxBpm, bpm) : bpm
  minBpm = minBpm ? Math.min(minBpm, bpm) : bpm
}

function isOnline () { return !!(server && lastReadingAt && Date.now() - lastReadingAt < STALE_MS) }

function emit (extra = {}) {
  if (typeof onUpdate !== 'function') return
  onUpdate({
    bpm: isOnline() ? lastBpm : 0,
    online: isOnline(),
    listening: !!server,
    avg: countBpm ? Math.round(sumBpm / countBpm) : 0,
    max: maxBpm,
    min: minBpm,
    at: Date.now(),
    ...extra
  })
}

// Accept the common shapes used by Pulsoid, HypeRate, Home Assistant, small
// bridge scripts and microcontrollers. A bare JSON number is accepted too.
function extractBpm (payload) {
  const candidates = typeof payload === 'object' && payload !== null
    ? [payload.bpm, payload.heart_rate, payload.heartRate, payload.hr, payload.value,
        payload.data?.heart_rate, payload.data?.bpm, payload.payload?.hr]
    : [payload]
  const value = candidates.find(v => v !== undefined && v !== null && v !== '')
  const bpm = Number(value)
  return Number.isFinite(bpm) && bpm > 0 && bpm <= 300 ? Math.round(bpm) : 0
}

function relayToPulsoid (bpm, measuredAt) {
  if (!relayEnabled || !relayToken) return
  const body = JSON.stringify({ measured_at: measuredAt, data: { heart_rate: bpm } })
  const req = https.request(PULSOID_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${relayToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    },
    timeout: 5000
  }, res => {
    res.resume()
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.warn(`Pulsoid heart-rate relay returned HTTP ${res.statusCode}`)
    }
  })
  req.on('timeout', () => req.destroy(new Error('Pulsoid relay timed out')))
  req.on('error', err => console.warn('Pulsoid heart-rate relay error:', err.message))
  req.end(body)
}

function acceptBpm (bpm, measuredAt = Date.now()) {
  lastBpm = bpm
  lastReadingAt = Date.now()
  recordBpm(bpm)
  emit()
  relayToPulsoid(bpm, Number.isFinite(Number(measuredAt)) ? Number(measuredAt) : Date.now())
  clearTimeout(staleTimer)
  staleTimer = setTimeout(() => emit(), STALE_MS + 10)
}

function submitDeviceBpm (value, measuredAt = Date.now()) {
  const bpm = extractBpm(value)
  if (!server || !bpm) return false
  acceptBpm(bpm, measuredAt)
  return true
}

function sendJson (res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(JSON.stringify(body))
}

function handleRequest (req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (req.method === 'OPTIONS') return sendJson(res, 204, {})
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    return sendJson(res, 200, { ok: true, online: isOnline(), bpm: isOnline() ? lastBpm : 0 })
  }

  const validPath = ['/heart-rate', '/api/heart-rate', '/api/v1/data'].includes(url.pathname)
  if (req.method === 'GET' && validPath) {
    const bpm = extractBpm(url.searchParams.get('bpm') || url.searchParams.get('heart_rate') || url.searchParams.get('hr'))
    if (!bpm) return sendJson(res, 400, { ok: false, error: 'BPM must be between 1 and 300' })
    acceptBpm(bpm)
    return sendJson(res, 200, { ok: true, bpm })
  }
  if (req.method !== 'POST' || !validPath) return sendJson(res, 404, { ok: false, error: 'Not found' })

  let size = 0
  const chunks = []
  req.on('data', chunk => {
    size += chunk.length
    if (size > MAX_BODY_BYTES) req.destroy()
    else chunks.push(chunk)
  })
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      let payload
      try { payload = JSON.parse(raw) } catch (_) { payload = raw }
      const bpm = extractBpm(payload)
      if (!bpm) return sendJson(res, 400, { ok: false, error: 'BPM must be between 1 and 300' })
      const measuredAt = payload && typeof payload === 'object' ? (payload.measured_at || payload.measuredAt) : undefined
      acceptBpm(bpm, measuredAt)
      sendJson(res, 200, { ok: true, bpm })
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message })
    }
  })
}

function startDeviceBridge (options, listener) {
  stopDeviceBridge()
  options = options || {}
  onUpdate = listener
  relayEnabled = !!options.relayEnabled
  relayToken = String(options.relayToken || '').trim()
  const port = Math.max(1, Math.min(65535, Number(options.port) || DEFAULT_PORT))
  resetSession()

  return new Promise(resolve => {
    const nextServer = http.createServer(handleRequest)
    nextServer.once('error', err => {
      if (server === nextServer) server = null
      emit({ error: err.message })
      resolve({ ok: false, error: err.message })
    })
    nextServer.listen(port, '127.0.0.1', () => {
      server = nextServer
      emit()
      resolve({ ok: true, port, endpoint: `http://127.0.0.1:${port}/heart-rate` })
    })
    server = nextServer
  })
}

function stopDeviceBridge () {
  clearTimeout(staleTimer); staleTimer = null
  const oldServer = server
  server = null
  if (oldServer) {
    try { oldServer.close() } catch (_) { /* ignore */ }
  }
  lastReadingAt = 0
  emit()
}

module.exports = { startDeviceBridge, stopDeviceBridge, submitDeviceBpm, extractBpm, DEFAULT_PORT }

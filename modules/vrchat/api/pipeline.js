// modules/vrchat/api/pipeline.js
// VRChat's real-time "pipeline" websocket (wss://pipeline.vrchat.cloud), the
// same live feed VRCX uses: friend online/offline/location/profile updates,
// friend added/removed, notifications. Needs the logged-in `auth` cookie token.
// Reconnects with backoff; gives up after repeated auth failures until start()
// is called again (e.g. after logging in). Runs in the MAIN process.

const WebSocket = require('ws')

const URL_BASE = 'wss://pipeline.vrchat.cloud/'
const MAX_BACKOFF_MS = 5 * 60 * 1000

function createPipeline ({ getToken, userAgent = 'KitsuNexus', onEvent, onStatus, WS = WebSocket } = {}) {
  let ws = null
  let stopped = true
  let backoff = 5000
  let reconnectTimer = null
  let failures = 0
  let status = 'stopped'

  const setStatus = s => { status = s; if (typeof onStatus === 'function') onStatus(s) }

  function handleMessage (raw) {
    let msg
    try { msg = JSON.parse(String(raw)) } catch (_) { return }
    if (!msg || typeof msg.type !== 'string') return
    // `content` is usually a JSON string, sometimes an object.
    let content = msg.content
    if (typeof content === 'string') { try { content = JSON.parse(content) } catch (_) { /* plain string */ } }
    if (msg.err) { console.warn('[pipeline] error:', msg.err); return }
    if (typeof onEvent === 'function') {
      try { onEvent(msg.type, content || {}) } catch (err) { console.warn('[pipeline] handler error:', err.message) }
    }
  }

  function scheduleReconnect () {
    if (stopped || reconnectTimer) return
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, backoff)
    if (reconnectTimer.unref) reconnectTimer.unref()
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }

  function connect () {
    if (stopped) return
    const token = getToken && getToken()
    if (!token) { setStatus('no-auth'); scheduleReconnect(); return }
    setStatus('connecting')
    let opened = false
    try {
      ws = new WS(`${URL_BASE}?authToken=${encodeURIComponent(token)}`, { headers: { 'User-Agent': userAgent } })
    } catch (err) { setStatus('error'); scheduleReconnect(); return }
    ws.on('open', () => { opened = true; failures = 0; backoff = 5000; setStatus('connected') })
    ws.on('message', handleMessage)
    ws.on('unexpected-response', (req, res) => {
      // 401/403 = token rejected; stop hammering after a few tries.
      if (res && (res.statusCode === 401 || res.statusCode === 403)) failures += 3
    })
    ws.on('error', () => { /* 'close' follows */ })
    ws.on('close', () => {
      ws = null
      if (stopped) return
      if (!opened) failures++
      if (failures >= 6) { setStatus('auth-failed'); stopped = true; return }
      setStatus('reconnecting')
      scheduleReconnect()
    })
  }

  return {
    start () {
      if (!stopped && ws) return
      stopped = false; failures = 0; backoff = 5000
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      connect()
    },
    stop () {
      stopped = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.terminate() } catch (_) {} ws = null }
      setStatus('stopped')
    },
    status: () => status,
    _handleMessage: handleMessage
  }
}

module.exports = { createPipeline }

// Shared VRChat.js transport for KitsuNexus.
// All VRChat API traffic in vrchatApi.js goes through the `vrchat` npm SDK client.

const { EventEmitter } = require('events')
const { VRChat } = require('vrchat')
const settings = require('../../../settings')
const pkg = require('../../../package.json')

const APP = { name: 'KitsuNexus', version: pkg.version || '1.0.0', contact: 'nekosunevr@nekosunevr.co.uk' }
const LEGACY_COOKIE_KEY = 'vrchatCookies'
const STORE_ROOT = 'vrchatSdkKeyv'
const COOKIE_SHADOW_KEY = 'vrchatSdkCookieShadow'
const LOGIN_STATE_KEY = 'vrchatSdkLoggedIn'

class ElectronStoreKeyvAdapter extends EventEmitter {
  constructor () { super(); this.opts = { namespace: 'kitsunexus-vrchat' } }
  _slot (key) { return `${STORE_ROOT}.${Buffer.from(String(key)).toString('base64url')}` }
  async get (key) { return settings.get(this._slot(key), undefined) }
  async set (key, value) {
    settings.set(this._slot(key), value)
    const cookies = extractCookies(value)
    if (cookies.length) settings.set(COOKIE_SHADOW_KEY, cookies)
    return true
  }
  async delete (key) { settings.delete(this._slot(key)); return true }
  async clear () { settings.delete(STORE_ROOT); settings.delete(COOKIE_SHADOW_KEY) }
}

function extractCookies (value) {
  let v = value
  for (let i = 0; i < 4; i++) {
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch (_) { return [] }; continue }
    if (v && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, 'value')) { v = v.value; continue }
    break
  }
  if (!Array.isArray(v)) return []
  return v.filter(c => c && typeof c.name === 'string' && typeof c.value === 'string')
    .map(c => ({ name: c.name, value: c.value, expires: c.expires || c.expiry || null }))
}

// Value of the `auth` cookie (for the pipeline websocket), or ''.
function getAuthToken () {
  const m = persistedCookieHeader().match(/(?:^|;\s*)auth=([^;]+)/)
  return m ? m[1] : ''
}

function persistedCookieHeader () {
  const saved = settings.get(COOKIE_SHADOW_KEY, []) || []
  if (Array.isArray(saved) && saved.length) return saved.filter(c => c && c.name && c.value).map(c => `${c.name}=${c.value}`).join('; ')
  const legacy = settings.get(LEGACY_COOKIE_KEY, {}) || {}
  return Object.entries(legacy).map(([k, v]) => `${k}=${v}`).join('; ')
}

const keyvStore = new ElectronStoreKeyvAdapter()
let client
let currentUserId = ''
let pendingTwoFactorMethods = []
let rateLimitedUntil = 0
const cache = new Map()
const inflight = new Map()

function buildClient () {
  const cookie = persistedCookieHeader()
  const c = new VRChat({ application: APP, keyv: keyvStore, headers: cookie ? { cookie } : undefined })
  if (c.client && c.client.interceptors && c.client.interceptors.response) {
    c.client.interceptors.response.use(async response => {
      if (response && response.status === 429) {
        const retry = parseInt(response.headers && response.headers.get && response.headers.get('retry-after'), 10)
        rateLimitedUntil = Date.now() + (retry ? retry * 1000 : 60000)
        stats.limited()
        console.warn(`[vrchat] 429 rate limited; pausing all VRChat API requests for ${retry || 60}s`)
      }
      try {
        const type = response && response.headers && response.headers.get && response.headers.get('content-type')
        if (type && type.includes('application/json')) {
          const data = await response.clone().json()
          if (data && Array.isArray(data.requiresTwoFactorAuth)) pendingTwoFactorMethods = data.requiresTwoFactorAuth.slice()
        }
      } catch (_) {}
      return response
    })
  }
  return c
}
client = buildClient()

function qs (query) {
  if (!query) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach(x => p.append(k, String(x)))
    else p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

function errorOf (value, fallback) {
  const e = value && value.error
  if (typeof e === 'string') return e
  if (e && e.message) return e.message
  if (e && e.error && e.error.message) return e.error.message
  if (value && value.data && value.data.error && value.data.error.message) return value.data.error.message
  const status = value && value.response && value.response.status
  return fallback || (status ? `HTTP ${status}` : 'VRChat API request failed')
}

function success (value) {
  if (!value) return false
  const status = value.response && value.response.status
  if (typeof status === 'number') return status >= 200 && status < 300
  return !value.error && Object.prototype.hasOwnProperty.call(value, 'data')
}

async function raw (method, url, query, body) {
  if (!client.client || typeof client.client.request !== 'function') return { error: { message: 'VRChat SDK raw client unavailable' } }
  const options = { method, url: `${url}${qs(query)}` }
  if (body !== undefined) {
    options.headers = { 'content-type': 'application/json' }
    options.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return client.client.request(options)
}

/* ---------------- request pacing ----------------
 * VRChat asks third-party apps not to burst its API (other tools such as VRCX warn when
 * one does). Every request (SDK method or raw) goes through this queue: at most
 * MAX_CONCURRENT in flight, starts at least MIN_GAP_MS apart. While a 429 back-off is
 * active nothing is sent: new and queued calls fail fast with a 429 result (callers
 * using memo() get their cached value instead).
 */
const MAX_CONCURRENT = 2
const MIN_GAP_MS = 350
let active = 0
let lastStart = 0
let pumpTimer = null
const queue = []

function rateLimitedResult () {
  const s = Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000))
  return { ok: false, status: 429, rateLimited: true, error: `VRChat asked KitsuNexus to slow down — try again in ${s}s` }
}

function schedule (label, fn) {
  return new Promise(resolve => { queue.push({ label, fn, resolve }); pump() })
}

function pump () {
  if (pumpTimer) return
  if (isRateLimited()) { while (queue.length) queue.shift().resolve(rateLimitedResult()); return }
  while (active < MAX_CONCURRENT && queue.length) {
    const wait = lastStart + MIN_GAP_MS - Date.now()
    if (wait > 0) { pumpTimer = setTimeout(() => { pumpTimer = null; pump() }, wait); return }
    const job = queue.shift()
    active++
    lastStart = Date.now()
    stats.record(job.label)
    Promise.resolve().then(job.fn).then(job.resolve, e => job.resolve({ thrown: e })).finally(() => { active--; pump() })
  }
}

/* ---------------- request stats (for debugging traffic) ---------------- */
const stats = (() => {
  const recent = [] // [ts, endpoint] for the last 10 minutes
  const totals = new Map()
  let total = 0
  let limited = 0
  let lastWarn = 0
  // "GET /users/usr_abc/groups" -> "GET /users/:id/groups"
  const norm = label => String(label || '?').split('?')[0]
    .replace(/\/(usr|wrld|grp|avtr|file|not|inst|gpst|frq|ufav|fvgrp|prnt|inv|emj|stkr|grol)_[0-9a-zA-Z-]+/g, '/:id')
    .replace(/\/wrld_[^/:]+:[^/]+/g, '/:location')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
  return {
    record (label) {
      const ep = norm(label); const now = Date.now()
      total++; totals.set(ep, (totals.get(ep) || 0) + 1)
      recent.push([now, ep])
      while (recent.length && now - recent[0][0] > 600000) recent.shift()
      const lastMin = recent.filter(r => now - r[0] < 60000).length
      if (lastMin > 60 && now - lastWarn > 60000) {
        lastWarn = now
        const top = {}; for (const [t, e] of recent) if (now - t < 60000) top[e] = (top[e] || 0) + 1
        console.warn(`[vrchat] ${lastMin} API requests in the last minute:`, Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8))
      }
    },
    limited () { limited++ },
    snapshot () {
      const now = Date.now()
      const by = (ms) => { const m = {}; for (const [t, e] of recent) if (now - t < ms) m[e] = (m[e] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([endpoint, count]) => ({ endpoint, count })) }
      return {
        total,
        lastMinute: recent.filter(r => now - r[0] < 60000).length,
        last10Minutes: recent.length,
        topLast10Minutes: by(600000),
        topAllTime: [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([endpoint, count]) => ({ endpoint, count })),
        queued: queue.length,
        inFlight: active,
        rateLimited: isRateLimited(),
        rateLimitedForSeconds: isRateLimited() ? Math.ceil((rateLimitedUntil - now) / 1000) : 0,
        times429: limited,
        pacing: { maxConcurrent: MAX_CONCURRENT, minGapMs: MIN_GAP_MS }
      }
    }
  }
})()
function getStats () { return stats.snapshot() }

// Pace any other request to VRChat's servers (e.g. auth-gated file/image downloads made
// with axios) through the same queue. fn() should resolve to a result object.
async function paced (label, fn) {
  if (isRateLimited()) return rateLimitedResult()
  const out = await schedule(label, fn)
  if (out && out.thrown) throw out.thrown
  return out
}

async function call (name, options, fallback, message) {
  if (isRateLimited()) return rateLimitedResult()
  const label = fallback && fallback.url ? `${fallback.method || 'GET'} ${fallback.url}` : String(name)
  const out = await schedule(label, () => send(name, options, fallback, message))
  if (out && out.thrown) throw out.thrown
  return out
}

async function send (name, options, fallback, message) {
  try {
    let value
    if (name && typeof client[name] === 'function') value = await client[name](options || {})
    else if (fallback) value = await raw(fallback.method || 'GET', fallback.url, fallback.query, fallback.body)
    else return { ok: false, error: `vrchat SDK method ${name} is unavailable` }
    if (success(value)) return { ok: true, data: value.data, response: value.response, status: value.response && value.response.status }
    return { ok: false, error: errorOf(value, message), data: value && value.data, status: value && value.response && value.response.status }
  } catch (e) {
    // The vrchat SDK only tries to JSON-parse a response body once it's already confirmed a
    // 2xx status (its request() only calls response.json() inside `if (response.ok)`), so a
    // SyntaxError landing here means the request itself succeeded but VRChat sent back an
    // empty/non-JSON body — seen on e.g. PUT /avatars/:id/select, which doesn't reliably
    // return one. Treat that as success rather than surfacing a confusing "Unexpected end of
    // JSON input"/"is not valid JSON" error for an action that actually went through.
    if (e instanceof SyntaxError) return { ok: true, data: undefined }
    return { ok: false, error: (e && e.message) || message || 'VRChat API request failed', status: e && e.response && e.response.status }
  }
}

async function request (method, url, query, body, message) {
  return call(null, null, { method, url, query, body }, message)
}

// Cached, de-duplicated call. `failTtl` (optional) also caches a failed result for that
// long, so lookups that keep failing (deleted user, private world → 404) aren't re-sent
// on every refresh. Rate-limit failures are never cached.
function memo (key, ttl, fn, failTtl = 0) {
  const hit = cache.get(key)
  if (hit) {
    const age = Date.now() - hit.ts
    if (hit.value && hit.value.ok && (age < ttl || isRateLimited())) return Promise.resolve(hit.value)
    if (hit.value && !hit.value.ok && age < hit.failTtl) return Promise.resolve(hit.value)
  }
  if (inflight.has(key)) return inflight.get(key)
  const p = Promise.resolve().then(fn).then(value => {
    if (value && value.ok) cache.set(key, { ts: Date.now(), value })
    else if (failTtl > 0 && value && !value.rateLimited && value.status !== 429 && !isRateLimited()) cache.set(key, { ts: Date.now(), value, failTtl })
    inflight.delete(key)
    return value
  }).catch(e => { inflight.delete(key); throw e })
  inflight.set(key, p)
  return p
}

function invalidate (prefix) { for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key) }
function isRateLimited () { return Date.now() < rateLimitedUntil }
// For requests made outside the SDK client (axios) that got a 429.
function noteRateLimit (retryAfterSeconds) {
  rateLimitedUntil = Date.now() + (retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 60000)
  stats.limited()
}
function getClient () { return client }
function setCurrentUserId (id) { currentUserId = id || '' }
function getCurrentUserId () { return currentUserId }
function getTwoFactorMethods () { return pendingTwoFactorMethods.slice() }
function clearTwoFactorMethods () { pendingTwoFactorMethods = [] }
function setLoggedIn (on) { settings.set(LOGIN_STATE_KEY, !!on) }
function isLoggedIn () {
  if (settings.get(LOGIN_STATE_KEY, false)) return true
  const saved = settings.get(COOKIE_SHADOW_KEY, []) || []
  if (Array.isArray(saved) && saved.some(c => c && c.name === 'auth' && c.value)) return true
  const legacy = settings.get(LEGACY_COOKIE_KEY, {}) || {}
  return !!legacy.auth
}
function logout () {
  setLoggedIn(false)
  settings.delete(LEGACY_COOKIE_KEY)
  settings.delete(STORE_ROOT)
  settings.delete(COOKIE_SHADOW_KEY)
  currentUserId = ''
  pendingTwoFactorMethods = []
  rateLimitedUntil = 0
  invalidate()
  client = buildClient()
}

module.exports = {
  APP, call, request, memo, invalidate, isRateLimited, getClient, getStats, paced, noteRateLimit,
  setCurrentUserId, getCurrentUserId, getTwoFactorMethods, clearTwoFactorMethods,
  setLoggedIn, isLoggedIn, logout, persistedCookieHeader, getAuthToken
}

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
        console.warn('[vrchat] 429 rate limited; backing off')
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

async function call (name, options, fallback, message) {
  try {
    let value
    if (name && typeof client[name] === 'function') value = await client[name](options || {})
    else if (fallback) value = await raw(fallback.method || 'GET', fallback.url, fallback.query, fallback.body)
    else return { ok: false, error: `vrchat SDK method ${name} is unavailable` }
    if (success(value)) return { ok: true, data: value.data, response: value.response, status: value.response && value.response.status }
    return { ok: false, error: errorOf(value, message), data: value && value.data, status: value && value.response && value.response.status }
  } catch (e) {
    return { ok: false, error: (e && e.message) || message || 'VRChat API request failed', status: e && e.response && e.response.status }
  }
}

async function request (method, url, query, body, message) {
  return call(null, null, { method, url, query, body }, message)
}

function memo (key, ttl, fn) {
  const hit = cache.get(key)
  if (hit && (Date.now() - hit.ts < ttl || isRateLimited())) return Promise.resolve(hit.value)
  if (inflight.has(key)) return inflight.get(key)
  const p = Promise.resolve().then(fn).then(value => {
    if (value && value.ok) cache.set(key, { ts: Date.now(), value })
    inflight.delete(key)
    return value
  }).catch(e => { inflight.delete(key); throw e })
  inflight.set(key, p)
  return p
}

function invalidate (prefix) { for (const key of cache.keys()) if (!prefix || key.startsWith(prefix)) cache.delete(key) }
function isRateLimited () { return Date.now() < rateLimitedUntil }
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
  APP, call, request, memo, invalidate, isRateLimited, getClient,
  setCurrentUserId, getCurrentUserId, getTwoFactorMethods, clearTwoFactorMethods,
  setLoggedIn, isLoggedIn, logout, persistedCookieHeader
}

'use strict'

// LinkUp's proposed KitsuNexus device-grant contract. These are intentionally
// distinct from the public /api/supporters endpoint (which proves no identity).
// LinkUp must implement these authenticated endpoints before tiers can activate.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const ORIGIN = 'https://linkup.nekosunevr.co.uk'
const CLIENT_ID = 'kitsunexus-desktop'
const SCOPE = 'boostRewards.read'
const CACHE_MS = 5 * 60 * 1000

function tierFor (count) {
  if (count >= 5) return 'constellation'
  if (count >= 3) return 'nova'
  if (count >= 2) return 'glow'
  if (count >= 1) return 'spark'
  return 'none'
}

function safeUrl (value) {
  const url = new URL(value)
  if (url.origin !== ORIGIN || url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('LinkUp returned an untrusted verification URL')
  }
  return url.toString()
}

async function request (route, data, token) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const result = await fetch(ORIGIN + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: data ? JSON.stringify(data) : undefined,
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal
    })
    let payload = {}
    try { payload = await result.json() } catch (_) {}
    if (!result.ok) {
      const err = new Error('LinkUp request failed')
      err.status = result.status
      err.code = typeof payload.error === 'string' ? payload.error : ''
      throw err
    }
    return payload
  } finally { clearTimeout(timeout) }
}

function createCommunityBooster ({ userData, safeStorage, http = request, openExternal = () => {}, now = Date.now }) {
  const file = path.join(userData, 'community-booster-session.json')
  let account = null
  let pending = null
  let busy = false
  let state = 'unlinked'
  let generation = 0

  const encryptionAvailable = () => safeStorage && safeStorage.isEncryptionAvailable() &&
    (!safeStorage.getSelectedStorageBackend || safeStorage.getSelectedStorageBackend() !== 'basic_text')

  function save () {
    if (!encryptionAvailable()) return // Memory only on systems without protected storage.
    if (!account) {
      try { fs.unlinkSync(file) } catch (_) {}
      return
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(account))
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: 1, encrypted: encrypted.toString('base64') }), { mode: 0o600 })
  }

  function load () {
    if (!encryptionAvailable()) return
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (saved.version !== 1 || typeof saved.encrypted !== 'string') return
      const restored = JSON.parse(safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64')))
      if (typeof restored.token === 'string' && typeof restored.subject === 'string' &&
          Number.isFinite(restored.tokenExpiresAt)) {
        account = restored
        account.boostCount = 0
        account.cacheExpiresAt = 0
        state = 'expired' // No cached claim counts are trusted across restarts.
      }
    } catch (_) {} // Unreadable vault means an unlinked state, never a grant.
  }
  load()

  function snapshot () {
    const fresh = account && account.cacheExpiresAt > now() && account.tokenExpiresAt > now()
    const active = fresh && ['verified', 'offline'].includes(state)
    const count = active ? account.boostCount : 0
    return {
      state: pending ? 'authorizing' : state,
      tier: tierFor(count),
      boostCount: count,
      linked: !!account,
      lastCheckedAt: account?.checkedAt || null,
      cacheExpiresAt: active ? account.cacheExpiresAt : null,
      verificationUrl: pending ? pending.verificationUrl : null,
      userCode: pending ? pending.userCode : null,
      intervalSeconds: pending ? pending.interval : null
    }
  }

  function forget (reason = 'unlinked') {
    generation++ // Invalidate in-flight authorization/refresh responses.
    account = null
    pending = null
    state = reason
    save()
    return snapshot()
  }

  async function start () {
    if (busy) return snapshot()
    busy = true
    const attemptGeneration = ++generation
    try {
      pending = null
      const verifier = crypto.randomBytes(32).toString('base64url')
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      const nonce = crypto.randomBytes(24).toString('base64url')
      const result = await http('/api/v1/kitsunexus/device/authorize', {
        client_id: CLIENT_ID, scope: SCOPE, state: nonce,
        code_challenge: challenge, code_challenge_method: 'S256'
      })
      if (attemptGeneration !== generation) return snapshot()
      if (result.state !== nonce || typeof result.device_code !== 'string' ||
          result.device_code.length < 16 || typeof result.user_code !== 'string' ||
          result.user_code.length > 48 || !Number.isInteger(result.expires_in) ||
          result.expires_in < 30 || result.expires_in > 1800) {
        throw new Error('LinkUp device authorization response was invalid')
      }
      const verificationUrl = safeUrl(result.verification_uri)
      pending = {
        deviceCode: result.device_code, userCode: result.user_code,
        verificationUrl, nonce, verifier, expiresAt: now() + result.expires_in * 1000,
        interval: Math.max(5, Math.min(60, Number(result.interval) || 5)), nextPoll: 0
      }
      // Only the verified URL is opened in the OS browser. No local HTTP listener.
      await openExternal(verificationUrl)
      return snapshot()
    } finally { busy = false }
  }

  async function refresh (force = false) {
    if (!account) return snapshot()
    if (busy) return snapshot()
    if (account.tokenExpiresAt <= now()) { state = 'expired'; return snapshot() }
    if (!force && state === 'verified' && account.cacheExpiresAt > now()) return snapshot()
    busy = true
    const attemptGeneration = generation
    try {
      const data = await http('/api/v1/kitsunexus/me/boost-rewards', null, account.token)
      if (attemptGeneration !== generation) return snapshot()
      const rewards = data.boostRewards
      if (typeof data.subject !== 'string' || !data.subject || data.subject !== account.subject ||
          !rewards || rewards.verified !== true || !Number.isSafeInteger(rewards.activeBoostCount) ||
          rewards.activeBoostCount < 0 || rewards.activeBoostCount > 10000) {
        throw new Error('LinkUp returned an invalid verified entitlement')
      }
      account.boostCount = rewards.activeBoostCount
      account.checkedAt = now()
      // A claimed ending may shorten the cache; never extend past token expiry.
      const endsAt = rewards.endsAt == null ? Infinity : Date.parse(rewards.endsAt)
      if (Number.isNaN(endsAt)) throw new Error('LinkUp returned an invalid ending date')
      account.cacheExpiresAt = Math.min(now() + CACHE_MS, account.tokenExpiresAt, endsAt)
      state = account.cacheExpiresAt <= now() ? 'expired' : 'verified'
      save()
    } catch (err) {
      if (attemptGeneration !== generation) return snapshot()
      if (err.status === 401 || err.status === 403 || err.code === 'revoked') return forget('revoked')
      state = 'offline'
    } finally { busy = false }
    return snapshot()
  }

  async function poll () {
    if (!pending || busy) return snapshot()
    if (now() >= pending.expiresAt) { pending = null; state = 'expired'; return snapshot() }
    if (now() < pending.nextPoll) return snapshot()
    busy = true
    const attempt = pending
    const attemptGeneration = generation
    attempt.nextPoll = now() + attempt.interval * 1000
    let completed = false
    try {
      const result = await http('/api/v1/kitsunexus/device/token', {
        client_id: CLIENT_ID, device_code: attempt.deviceCode,
        code_verifier: attempt.verifier, state: attempt.nonce
      })
      if (attemptGeneration !== generation) return snapshot()
      if (pending !== attempt || result.state !== attempt.nonce ||
          result.token_type !== 'Bearer' || typeof result.access_token !== 'string' ||
          result.access_token.length < 20 || typeof result.subject !== 'string' || !result.subject ||
          !String(result.scope || '').split(' ').includes(SCOPE) ||
          !Number.isInteger(result.expires_in) || result.expires_in < 30 || result.expires_in > 86400) {
        throw new Error('LinkUp returned an invalid linked identity')
      }
      if (account && account.subject !== result.subject) account = null // Account switch invalidates old entitlements.
      account = {
        token: result.access_token, subject: result.subject,
        tokenExpiresAt: now() + result.expires_in * 1000,
        boostCount: 0, cacheExpiresAt: 0, checkedAt: null
      }
      pending = null
      state = 'expired'
      save()
      completed = true
    } catch (err) {
      if (attemptGeneration !== generation) return snapshot()
      if (err.code === 'authorization_pending') return snapshot()
      if (err.code === 'slow_down') { attempt.interval = Math.min(60, attempt.interval + 5); return snapshot() }
      if (err.code === 'access_denied' || err.code === 'expired_token') { pending = null; state = 'unlinked' }
      else if (err.status === 404 || err.status === 501) { pending = null; state = 'unavailable' }
      else { pending = null; state = 'offline' }
    } finally { busy = false }
    return completed ? refresh() : snapshot()
  }

  async function disconnect () {
    const old = account?.token
    forget()
    if (old) {
      try { await http('/api/v1/kitsunexus/device/revoke', { client_id: CLIENT_ID }, old) } catch (_) {}
    }
    return snapshot()
  }

  return { start, poll, refresh, disconnect, snapshot }
}

module.exports = { createCommunityBooster, tierFor, safeUrl }

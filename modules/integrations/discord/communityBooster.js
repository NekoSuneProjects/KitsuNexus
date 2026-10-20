'use strict'

// Community Booster entitlements and their catalogue are managed by the paired
// KitsuNexus server. The main process alone sends the existing device token.
const CACHE_MS = 5 * 60 * 1000
const KNOWN_PERKS = new Set([
  'badge', 'ribbon', 'sparkle', 'accent', 'border', 'ambient', 'nova',
  'gradient', 'navigation', 'constellation', 'frame', 'starlight'
])
const KNOWN_TIERS = new Set(['spark', 'glow', 'nova', 'constellation'])

function serverOrigin (value) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash ||
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Community Booster requires HTTPS (HTTP is allowed only on localhost)')
  }
  return url.href.replace(/\/+$/, '')
}

async function request ({ baseUrl, token }) {
  const response = await fetch(`${serverOrigin(baseUrl)}/api/community-booster/me`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)
  })
  let data = {}
  try { data = await response.json() } catch (_) {}
  if (!response.ok) {
    const error = new Error('KitsuNexus booster verification failed')
    error.status = response.status
    throw error
  }
  return data
}

function validateGrant (data) {
  if (!data || data.ok !== true || data.verified !== true ||
      typeof data.linkedDiscord !== 'boolean' ||
      !Number.isSafeInteger(data.activeBoostCount) || data.activeBoostCount < 0 ||
      data.activeBoostCount > 10000 || !Number.isSafeInteger(data.rewardLevel) ||
      data.rewardLevel < data.activeBoostCount || data.rewardLevel > 10000 || !data.catalogue ||
      data.catalogue.version !== 1 || !Array.isArray(data.catalogue.tiers) ||
      !Array.isArray(data.unlocked)) throw new Error('Invalid booster grant')
  const tiers = data.catalogue.tiers
  if (tiers.length !== 4 || !tiers.every(t => t && KNOWN_TIERS.has(t.id) &&
      Number.isInteger(t.minBoosts) && t.minBoosts > 0 && t.minBoosts <= 100 &&
      Array.isArray(t.unlocks) && t.unlocks.every(id => KNOWN_PERKS.has(id))) ||
      new Set(tiers.map(t => t.id)).size !== 4) throw new Error('Invalid booster catalogue')
  const eligible = tiers.filter(t => data.rewardLevel >= t.minBoosts)
  const topTier = eligible.length ? eligible.reduce((a, b) => a.minBoosts > b.minBoosts ? a : b).id : 'none'
  const allowed = new Set(eligible.flatMap(t => t.unlocks))
  if (data.tier !== topTier || data.unlocked.some(id => !allowed.has(id)) ||
      new Set(data.unlocked).size !== data.unlocked.length) throw new Error('Invalid booster entitlement')
  return {
    boostCount: data.activeBoostCount, rewardLevel: data.rewardLevel,
    tier: topTier, unlocked: [...data.unlocked],
    linkedDiscord: data.linkedDiscord, source: data.source === 'discord_tier_role' ? 'discord_tier_role' : 'discord_membership',
    catalogue: {
      version: 1, tiers: tiers.map(t => ({ id: t.id, label: String(t.label || t.id).slice(0, 32), minBoosts: t.minBoosts, unlocks: [...t.unlocks] })),
      defaults: Object.fromEntries(Object.entries(data.catalogue.defaults || {}).filter(([key, value]) =>
        [...KNOWN_PERKS, 'decoration'].includes(key) && (typeof value === 'boolean' || ['auto', 'none', 'nova', 'constellation'].includes(value))))
    }
  }
}

function createCommunityBooster ({ getPairing, http = request, now = Date.now }) {
  let currentKey = ''
  let claim = null
  let state = 'unlinked'
  let checkedAt = null
  let cacheExpiresAt = 0
  let pending = null
  let pendingKey = ''

  function pairing () {
    const p = getPairing() || {}
    return { baseUrl: String(p.baseUrl || ''), token: String(p.token || '') }
  }

  function syncPairing () {
    const p = pairing()
    const key = p.baseUrl && p.token ? `${p.baseUrl}\n${p.token}` : ''
    if (key !== currentKey) {
      currentKey = key
      claim = null
      state = key ? 'expired' : 'unlinked'
      cacheExpiresAt = 0
      checkedAt = null
    }
    return p
  }

  function snapshot () {
    syncPairing()
    const active = claim && cacheExpiresAt > now() && ['verified', 'offline'].includes(state)
    return {
      state: active || state !== 'verified' ? state : 'expired',
      linked: !!currentKey,
      boostCount: active ? claim.boostCount : 0,
      rewardLevel: active ? claim.rewardLevel : 0,
      tier: active ? claim.tier : 'none',
      unlocked: active ? [...claim.unlocked] : [],
      linkedDiscord: !!(active && claim.linkedDiscord),
      source: active ? claim.source : '',
      catalogue: active ? claim.catalogue : null,
      lastCheckedAt: checkedAt,
      cacheExpiresAt: active ? cacheExpiresAt : null
    }
  }

  async function refresh (force = false) {
    const p = syncPairing()
    if (!currentKey) return snapshot()
    if (!force && cacheExpiresAt > now() && state === 'verified') return snapshot()
    if (pending && pendingKey === currentKey) return pending
    const requestKey = currentKey
    const operation = (async () => {
      try {
        const result = validateGrant(await http(p))
        syncPairing()
        if (currentKey !== requestKey) return snapshot()
        claim = result
        checkedAt = now()
        cacheExpiresAt = now() + CACHE_MS
        state = 'verified'
      } catch (err) {
        syncPairing()
        if (currentKey !== requestKey) return snapshot()
        if (err.status === 401 || err.status === 403) {
          claim = null; cacheExpiresAt = 0; state = 'revoked'
        } else {
          state = [404, 405, 501].includes(err.status) ? 'unavailable' : 'offline'
        }
      }
      return snapshot()
    })()
    pending = operation
    pendingKey = requestKey
    try { return await operation } finally {
      if (pending === operation) { pending = null; pendingKey = '' }
    }
  }

  return { snapshot, refresh }
}

module.exports = { createCommunityBooster, validateGrant, serverOrigin }

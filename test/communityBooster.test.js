'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCommunityBooster, validateGrant, serverOrigin } = require('../modules/integrations/discord/communityBooster')

const catalogue = {
  version: 1, tiers: [
    { id: 'spark', label: 'Spark', minBoosts: 1, unlocks: ['badge', 'ribbon', 'sparkle'] },
    { id: 'glow', label: 'Glow', minBoosts: 2, unlocks: ['accent', 'border', 'ambient'] },
    { id: 'nova', label: 'Nova', minBoosts: 3, unlocks: ['nova', 'gradient', 'navigation'] },
    { id: 'constellation', label: 'Constellation', minBoosts: 5, unlocks: ['constellation', 'frame', 'starlight'] }
  ], defaults: { accent: true, decoration: 'auto' }
}

function grant (level = 1) {
  const eligible = catalogue.tiers.filter(t => t.minBoosts <= level)
  return {
    ok: true, verified: true, linkedDiscord: true,
    activeBoostCount: level ? 1 : 0, rewardLevel: level,
    tier: eligible.at(-1)?.id || 'none',
    unlocked: eligible.flatMap(t => t.unlocks), catalogue,
    source: level > 1 ? 'discord_tier_role' : 'discord_membership'
  }
}

function fixture () {
  let time = 1000
  let credential = 'token-a'
  let level = 5
  let failed = false
  let requests = 0
  let next
  const svc = createCommunityBooster({
    getPairing: () => ({ baseUrl: 'https://kitsunexus.example.test', token: credential }),
    now: () => time,
    http: async ({ token }) => {
      requests++
      if (next) return next(token)
      if (failed) throw new Error('Offline')
      assert.equal(token, credential)
      return grant(level)
    }
  })
  return { svc, advance: amount => { time += amount }, setLevel: value => { level = value },
    setFailed: value => { failed = value }, setToken: value => { credential = value },
    setResponse: fn => { next = fn }, requests: () => requests }
}

test('accept only server-verified catalogue entitlements and never trust fabricated rewards', () => {
  const valid = validateGrant(grant(5))
  assert.equal(valid.tier, 'constellation')
  assert.equal(valid.rewardLevel, 5)
  assert.equal(valid.boostCount, 1)
  assert.throws(() => validateGrant({ ...grant(0), unlocked: ['badge'] }), /Invalid/)
  assert.throws(() => validateGrant({ ...grant(5), verified: false }), /Invalid/)
  assert.throws(() => validateGrant({ ...grant(1), tier: 'constellation' }), /Invalid/)
  assert.throws(() => validateGrant({ ...grant(1), unlocked: ['frame'] }), /Invalid/)
  assert.throws(() => validateGrant({ ...grant(5), catalogue: { ...catalogue, tiers: [] } }), /Invalid/)
})

test('paired server issues temporary rewards that disappear on confirmation or cache expiry', async () => {
  const f = fixture()
  assert.equal((await f.svc.refresh()).tier, 'constellation')
  assert.equal((await f.svc.refresh()).tier, 'constellation')
  assert.equal(f.requests(), 1)
  f.setLevel(0)
  assert.equal((await f.svc.refresh(true)).tier, 'none')
  f.setLevel(3)
  assert.equal((await f.svc.refresh(true)).tier, 'nova')
  f.setFailed(true)
  assert.equal((await f.svc.refresh(true)).tier, 'nova') // verified and not expired
  assert.equal(f.svc.snapshot().state, 'offline')
  f.advance(300001)
  assert.equal(f.svc.snapshot().tier, 'none')
  assert.deepEqual(f.svc.snapshot().unlocked, [])
})

test('pairing switches, server revocations and unpaired state revoke old perks immediately', async () => {
  const f = fixture()
  await f.svc.refresh()
  f.setToken('token-b')
  assert.equal(f.svc.snapshot().tier, 'none')
  f.setResponse(() => { const err = new Error('Revoked'); err.status = 401; throw err })
  assert.equal((await f.svc.refresh()).state, 'revoked')
  f.setToken('')
  assert.equal(f.svc.snapshot().linked, false)
  assert.equal(f.svc.snapshot().tier, 'none')
})

test('disallow insecure arbitrary HTTP servers and credential-bearing URLs', () => {
  assert.equal(serverOrigin('http://localhost:8080'), 'http://localhost:8080')
  assert.equal(serverOrigin('https://kitsunexus.example.test'), 'https://kitsunexus.example.test')
  assert.throws(() => serverOrigin('http://other.example.test'), /HTTPS/)
  assert.throws(() => serverOrigin('https://user:pass@other.example.test'), /HTTPS/)
})

test('late responses from previous paired accounts never activate another user’s perks', async () => {
  const f = fixture()
  let done
  f.setResponse(() => new Promise(resolve => { done = resolve }))
  const oldRequest = f.svc.refresh()
  f.setToken('new-pairing')
  assert.equal(f.svc.snapshot().tier, 'none')
  done(grant(5))
  assert.equal((await oldRequest).tier, 'none')
  assert.equal(f.svc.snapshot().tier, 'none')
})

test('new pairing refreshes immediately even while an older pairing request is pending', async () => {
  const f = fixture()
  const pending = new Map()
  f.setResponse(token => new Promise(resolve => pending.set(token, resolve)))
  const oldRequest = f.svc.refresh()
  f.setToken('token-b')
  const newRequest = f.svc.refresh(true)
  assert.equal(f.requests(), 2)
  pending.get('token-b')(grant(1))
  assert.equal((await newRequest).tier, 'spark')
  pending.get('token-a')(grant(5))
  assert.equal((await oldRequest).tier, 'spark')
  assert.equal(f.svc.snapshot().tier, 'spark')
})

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createCommunityBooster, tierFor, safeUrl } = require('../modules/integrations/discord/communityBooster')

const TOKEN = 'verified-test-access-token-123456789'
function fixture (options = {}) {
  const userData = options.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-booster-'))
  let time = 1000000
  let boosts = 0
  let offline = false
  let revoked = false
  let spoof = false
  let verified = true
  const calls = []
  const safeStorage = {
    isEncryptionAvailable: () => options.encryption !== false,
    getSelectedStorageBackend: () => options.backend || 'dpapi',
    encryptString: s => Buffer.from(`protected:${s}`),
    decryptString: b => b.toString().replace(/^protected:/, '')
  }
  const http = async (route, data, token) => {
    calls.push({ route, data, token })
    if (offline) throw new Error('Network offline')
    if (route.endsWith('/authorize')) return {
      state: data.state, device_code: 'private-device-code-1234', user_code: 'LINK-UP',
      verification_uri: 'https://linkup.nekosunevr.co.uk/authorize', expires_in: 600, interval: 5
    }
    if (route.endsWith('/token')) return {
      state: spoof ? 'spoofed-nonce' : data.state, token_type: 'Bearer',
      access_token: TOKEN, subject: 'verified-account', scope: 'boostRewards.read', expires_in: 3600
    }
    if (route.endsWith('/boost-rewards')) {
      if (revoked) { const err = new Error('Revoked'); err.status = 401; throw err }
      assert.equal(token, TOKEN)
      return { subject: spoof ? 'another-person' : 'verified-account', boostRewards: { verified, activeBoostCount: boosts } }
    }
    if (route.endsWith('/revoke')) { assert.equal(token, TOKEN); return {} }
    throw new Error('Unexpected request')
  }
  const opened = []
  const create = () => createCommunityBooster({
    userData, safeStorage, http, openExternal: url => { opened.push(url) }, now: () => time
  })
  return {
    create, opened, calls, userData, safeStorage, http,
    setBoosts: n => { boosts = n }, setOffline: v => { offline = v },
    setRevoked: v => { revoked = v }, setSpoof: v => { spoof = v },
    setVerified: v => { verified = v }, advance: ms => { time += ms }
  }
}

async function link (svc) {
  const started = await svc.start()
  assert.equal(started.state, 'authorizing')
  assert.equal(started.userCode, 'LINK-UP')
  return svc.poll()
}

test('tier thresholds 0, 1, 2, 3, 4, and 5+ require authenticated boostRewards', async () => {
  for (const [boosts, tier] of [[0, 'none'], [1, 'spark'], [2, 'glow'], [3, 'nova'], [4, 'nova'], [5, 'constellation'], [9, 'constellation']]) {
    const ctx = fixture()
    ctx.setBoosts(boosts)
    const svc = ctx.create()
    const display = await link(svc)
    assert.equal(display.tier, tier)
    assert.equal(display.boostCount, boosts)
    assert.equal(display.state, 'verified')
    assert.equal(ctx.opened[0], 'https://linkup.nekosunevr.co.uk/authorize')
    assert.equal(JSON.stringify(display).includes(TOKEN), false)
    assert.equal(ctx.calls.some(call => call.data?.code_verifier), true)
  }
  assert.equal(tierFor(4), 'nova')
})

test('nonce, returned identity and verified claims are checked before a badge appears', async () => {
  const ctx = fixture()
  ctx.setBoosts(5)
  ctx.setSpoof(true)
  const svc = ctx.create()
  const response = await link(svc)
  assert.equal(response.tier, 'none')
  assert.equal(response.linked, false)
  ctx.setSpoof(false)
  ctx.setVerified(false)
  const retry = await link(svc)
  assert.equal(retry.boostCount, 0)
  assert.equal(retry.state, 'offline')
  assert.equal(retry.tier, 'none')
  assert.throws(() => safeUrl('https://evil.example.com/authorize'), /untrusted/)
  assert.throws(() => safeUrl('http://linkup.nekosunevr.co.uk/authorize'), /untrusted/)
})

test('revocation, disconnect and confirmed end remove active cosmetics', async () => {
  const ctx = fixture()
  ctx.setBoosts(5)
  const svc = ctx.create()
  assert.equal((await link(svc)).tier, 'constellation')
  ctx.setBoosts(0)
  assert.equal((await svc.refresh(true)).tier, 'none')
  ctx.setBoosts(2)
  assert.equal((await svc.refresh(true)).tier, 'glow')
  ctx.setRevoked(true)
  const revoked = await svc.refresh(true)
  assert.equal(revoked.state, 'revoked')
  assert.equal(revoked.linked, false)
  assert.equal(revoked.tier, 'none')
  ctx.setRevoked(false)
  await link(svc)
  assert.equal((await svc.disconnect()).state, 'unlinked')
  assert.equal(fs.existsSync(path.join(ctx.userData, 'community-booster-session.json')), false)
})

test('offline startup and cache expiry fail closed; credentials are encrypted at rest', async () => {
  const ctx = fixture()
  ctx.setBoosts(5)
  const svc = ctx.create()
  await link(svc)
  const vault = fs.readFileSync(path.join(ctx.userData, 'community-booster-session.json'), 'utf8')
  assert.equal(vault.includes(TOKEN), false)
  ctx.setOffline(true)
  assert.equal((await svc.refresh(true)).tier, 'constellation') // Unexpired validated cache.
  assert.equal(svc.snapshot().state, 'offline')
  ctx.advance(5 * 60 * 1000 + 1)
  assert.equal(svc.snapshot().tier, 'none')
  const restarted = ctx.create()
  assert.equal(restarted.snapshot().tier, 'none')
  assert.equal((await restarted.refresh()).state, 'offline')
  assert.equal(restarted.snapshot().boostCount, 0)
})

test('unprotected OS storage keeps tokens in memory only', async () => {
  for (const opts of [{ encryption: false }, { backend: 'basic_text' }]) {
    const ctx = fixture(opts)
    await link(ctx.create())
    assert.equal(fs.existsSync(path.join(ctx.userData, 'community-booster-session.json')), false)
  }
})

test('poll respects interval and device-code expiry', async () => {
  const ctx = fixture()
  const svc = ctx.create()
  await svc.start()
  await svc.poll()
  const numPolls = ctx.calls.filter(item => item.route.endsWith('/token')).length
  await svc.poll()
  assert.equal(ctx.calls.filter(item => item.route.endsWith('/token')).length, numPolls)
  const other = ctx.create()
  await other.start()
  ctx.advance(601000)
  assert.equal((await other.poll()).state, 'expired')
})

test('disconnect invalidates an in-flight token exchange', async () => {
  const ctx = fixture()
  let completeToken
  const http = async (route, data, token) => {
    if (route.endsWith('/token')) return new Promise(resolve => { completeToken = () => resolve({
      state: data.state, token_type: 'Bearer', access_token: TOKEN,
      subject: 'verified-account', scope: 'boostRewards.read', expires_in: 3600
    }) })
    return ctx.http(route, data, token)
  }
  const svc = createCommunityBooster({
    userData: ctx.userData, safeStorage: ctx.safeStorage, http, now: () => 1000000
  })
  await svc.start()
  const poll = svc.poll()
  assert.equal(typeof completeToken, 'function')
  assert.equal((await svc.disconnect()).state, 'unlinked')
  completeToken()
  assert.equal((await poll).state, 'unlinked')
  assert.equal(svc.snapshot().tier, 'none')
  assert.equal(fs.existsSync(path.join(ctx.userData, 'community-booster-session.json')), false)
})

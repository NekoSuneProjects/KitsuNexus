'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const source = fs.readFileSync(path.join(__dirname, '../modules/favorites/cloudSync.js'), 'utf8')

function createClient (request) {
  const values = {
    'cloudSync.baseUrl': 'https://first.example', 'cloudSync.token': 'first-token',
    'cloudSync.deviceId': 'first-device', 'cloudSync.enabled': true,
  }
  const settings = {
    get: (key, fallback) => Object.hasOwn(values, key) ? values[key] : fallback,
    set: (key, value) => { values[key] = value },
  }
  const mod = { exports: {} }
  vm.runInNewContext(source, {
    module: mod,
    require (id) {
      if (id === '../../settings') return settings
      if (id === 'node:crypto') return crypto
      if (id === './localFavoritesDb' || id === '../history/gamelog') return {}
      throw new Error(`Unexpected dependency ${id}`)
    },
    fetch: request,
    AbortSignal,
    URLSearchParams,
    console,
  }, { filename: 'cloudSync.js' })
  return { client: mod.exports, values }
}

test('paired Twitch request authenticates the device and returns identity with pairing fingerprint', async () => {
  let called = 0
  const { client } = createClient(async (url, options) => {
    called++
    assert.equal(url, 'https://first.example/api/twitch/credentials')
    assert.equal(options.headers.Authorization, 'Bearer first-token')
    return { ok: true, status: 200, json: async () => ({ ok: true, connected: true, login: 'user', clientId: 'public-id', accessToken: 'short-lived-access' }) }
  })
  const result = await client.twitchCredentials()
  assert.equal(called, 1)
  assert.equal(result.connected, true)
  assert.equal(result.accessToken, 'short-lived-access')
  assert.equal(result.pairingKey, client.pairingKey())
  assert.ok(!result.pairingKey.includes('first-token'))
})

test('a pending old server response cannot replace a new pairing', async () => {
  let release
  const { client, values } = createClient(() => new Promise(resolve => { release = resolve }))
  const old = client.twitchCredentials()
  values['cloudSync.baseUrl'] = 'https://second.example'
  values['cloudSync.token'] = 'second-token'
  values['cloudSync.deviceId'] = 'second-device'
  release({ ok: true, status: 200, json: async () => ({ ok: true, connected: true, login: 'wrong-user', clientId: 'wrong-id', accessToken: 'old-secret' }) })
  const result = await old
  assert.equal(result.ok, false)
  assert.equal(result.accessToken, undefined)
  assert.equal(values['cloudSync.token'], 'second-token')
})

test('revoked device token disconnects the current pairing', async () => {
  const { client, values } = createClient(async () => ({ status: 401, ok: false, json: async () => ({ ok: false }) }))
  const result = await client.twitchCredentials()
  assert.equal(result.ok, false)
  assert.equal(client.isPaired(), false)
  assert.equal(values['cloudSync.token'], '')
})

test('unlink uses authenticated POST and ignores stale responses', async () => {
  let release
  const { client, values } = createClient((url, options) => {
    assert.equal(url, 'https://first.example/api/twitch/unlink')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer first-token')
    return new Promise(resolve => { release = resolve })
  })
  const pending = client.unlinkTwitch()
  values['cloudSync.token'] = 'new-token'
  release({ status: 401, ok: false, json: async () => ({ ok: false }) })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(values['cloudSync.token'], 'new-token')
})

'use strict'

// VRChat API pacing in vrchatClient.js: every request is queued (max 2 in flight, starts
// >= 350 ms apart), a 429 pauses everything and fails fast, memo() can cache failures,
// and getStats() reports per-endpoint counts. The VRChat SDK and settings are faked, so
// nothing touches the network.

const { test } = require('node:test')
const assert = require('node:assert/strict')

function loadClient (handler) {
  const settingsPath = require.resolve('../settings')
  const clientPath = require.resolve('../modules/vrchat/api/vrchatClient')
  const sdkPath = require.resolve('vrchat')
  const saved = { settings: require.cache[settingsPath], sdk: require.cache[sdkPath] }
  const store = new Map()
  require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v), delete: k => store.delete(k) } }
  const interceptors = []
  class FakeVRChat {
    constructor () {
      this.client = {
        interceptors: { response: { use: fn => interceptors.push(fn) } },
        request: async opts => {
          const res = await handler(opts)
          const response = { status: res.status || 200, headers: new Map(Object.entries(res.headers || {})), clone () { return { json: async () => res.data } } }
          for (const fn of interceptors) await fn(response)
          return { data: res.data, response }
        }
      }
    }
  }
  require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: { VRChat: FakeVRChat } }
  delete require.cache[clientPath]
  const core = require(clientPath)
  const restore = () => {
    delete require.cache[clientPath]
    if (saved.settings) require.cache[settingsPath] = saved.settings; else delete require.cache[settingsPath]
    if (saved.sdk) require.cache[sdkPath] = saved.sdk; else delete require.cache[sdkPath]
  }
  return { core, restore }
}

test('VRChat requests are paced: max 2 in flight, starts >= 350 ms apart', async () => {
  let inFlight = 0; let maxInFlight = 0; const starts = []
  const { core, restore } = loadClient(async () => {
    starts.push(Date.now()); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise(r => setTimeout(r, 500))
    inFlight--
    return { data: { ok: 1 } }
  })
  try {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => core.request('GET', `/worlds/wrld_${i}`)))
    assert.ok(results.every(r => r.ok), 'all requests succeed')
    assert.ok(maxInFlight <= 2, `max in flight ${maxInFlight}`)
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 340, `gap ${starts[i] - starts[i - 1]} ms`)
    const s = core.getStats()
    assert.equal(s.total, 6)
    assert.deepEqual(s.topAllTime[0], { endpoint: 'GET /worlds/:id', count: 6 })
  } finally { restore() }
})

test('a 429 pauses all VRChat requests and fails fast instead of sending more', async () => {
  let sent = 0
  const { core, restore } = loadClient(async () => { sent++; return { status: 429, headers: { 'retry-after': '30' }, data: { error: { message: 'slow down' } } } })
  try {
    const first = await core.request('GET', '/auth/user/friends')
    assert.equal(first.ok, false)
    assert.equal(core.isRateLimited(), true)
    const t = Date.now()
    const again = await Promise.all([core.request('GET', '/auth/user/friends'), core.request('GET', '/worlds/wrld_x')])
    assert.ok(Date.now() - t < 100, 'failed fast')
    assert.ok(again.every(r => !r.ok && r.status === 429 && /slow down/.test(r.error)))
    assert.equal(sent, 1, 'nothing else was sent while limited')
    const s = core.getStats()
    assert.equal(s.times429, 1)
    assert.ok(s.rateLimitedForSeconds > 25)
  } finally { restore() }
})

test('memo failTtl remembers failed lookups instead of re-sending them', async () => {
  let sent = 0
  const { core, restore } = loadClient(async () => { sent++; return { status: 404, data: { error: { message: 'not found' } } } })
  try {
    const look = () => core.memo('userBasic:usr_gone', 60000, () => core.request('GET', '/users/usr_gone'), 60000)
    const a = await look(); const b = await look(); const c = await look()
    assert.ok(!a.ok && !b.ok && !c.ok)
    assert.equal(sent, 1)
    // without failTtl the old behaviour (retry every time) is kept
    const plain = () => core.memo('plain', 60000, () => core.request('GET', '/users/usr_x'))
    await plain(); await plain()
    assert.equal(sent, 3)
  } finally { restore() }
})

test('friend-list refresh does not re-fetch the same missing friends every poll', async () => {
  const ids = Array.from({ length: 50 }, (_, i) => `usr_gone${i}`)
  const hits = { users: 0, profile: 0, friends: 0 }
  const { core, restore } = loadClient(async ({ url }) => {
    if (url.startsWith('/auth/user/friends')) { hits.friends++; return { data: [] } }
    if (url.startsWith('/auth/user')) return { data: { id: 'usr_me', displayName: 'Me', friends: ids } }
    if (url.startsWith('/users/')) { hits.users++; return { status: 404, data: { error: { message: 'not found' } } } }
    if (url.startsWith('/profile/')) { hits.profile++; return { status: 404, data: {} } }
    return { data: {} }
  })
  const apiPath = require.resolve('../modules/vrchat/api/vrchatApi')
  delete require.cache[apiPath]
  try {
    const api = require(apiPath)
    const first = await api.getAllFriends()
    assert.equal(first.stillMissing, 50)
    const usersAfterFirst = hits.users
    assert.equal(usersAfterFirst, 50, `first run looked up ${usersAfterFirst}`)
    assert.equal(hits.profile, 0, 'recovery no longer fetches public profiles')
    api.invalidate('friends:all')
    await api.getAllFriends()
    assert.equal(hits.users, usersAfterFirst, 'second poll sent no new user lookups')
  } finally { delete require.cache[apiPath]; restore() }
})

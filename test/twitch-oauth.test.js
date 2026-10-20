'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const cookieParser = require('cookie-parser')

process.env.DB_PATH = ':memory:'
const config = require('../src/config')
const db = require('../src/db')
const twitchOAuth = require('../src/services/twitchOAuth')
const routes = require('../src/routes/twitchOauth')
const session = require('../src/auth/session')
const { createUnlinkToken } = require('../src/auth/twitchCsrf')
const { hashToken } = require('../src/auth/deviceToken')
const { eraseUserData } = require('../src/services/accountErasure')

const oldConfig = {
  twitchClientId: config.twitchClientId,
  twitchClientSecret: config.twitchClientSecret,
  twitchTokenKey: config.twitchTokenKey,
  twitchRedirectUri: config.twitchRedirectUri,
}
const originalFetch = global.fetch
const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let server
let port
let tokensCalled = 0
let refreshCalled = 0
let revokeCalled = 0
let suspendRefresh = null
let suspendRevoke = null
let failRevoke = false

function upstream (url, options = {}) {
  if (url === 'https://id.twitch.tv/oauth2/token') {
    const body = new URLSearchParams(options.body)
    tokensCalled++
    if (body.get('grant_type') === 'refresh_token') {
      refreshCalled++
      const response = () => ({ ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: config.twitchScopes.split(' ') }) })
      if (suspendRefresh) {
        const hold = suspendRefresh
        return new Promise(resolve => { hold.release = () => resolve(response()); hold.started() })
      }
      return new Promise(resolve => setTimeout(() => resolve({
        ...response()
      }), 15))
    }
    return Promise.resolve({ ok: true, json: async () => ({ access_token: 'old-access', refresh_token: 'old-refresh', expires_in: 3600, scope: config.twitchScopes.split(' ') }) })
  }
  if (url === 'https://api.twitch.tv/helix/users') {
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: '123456', login: 'linked_user', display_name: 'Linked User' }] }) })
  }
  if (url === 'https://id.twitch.tv/oauth2/revoke') {
    const body = new URLSearchParams(options.body)
    assert.equal(body.get('client_id'), 'public-client')
    assert.ok(['new-access', 'old-access'].includes(body.get('token')))
    revokeCalled++
    if (suspendRevoke) {
      const hold = suspendRevoke
      return new Promise(resolve => { hold.release = () => resolve({ ok: true, status: 200 }); hold.started() })
    }
    if (failRevoke) throw new Error('Simulated Twitch outage')
    return Promise.resolve({ ok: true, status: 200 })
  }
  throw new Error(`Unexpected Twitch call: ${url}`)
}

function request (path, cookies = '', method = 'GET', form = '') {
  return new Promise((resolve, reject) => {
    const headers = cookies ? { Cookie: cookies } : {}
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, cookies: res.headers['set-cookie'] || [], body }))
    })
    req.on('error', reject)
    if (form) req.write(form)
    req.end()
  })
}

before(async () => {
  Object.assign(config, { twitchClientId: 'public-client', twitchClientSecret: 'server-secret', twitchTokenKey: 'unit-test-encryption-key', twitchRedirectUri: 'http://localhost/oauth2/twitch/callback' })
  global.fetch = upstream
  await db.sequelize.sync()
  await db.User.bulkCreate([{ id: ownerId, displayName: 'Owner' }, { id: otherId, displayName: 'Other' }])
  const app = express()
  app.use(cookieParser())
  app.use(express.urlencoded({ extended: true }))
  app.use(routes)
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)) })
  port = server.address().port
})

after(async () => {
  global.fetch = originalFetch
  Object.assign(config, oldConfig)
  if (server) await new Promise(resolve => server.close(resolve))
  await db.sequelize.close()
})

test('signed OAuth state is bound to browser, user and expiration', () => {
  const state = routes.createState(ownerId)
  assert.equal(routes.verifyState(state, state, ownerId), true)
  assert.equal(routes.verifyState(state, '', ownerId), false)
  assert.equal(routes.verifyState(state, state, otherId), false)
  assert.equal(routes.verifyState(state.slice(0, -1) + (state.endsWith('f') ? '0' : 'f'), state, ownerId), false)
  const stale = routes.createState(ownerId, Date.now() - 6 * 60_000)
  assert.equal(routes.verifyState(stale, stale, ownerId), false)
})

test('website authorization redirects securely and rejects callbacks without matching state', async () => {
  const userCookie = `${session.COOKIE_NAME}=${session.sign({ id: ownerId, role: 'user' })}`
  const start = await request('/oauth2/twitch/authorize-link', userCookie)
  assert.equal(start.status, 302)
  const authorize = new URL(start.location)
  assert.equal(authorize.hostname, 'id.twitch.tv')
  assert.equal(authorize.searchParams.get('scope'), config.twitchScopes)
  const state = authorize.searchParams.get('state')
  const stateCookie = start.cookies[0].split(';')[0]
  assert.match(start.cookies[0], /HttpOnly/i)
  assert.match(start.cookies[0], /SameSite=Lax/i)
  const denied = await request(`/oauth2/twitch/callback?state=${encodeURIComponent(state)}&code=code`, userCookie)
  assert.equal(denied.status, 400)
  const completed = await request(`/oauth2/twitch/callback?state=${encodeURIComponent(state)}&code=code`, `${userCookie}; ${stateCookie}`)
  assert.equal(completed.status, 302)
  assert.equal(completed.location, '/dashboard#twitch')
  assert.equal(tokensCalled, 1)
})

test('encrypted storage, account exclusivity and concurrent token refresh', async () => {
  const linked = await db.TwitchLink.findOne({ where: { userId: ownerId } })
  assert.ok(linked)
  assert.ok(!linked.encryptedAccessToken.includes('old-access'))
  assert.equal(twitchOAuth.decrypt(linked.encryptedAccessToken), 'old-access')
  assert.equal(twitchOAuth.decrypt(linked.encryptedRefreshToken), 'old-refresh')
  assert.notEqual(twitchOAuth.encrypt('test'), twitchOAuth.encrypt('test'))
  assert.throws(() => twitchOAuth.decrypt(linked.encryptedAccessToken.slice(0, -1) + '!'))
  const conflict = await twitchOAuth.linkCode(otherId, 'other-code')
  assert.equal(conflict.conflict, true)
  assert.equal(await db.TwitchLink.count(), 1)
  await linked.update({ expiresAt: new Date(Date.now() - 1000) })
  const [a, b, c] = await Promise.all([twitchOAuth.credentials(ownerId), twitchOAuth.credentials(ownerId), twitchOAuth.credentials(ownerId)])
  for (const result of [a, b, c]) {
    assert.equal(result.connected, true)
    assert.equal(result.accessToken, 'new-access')
    assert.equal(result.clientId, 'public-client')
    assert.equal(Object.hasOwn(result, 'refreshToken'), false)
  }
  assert.equal(refreshCalled, 1)
  assert.equal((await db.TwitchLink.findOne({ where: { userId: ownerId } })).scopes, config.twitchScopes)
})

test('reauthorizing Twitch during refresh keeps the new authorization', async () => {
  const linked = await db.TwitchLink.findOne({ where: { userId: ownerId } })
  await linked.update({ expiresAt: new Date(Date.now() - 1000) })
  const waiting = {}
  waiting.whenStarted = new Promise(resolve => { waiting.started = resolve })
  suspendRefresh = waiting
  const pendingRefresh = twitchOAuth.credentials(ownerId)
  try {
    await waiting.whenStarted
    await twitchOAuth.linkCode(ownerId, 'new-authorization')
  } finally {
    waiting.release()
    suspendRefresh = null
  }
  const result = await pendingRefresh
  assert.equal(result.accessToken, 'old-access')
  assert.equal(twitchOAuth.decrypt((await db.TwitchLink.findOne({ where: { userId: ownerId } })).encryptedRefreshToken), 'old-refresh')
  await (await db.TwitchLink.findOne({ where: { userId: ownerId } })).update({ expiresAt: new Date(Date.now() - 1000) })
  assert.equal((await twitchOAuth.credentials(ownerId)).accessToken, 'new-access')
})

test('unlink removes credentials before revocation, preserving a subsequent relink', async () => {
  const waiting = {}
  waiting.whenStarted = new Promise(resolve => { waiting.started = resolve })
  suspendRevoke = waiting
  const pendingUnlink = twitchOAuth.unlink(ownerId)
  try {
    await waiting.whenStarted
    assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 0)
    await twitchOAuth.linkCode(ownerId, 'newer-link')
  } finally {
    waiting.release()
    suspendRevoke = null
  }
  assert.equal((await pendingUnlink).connected, false)
  assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 1)

  // Failure to reach Twitch must not prevent local unlink or account erasure.
  failRevoke = true
  try {
    assert.equal((await twitchOAuth.unlink(ownerId)).connected, false)
  } finally { failRevoke = false }
  assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 0)
  await twitchOAuth.linkCode(ownerId, 'restore-after-outage')
})

test('device API authenticates pairing, and unlink stops credential access', async () => {
  const token = 'paired-device-secret'
  await db.Device.create({ userId: ownerId, name: 'Test desktop', status: 'paired', tokenHash: hashToken(token) })
  const authCookie = ''
  const missing = await request('/api/twitch/credentials', authCookie)
  assert.equal(missing.status, 401)
  const apiRequest = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { Authorization: `Bearer ${token}` } }, res => {
      let body = ''
      res.on('data', data => { body += data })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }))
    })
    req.on('error', reject)
    req.end()
  })
  const linked = await apiRequest('/api/twitch/credentials')
  assert.equal(linked.status, 200)
  assert.equal(linked.body.accessToken, 'old-access')
  assert.equal(linked.headers['cache-control'], 'no-store')
  const revocationsBeforeDeviceUnlink = revokeCalled
  const unlinked = await apiRequest('/api/twitch/unlink', 'POST')
  assert.equal(unlinked.body.connected, false)
  assert.equal(revokeCalled, revocationsBeforeDeviceUnlink + 1)
  const absent = await apiRequest('/api/twitch/credentials')
  assert.equal(absent.body.connected, false)
  await twitchOAuth.linkCode(ownerId, 'relink')
  const browserCookie = `${session.COOKIE_NAME}=${session.sign({ id: ownerId, role: 'user' })}`
  const rejected = await request('/settings/twitch/unlink', browserCookie, 'POST')
  assert.equal(rejected.status, 403)
  assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 1)
  const reqForToken = { cookies: { [session.COOKIE_NAME]: browserCookie.split('=')[1] }, user: { id: ownerId } }
  const csrf = createUnlinkToken(reqForToken)
  const forged = await request('/settings/twitch/unlink', browserCookie, 'POST', '_twitchCsrf=' + 'a'.repeat(64))
  assert.equal(forged.status, 403)
  const valid = await request('/settings/twitch/unlink', browserCookie, 'POST', '_twitchCsrf=' + csrf)
  assert.equal(valid.status, 302)
  assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 0)
  await twitchOAuth.linkCode(ownerId, 'relink-again')
  const revocationsBeforeErasure = revokeCalled
  await eraseUserData(ownerId)
  assert.equal(revokeCalled, revocationsBeforeErasure + 1)
  assert.equal(await db.TwitchLink.count({ where: { userId: ownerId } }), 0)
})

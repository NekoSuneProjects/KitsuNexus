'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
process.env.DB_PATH = ':memory:'
const db = require('../src/db')
const config = require('../src/config')
const gateway = require('../src/discord/discordBotGateway')
const { hashToken } = require('../src/auth/deviceToken')
const route = require('../src/routes/communityBooster')
const { catalogue, rewardsFor, verifiedCount } = require('../src/services/communityBooster')

const token = 'test-paired-device-secret'
let server
let base
let member = null
let unavailable = false
let linked = false
const old = {
  guild: config.discordOfficialGuildId, roles: config.discordBoostTierRoles,
  ready: gateway.isReady, inGuild: gateway.isInGuild, fetch: gateway.fetchGuildMember
}

before(async () => {
  await db.sequelize.sync()
  await db.User.create({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Booster Tester' })
  await db.Device.create({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'paired', tokenHash: hashToken(token) })
  config.discordOfficialGuildId = '123456789012345678'
  config.discordBoostTierRoles = { 2: '222222222222222222', 5: '555555555555555555' }
  gateway.isReady = () => !unavailable
  gateway.isInGuild = () => true
  gateway.fetchGuildMember = async () => member
  const app = express()
  app.use(route)
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  Object.assign(config, { discordOfficialGuildId: old.guild, discordBoostTierRoles: old.roles })
  gateway.isReady = old.ready
  gateway.isInGuild = old.inGuild
  gateway.fetchGuildMember = old.fetch
  if (server) await new Promise(resolve => server.close(resolve))
  await db.sequelize.close()
})

const get = (endpoint, useToken = true) => fetch(base + endpoint,
  { headers: useToken ? { Authorization: `Bearer ${token}` } : {} }).then(async r => ({ status: r.status, data: await r.json(), headers: r.headers }))

test('public catalogue is available without a token, but private grants require pairing', async () => {
  const catalog = await get('/api/community-booster/catalog', false)
  assert.equal(catalog.status, 200)
  assert.deepEqual(catalog.data.catalogue, catalogue)
  const denied = await get('/api/community-booster/me', false)
  assert.equal(denied.status, 401)
})

test('no Discord link gives zero rewards to an authenticated account', async () => {
  const result = await get('/api/community-booster/me')
  assert.equal(result.status, 200)
  assert.equal(result.data.linkedDiscord, false)
  assert.equal(result.data.tier, 'none')
  assert.deepEqual(result.data.unlocked, [])
  assert.equal(result.headers.get('cache-control'), 'no-store')
})

test('verified active boost unlocks Spark and higher roles upgrade while actively boosting', async () => {
  await db.DiscordLink.create({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', discordId: '987654321098765432' })
  linked = true
  member = { premiumSince: new Date(), roles: { cache: new Map() } }
  const spark = (await get('/api/community-booster/me')).data
  assert.equal(spark.activeBoostCount, 1)
  assert.equal(spark.rewardLevel, 1)
  assert.equal(spark.tier, 'spark')
  assert.deepEqual(spark.unlocked, ['badge', 'ribbon', 'sparkle'])
  member.roles.cache.set('555555555555555555', true)
  const high = (await get('/api/community-booster/me')).data
  assert.equal(high.tier, 'constellation')
  assert.equal(high.rewardLevel, 5)
  assert.equal(high.activeBoostCount, 1)
  assert.equal(high.source, 'discord_tier_role')
  member.premiumSince = null
  const ended = (await get('/api/community-booster/me')).data
  assert.equal(ended.tier, 'none')
  assert.equal(ended.rewardLevel, 0)
})

test('Discord outage fails closed with 503, not a false zero-booster result', async () => {
  unavailable = true
  try {
    const res = await get('/api/community-booster/me')
    assert.equal(res.status, 503)
    assert.equal(res.data.ok, false)
  } finally { unavailable = false }
  assert.equal(verifiedCount({ premiumSince: null, roles: { cache: new Map([['555555555555555555', true]]) } }, config.discordBoostTierRoles).count, 0)
  assert.equal(rewardsFor(3).tier, 'nova')
})

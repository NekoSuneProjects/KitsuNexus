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
const GUILD_A = '123456789012345678'
const GUILD_B = '876543210987654321'
let server
let base
let members = {}
let unavailable = false
let missingGuilds = []
let failingGuilds = []
const old = {
  guild: config.discordOfficialGuildId, guilds: config.discordBoosterGuildIds,
  token: config.discordBotToken,
  roles: config.discordBoostTierRoles, rolesByGuild: config.discordBoostTierRolesByGuild,
  ready: gateway.isReady, inGuild: gateway.isInGuild, fetch: gateway.fetchGuildMember
}

before(async () => {
  await db.sequelize.sync()
  await db.User.create({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'Booster Tester' })
  await db.Device.create({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'paired', tokenHash: hashToken(token) })
  config.discordOfficialGuildId = GUILD_A
  config.discordBoosterGuildIds = [GUILD_A, GUILD_B]
  config.discordBotToken = 'test-bot-token'
  config.discordBoostTierRoles = { 2: '222222222222222222', 5: '555555555555555555' }
  config.discordBoostTierRolesByGuild = { [GUILD_B]: { 3: '333333333333333333' } }
  gateway.isReady = () => !unavailable
  gateway.isInGuild = guildId => !missingGuilds.includes(guildId)
  gateway.fetchGuildMember = async guildId => {
    if (failingGuilds.includes(guildId)) throw new Error('Discord member lookup failed')
    return members[guildId] || null
  }
  const app = express()
  app.use(route)
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  Object.assign(config, {
    discordOfficialGuildId: old.guild, discordBoosterGuildIds: old.guilds,
    discordBotToken: old.token,
    discordBoostTierRoles: old.roles, discordBoostTierRolesByGuild: old.rolesByGuild
  })
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

test('configured booster servers remain protected from automatic guild removal', () => {
  assert.equal(gateway.isProtectedGuild(GUILD_A), true)
  assert.equal(gateway.isProtectedGuild(GUILD_B), true)
  assert.equal(gateway.isProtectedGuild('999999999999999999'), false)
})

test('verified active boost unlocks Spark and higher roles upgrade while actively boosting', async () => {
  await db.DiscordLink.create({ userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', discordId: '987654321098765432' })
  members = { [GUILD_A]: { premiumSince: new Date(), roles: { cache: new Map() } } }
  const spark = (await get('/api/community-booster/me')).data
  assert.equal(spark.activeBoostCount, 1)
  assert.equal(spark.rewardLevel, 1)
  assert.equal(spark.tier, 'spark')
  assert.deepEqual(spark.unlocked, ['badge', 'ribbon', 'sparkle'])
  assert.deepEqual(spark.guildStatuses, [
    { guildId: GUILD_A, active: true }, { guildId: GUILD_B, active: false }
  ])
  members[GUILD_A].roles.cache.set('555555555555555555', true)
  const high = (await get('/api/community-booster/me')).data
  assert.equal(high.tier, 'constellation')
  assert.equal(high.rewardLevel, 5)
  assert.equal(high.activeBoostCount, 1)
  assert.equal(high.source, 'discord_tier_role')
  members[GUILD_A].premiumSince = null
  const ended = (await get('/api/community-booster/me')).data
  assert.equal(ended.tier, 'none')
  assert.equal(ended.rewardLevel, 0)
})

test('boosting either guild qualifies and boosting both upgrades to Glow', async () => {
  members = { [GUILD_B]: { premiumSince: new Date(), roles: { cache: new Map() } } }
  const secondary = (await get('/api/community-booster/me')).data
  assert.equal(secondary.activeBoostCount, 1)
  assert.equal(secondary.tier, 'spark')
  assert.equal(secondary.guildStatuses[0].active, false)
  assert.equal(secondary.guildStatuses[1].active, true)

  members[GUILD_A] = { premiumSince: new Date(), roles: { cache: new Map() } }
  const both = (await get('/api/community-booster/me')).data
  assert.equal(both.activeBoostCount, 2)
  assert.equal(both.rewardLevel, 2)
  assert.equal(both.tier, 'glow')
  assert.equal(both.source, 'discord_membership')

  // Role thresholds apply only to the guild that granted them, and require an
  // active boost in that guild. No cross-guild role matching is permitted.
  members[GUILD_B].roles.cache.set('333333333333333333', true)
  const tierRole = (await get('/api/community-booster/me')).data
  assert.equal(tierRole.rewardLevel, 3)
  assert.equal(tierRole.tier, 'nova')
  assert.equal(tierRole.source, 'discord_tier_role')
  members[GUILD_B].premiumSince = null
  const inactiveRole = (await get('/api/community-booster/me')).data
  assert.equal(inactiveRole.rewardLevel, 1)
  assert.equal(inactiveRole.tier, 'spark')
})

test('Discord outage fails closed with 503, not a false zero-booster result', async () => {
  config.discordBotToken = ''
  try {
    const res = await get('/api/community-booster/me')
    assert.equal(res.status, 503)
  } finally { config.discordBotToken = 'test-bot-token' }
  unavailable = true
  try {
    const res = await get('/api/community-booster/me')
    assert.equal(res.status, 503)
    assert.equal(res.data.ok, false)
  } finally { unavailable = false }
  missingGuilds = [GUILD_B]
  try {
    const res = await get('/api/community-booster/me')
    assert.equal(res.status, 503)
  } finally { missingGuilds = [] }
  failingGuilds = [GUILD_A]
  try {
    const res = await get('/api/community-booster/me')
    assert.equal(res.status, 503)
  } finally { failingGuilds = [] }
  assert.equal(verifiedCount({ premiumSince: null, roles: { cache: new Map([['555555555555555555', true]]) } }, config.discordBoostTierRoles).count, 0)
  assert.equal(rewardsFor(3).tier, 'nova')
})

'use strict'

// All thresholds and available cosmetic perks originate on the server. The
// desktop receives only this public catalogue and the user's verified grant.
const config = require('../config')
const gateway = require('../discord/discordBotGateway')
const tiers = Object.freeze([
  { id: 'spark', label: 'Spark', minBoosts: 1, unlocks: ['badge', 'ribbon', 'sparkle'] },
  { id: 'glow', label: 'Glow', minBoosts: 2, unlocks: ['accent', 'border', 'ambient'] },
  { id: 'nova', label: 'Nova', minBoosts: 3, unlocks: ['nova', 'gradient', 'navigation'] },
  { id: 'constellation', label: 'Constellation', minBoosts: 5, unlocks: ['constellation', 'frame', 'starlight'] }
])

const catalogue = Object.freeze({
  version: 1,
  tiers,
  defaults: {
    ribbon: true, sparkle: true, accent: true, border: true, ambient: true,
    gradient: true, navigation: true, frame: true, starlight: true,
    decoration: 'auto'
  }
})

function rewardsFor (count) {
  const active = tiers.filter(t => count >= t.minBoosts)
  return {
    tier: active.length ? active[active.length - 1].id : 'none',
    unlocked: active.flatMap(t => t.unlocks)
  }
}

// The Discord member API establishes whether a linked account is actively
// boosting; it does not disclose how many individual boosts they contributed.
// Optional server-controlled roles indicate higher reward tiers. They are
// ignored unless the member also has a current premiumSince value.
function verifiedCount (member, roleIds = {}) {
  if (!member?.premiumSince) return { count: 0, source: 'discord_membership' }
  let count = 1
  for (const [threshold, roleId] of Object.entries(roleIds)) {
    if ([2, 3, 5].includes(Number(threshold)) && typeof roleId === 'string' && roleId &&
        member.roles?.cache?.has(roleId)) count = Math.max(count, Number(threshold))
  }
  return { count, source: count > 1 ? 'discord_tier_role' : 'discord_membership' }
}

// Share verification between the desktop API and website dashboard.
// An offline Discord gateway must never imply zero verified boosts.
async function entitlementForLink (link) {
  if (!config.discordOfficialGuildId || !gateway.isReady() || !gateway.isInGuild(config.discordOfficialGuildId)) {
    throw new Error('Discord booster verification is not configured or is unavailable')
  }
  if (!link) {
    return { verified: true, linkedDiscord: false, activeBoostCount: 0, rewardLevel: 0,
      ...rewardsFor(0), source: 'discord_membership', catalogue }
  }
  const member = await gateway.fetchGuildMember(config.discordOfficialGuildId, link.discordId)
  const { count, source } = verifiedCount(member, config.discordBoostTierRoles)
  return { verified: true, linkedDiscord: true, activeBoostCount: member?.premiumSince ? 1 : 0,
    rewardLevel: count, ...rewardsFor(count), source, catalogue }
}

module.exports = { catalogue, rewardsFor, verifiedCount, entitlementForLink }

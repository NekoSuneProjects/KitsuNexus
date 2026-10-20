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
// Each guild can prove one active boosting membership; Discord does not expose
// the number of boost slots a member uses within a guild. Partial failures
// must not silently turn an unknown guild into an inactive boost.
async function entitlementForLink (link) {
  const guildIds = config.discordBoosterGuildIds || []
  if (!guildIds.length) throw new Error('DISCORD_BOOST_GUILD_IDS or DISCORD_OFFICIAL_GUILD_ID must be configured')
  if (!config.discordBotToken) throw new Error('DISCORD_BOT_TOKEN must be configured for booster verification')
  if (!gateway.isReady()) throw new Error('Discord bot gateway is unavailable for booster verification')
  const missingGuildIds = guildIds.filter(guildId => !gateway.isInGuild(guildId))
  if (missingGuildIds.length) {
    throw new Error(`Discord booster verification is unavailable in guild(s): ${missingGuildIds.join(', ')}`)
  }
  if (!link) {
    return { verified: true, linkedDiscord: false, activeBoostCount: 0, rewardLevel: 0,
      ...rewardsFor(0), source: 'discord_membership', guildStatuses: [], catalogue }
  }
  const members = await Promise.all(guildIds.map(guildId => gateway.fetchGuildMember(guildId, link.discordId)))
  let activeBoostCount = 0
  let roleLevel = 0
  const guildStatuses = guildIds.map((guildId, index) => {
    const member = members[index]
    const active = !!member?.premiumSince
    if (active) {
      activeBoostCount++
      const roles = config.discordBoostTierRolesByGuild?.[guildId] ||
        (guildId === config.discordOfficialGuildId ? config.discordBoostTierRoles : {})
      roleLevel = Math.max(roleLevel, verifiedCount(member, roles).count)
    }
    return { guildId, active }
  })
  const rewardLevel = Math.max(activeBoostCount, roleLevel)
  return { verified: true, linkedDiscord: true, activeBoostCount,
    rewardLevel, ...rewardsFor(rewardLevel),
    source: roleLevel > activeBoostCount ? 'discord_tier_role' : 'discord_membership',
    guildStatuses, catalogue }
}

module.exports = { catalogue, rewardsFor, verifiedCount, entitlementForLink }

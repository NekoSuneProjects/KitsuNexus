// Syncs a KitsuNexus Community Rank change onto Discord roles, in every authorized guild that
// has configured a role mapping for it (GuildRankRole) and where the linked Discord account is
// actually a member. Best-effort throughout: a self-hoster's bot might not have Manage Roles
// yet, the member might not be in the guild, roles might be misconfigured — none of that should
// ever fail the rank sync request itself (routes/ranksSync.js awaits this but never lets it
// affect the response).
const { DiscordLink, GuildRankRole } = require('../db')
const authorizedGuilds = require('../discord/authorizedGuilds')
const botGateway = require('../discord/discordBotGateway')

async function syncRankRole (userId, newRankKey) {
  const link = await DiscordLink.findOne({ where: { userId } })
  if (!link || !botGateway.isReady()) return

  for (const guildId of Object.keys(authorizedGuilds.all())) {
    const mappings = await GuildRankRole.findAll({ where: { guildId } })
    if (!mappings.length) continue
    const roleForRank = Object.fromEntries(mappings.map(m => [m.rankKey, m.discordRoleId]))
    const allRankRoleIds = mappings.map(m => m.discordRoleId)
    const addRoleId = roleForRank[newRankKey] || null
    try {
      await botGateway.setMemberRankRole(guildId, link.discordId, addRoleId, allRankRoleIds)
    } catch (err) {
      console.warn(`[discordRankSync] role sync failed in guild ${guildId} for ${link.discordId}:`, err.message)
    }
  }
}

module.exports = { syncRankRole }

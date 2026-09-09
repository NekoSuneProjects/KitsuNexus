// Permanent ban + erase — the "harass a staff member or another user, breach these Terms,
// and you get permanently banned and your data deleted" path from the Privacy Policy/TOS.
// Two entry points end up here: an owner/admin banning someone from /admin, and
// discordBotGateway's guildBanAdd listener when a linked account gets banned directly on
// Discord (so a Discord-side ban enforces the same outcome here automatically).
const { BannedIdentity } = require('../db')
const { eraseUserData } = require('./accountErasure')

// `bannedBy` is a free-text label (a staff account id, or 'discord:<guildId>' for an
// auto-triggered ban from the gateway) — not a FK, since the acting account might itself not
// exist as a User row (the Discord-triggered path has no acting KitsuNexus user at all).
async function banUser (userId, reason, bannedBy) {
  const erased = await eraseUserData(userId)
  if (!erased) return { ok: false, error: 'User not found' }

  // Recorded AFTER erasure precisely so it survives it — otherwise a permanently-banned
  // harasser could immediately re-register under the same email/Discord identity.
  if (erased.email || erased.discordId) {
    await BannedIdentity.create({ email: erased.email || null, discordId: erased.discordId || null, reason: reason || null, bannedBy: bannedBy || null })
  }

  // Best-effort: also ban them from the official KitsuNexus guild if we know who they are on
  // Discord — deliberately scoped to that one guild only (banFromOfficialGuild), never every
  // guild the bot happens to be in. Never blocks the ban+erase outcome on this succeeding — the
  // account and its data are already gone either way.
  if (erased.discordId) {
    try {
      const botGateway = require('../discord/discordBotGateway')
      await botGateway.banFromOfficialGuild(erased.discordId, reason || 'Banned from KitsuNexus')
    } catch (err) { console.warn('[banUser] Discord-side ban failed (non-fatal):', err.message) }
  }

  return { ok: true, erasedEmail: erased.email, erasedDiscordId: erased.discordId }
}

function isBanned ({ email, discordId } = {}) {
  const { Op } = require('sequelize')
  const where = []
  if (email) where.push({ email })
  if (discordId) where.push({ discordId })
  if (!where.length) return Promise.resolve(false)
  return BannedIdentity.findOne({ where: { [Op.or]: where } }).then(row => !!row)
}

module.exports = { banUser, isBanned }

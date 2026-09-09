const express = require('express')
const { DiscordLink, GuildRankRole } = require('../db')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')
const authorizedGuilds = require('../discord/authorizedGuilds')
const botGateway = require('../discord/discordBotGateway')

const router = express.Router()

// Keep in sync with RANKS in the Electron app's modules/ranks/rankEngine.js — this server
// never computes a rank itself (routes/ranksSync.js just receives one), so it doesn't import
// that file; these keys/labels only need to match closely enough for the mapping UI to make
// sense. 'visitor' is deliberately omitted — nobody needs a Discord role for "hasn't ranked up
// yet" — but sync would still ignore it either way since it's just not offered a config row.
const RANK_KEYS = [
  { key: 'new_user', label: 'New User' },
  { key: 'user', label: 'User' },
  { key: 'known_user', label: 'Known User' },
  { key: 'trusted_user', label: 'Trusted User' },
  { key: 'veteran', label: 'Veteran' },
  { key: 'legend', label: 'Legend' },
]

router.get('/settings/discord', requireAuth, asyncHandler(async (req, res) => {
  const link = await DiscordLink.findOne({ where: { userId: req.user.id } })
  let guilds = []
  if (link) {
    const mine = Object.entries(authorizedGuilds.all()).filter(([, v]) => v.authorizedBy === link.discordId)
    guilds = await Promise.all(mine.map(async ([id, v]) => {
      const canManage = await botGateway.hasManagePermission(id, link.discordId)
      const roleRows = await GuildRankRole.findAll({ where: { guildId: id } })
      const roleByRank = Object.fromEntries(roleRows.map(r => [r.rankKey, r.discordRoleId]))
      return { id, authorizedAt: v.at, canManage, rankRoles: RANK_KEYS.map(r => ({ ...r, roleId: roleByRank[r.key] || '' })) }
    }))
  }
  res.render('settings-discord', {
    title: 'Discord — KitsuNexus',
    link,
    guilds,
    discordConfigured: !!(config.discordClientId && config.discordClientSecret && config.discordRedirectUri),
  })
}))

router.post('/settings/discord/unlink', requireAuth, asyncHandler(async (req, res) => {
  await DiscordLink.destroy({ where: { userId: req.user.id } })
  res.redirect('/settings/discord')
}))

// Removing the bot from a guild. Re-checks Manage Server live server-side — never trust that
// the "Remove" button was correctly hidden client-side.
router.post('/settings/discord/guilds/:guildId/revoke', requireAuth, asyncHandler(async (req, res) => {
  const link = await DiscordLink.findOne({ where: { userId: req.user.id } })
  if (link && await botGateway.hasManagePermission(req.params.guildId, link.discordId)) {
    authorizedGuilds.revoke(req.params.guildId)
    await botGateway.leaveGuild(req.params.guildId)
  }
  res.redirect('/settings/discord')
}))

// Saves this guild's Community Rank → Discord role id mapping (services/discordRankSync.js
// reads these). Re-checks Manage Server live, same gate as removing the bot — role ids are
// pasted in by hand (Discord's "Copy Role ID" with Developer Mode on), no live role picker.
router.post('/settings/discord/guilds/:guildId/rank-roles', requireAuth, asyncHandler(async (req, res) => {
  const link = await DiscordLink.findOne({ where: { userId: req.user.id } })
  if (!link || !await botGateway.hasManagePermission(req.params.guildId, link.discordId)) {
    return res.status(403).render('403', { title: 'Forbidden — KitsuNexus' })
  }
  const guildId = req.params.guildId
  for (const { key } of RANK_KEYS) {
    const roleId = String((req.body || {})[key] || '').trim()
    if (roleId) {
      const [row] = await GuildRankRole.findOrCreate({ where: { guildId, rankKey: key }, defaults: { guildId, rankKey: key, discordRoleId: roleId } })
      if (row.discordRoleId !== roleId) await row.update({ discordRoleId: roleId })
    } else {
      await GuildRankRole.destroy({ where: { guildId, rankKey: key } })
    }
  }
  res.redirect('/settings/discord')
}))

module.exports = router

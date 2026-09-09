const express = require('express')
const fs = require('fs')
const { User, Device, Favorite, WorldVisit, ApiKey, BannedIdentity, RankScore, GuildRankRole, ShareLink, Entity, sequelize } = require('../db')
const requireAdmin = require('../middleware/requireAdmin')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')
const { generateToken, hashToken } = require('../auth/deviceToken')
const authorizedGuilds = require('../discord/authorizedGuilds')
const botGateway = require('../discord/discordBotGateway')
const { isReady: isDiscordBotReady, getLastError: discordLastError } = botGateway
const { banUser } = require('../services/banUser')
const { eraseUserData } = require('../services/accountErasure')

const router = express.Router()

// Shared by GET /admin and POST /admin/api-keys (which re-renders the page to show a freshly
// created key's plaintext exactly once, instead of redirecting and losing it).
async function renderAdmin (req, res, { newApiKey = null } = {}) {
  const users = await User.findAll({ order: [['createdAt', 'ASC']] })
  const deviceCounts = await Device.count({ group: ['userId'] })
  const favoriteCounts = await Favorite.count({ group: ['userId'] })
  const devicesByUser = Object.fromEntries(deviceCounts.map(r => [r.userId, r.count]))
  const favoritesByUser = Object.fromEntries(favoriteCounts.map(r => [r.userId, r.count]))
  const apiKeys = await ApiKey.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })
  const bannedIdentities = await BannedIdentity.findAll({ order: [['createdAt', 'DESC']] })

  const guilds = await Promise.all(Object.entries(authorizedGuilds.all()).map(async ([id, v]) => ({
    id, authorizedBy: v.authorizedBy, authorizedAt: v.at, inBot: botGateway.isInGuild(id),
    rankRoles: await GuildRankRole.findAll({ where: { guildId: id } }),
    isOfficial: !!config.discordOfficialGuildId && id === config.discordOfficialGuildId,
  })))

  const leaderboard = await RankScore.findAll({
    include: [{ model: User, attributes: ['displayName'] }],
    order: [['finalScore', 'DESC']],
    limit: 20,
  })

  let dbSizeBytes = 0
  try { dbSizeBytes = fs.statSync(sequelize.options.storage).size } catch (_) {}

  res.render('admin', {
    title: 'Admin — KitsuNexus',
    users: users.map(u => ({
      id: u.id, email: u.email, displayName: u.displayName, role: u.role, isStub: u.isStub,
      createdAt: u.createdAt, deviceCount: devicesByUser[u.id] || 0, favoriteCount: favoritesByUser[u.id] || 0,
    })),
    totals: {
      users: users.length,
      devices: await Device.count(),
      favorites: await Favorite.count(),
      worldVisits: await WorldVisit.count(),
      shareLinks: await ShareLink.count(),
      cachedEntities: await Entity.count(),
      rankedUsers: await RankScore.count(),
    },
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      dbSizeBytes,
      siteUrl: config.siteUrl,
    },
    discord: {
      configured: !!config.discordBotToken,
      botReady: isDiscordBotReady(),
      lastError: discordLastError(),
      officialGuildId: config.discordOfficialGuildId || '',
    },
    guilds,
    leaderboard: leaderboard.map((r, i) => ({ position: i + 1, displayName: (r.User && r.User.displayName) || 'Someone', rankKey: r.rankKey, finalScore: r.finalScore })),
    apiKeys,
    newApiKey,
    bannedIdentities,
  })
}

// Server-operator view — every account, aggregate totals, bot/server health. Locked to
// owner/admin roles only (requireAdmin), never shown to a regular account's own /dashboard.
router.get('/admin', requireAdmin, asyncHandler((req, res) => renderAdmin(req, res)))

// Owner-facing API keys — for pulling GET /api/worlds/feed into an external service (e.g. the
// owner's avatar/world search site). The plaintext key is shown exactly once, right here.
router.post('/admin/api-keys', requireAdmin, asyncHandler(async (req, res) => {
  const label = (req.body && req.body.label) || 'API key'
  const token = generateToken()
  await ApiKey.create({ userId: req.user.id, label, keyHash: hashToken(token) })
  await renderAdmin(req, res, { newApiKey: token })
}))

router.post('/admin/api-keys/:id/revoke', requireAdmin, asyncHandler(async (req, res) => {
  await ApiKey.destroy({ where: { id: req.params.id, userId: req.user.id } })
  res.redirect('/admin')
}))

// Permanent ban + full data erasure (see PRIVACY.md/TOS.md's harassment provision, and
// services/banUser.js) — refuses to ban an owner (demote them first) or the stub placeholder
// account. Also bans them from Discord if they're linked, best-effort.
router.post('/admin/users/:id/ban', requireAdmin, asyncHandler(async (req, res) => {
  const target = await User.findByPk(req.params.id)
  if (!target) return res.redirect('/admin')
  if (target.isStub) return res.redirect('/admin')
  if (target.role === 'owner') {
    return res.status(400).send('Cannot ban an owner account — demote them to a regular user first.')
  }
  await banUser(target.id, (req.body && req.body.reason) || null, req.user.id)
  res.redirect('/admin')
}))

// Plain delete — erases the account and its data the same way ban does, but WITHOUT recording
// a BannedIdentity (so the email/Discord id is free to register again) and without touching
// Discord at all. For removing a test/unwanted account, not moderating one — use "Ban & erase"
// for anything harassment/abuse related instead.
router.post('/admin/users/:id/delete', requireAdmin, asyncHandler(async (req, res) => {
  const target = await User.findByPk(req.params.id)
  if (!target) return res.redirect('/admin')
  if (target.isStub) return res.redirect('/admin')
  if (target.role === 'owner') {
    return res.status(400).send('Cannot delete an owner account — demote them to a regular user first.')
  }
  await eraseUserData(target.id)
  res.redirect('/admin')
}))

// Owner-only, unlike ban above (any admin can ban) — changing who else has admin/owner power is
// more sensitive than moderating a regular account, so it's restricted to owners specifically
// even though requireAdmin itself would let an 'admin' role reach this route.
router.post('/admin/users/:id/set-role', requireAdmin, asyncHandler(async (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).render('403', { title: 'Forbidden — KitsuNexus' })
  const target = await User.findByPk(req.params.id)
  const nextRole = (req.body && req.body.role) || ''
  if (!target || target.isStub || !['user', 'admin', 'owner'].includes(nextRole)) return res.redirect('/admin')
  if (target.role === 'owner' && nextRole !== 'owner') {
    const ownerCount = await User.count({ where: { role: 'owner' } })
    if (ownerCount <= 1) return res.status(400).send('Cannot demote the only owner account — promote another account to owner first.')
  }
  await target.update({ role: nextRole })
  res.redirect('/admin')
}))

// Force-revoke a guild's bot access from the admin side — unlike /settings/discord's own
// revoke, this doesn't require the acting admin to personally hold Manage Server in that guild
// (an owner running this server should be able to pull the bot out of anywhere it's authorized,
// even a guild none of their own linked accounts manage). Still refuses the official guild —
// same protection enforceWhitelist gives it against the automatic leave-unauthorized sweep.
router.post('/admin/guilds/:guildId/revoke', requireAdmin, asyncHandler(async (req, res) => {
  const guildId = req.params.guildId
  if (config.discordOfficialGuildId && guildId === config.discordOfficialGuildId) {
    return res.status(400).send('Cannot remove the bot from the official guild.')
  }
  authorizedGuilds.revoke(guildId)
  await botGateway.leaveGuild(guildId)
  res.redirect('/admin')
}))

module.exports = router

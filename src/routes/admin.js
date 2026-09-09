const express = require('express')
const fs = require('fs')
const { User, Device, Favorite, ApiKey, BannedIdentity, sequelize } = require('../db')
const requireAdmin = require('../middleware/requireAdmin')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')
const { generateToken, hashToken } = require('../auth/deviceToken')
const { guildCount } = require('../discord/authorizedGuilds')
const { isReady: isDiscordBotReady, getLastError: discordLastError } = require('../discord/discordBotGateway')
const { banUser } = require('../services/banUser')

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
      authorizedGuilds: guildCount(),
    },
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

module.exports = router

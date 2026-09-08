const express = require('express')
const fs = require('fs')
const { User, Device, Favorite, sequelize } = require('../db')
const requireAdmin = require('../middleware/requireAdmin')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')
const { guildCount } = require('../discord/authorizedGuilds')
const { isReady: isDiscordBotReady } = require('../discord/discordBotGateway')

const router = express.Router()

// Server-operator view — every account, aggregate totals, bot/server health. Locked to
// owner/admin roles only (requireAdmin), never shown to a regular account's own /dashboard.
router.get('/admin', requireAdmin, asyncHandler(async (req, res) => {
  const users = await User.findAll({ order: [['createdAt', 'ASC']] })
  const deviceCounts = await Device.count({ group: ['userId'] })
  const favoriteCounts = await Favorite.count({ group: ['userId'] })
  const devicesByUser = Object.fromEntries(deviceCounts.map(r => [r.userId, r.count]))
  const favoritesByUser = Object.fromEntries(favoriteCounts.map(r => [r.userId, r.count]))

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
      authorizedGuilds: guildCount(),
    },
  })
}))

module.exports = router

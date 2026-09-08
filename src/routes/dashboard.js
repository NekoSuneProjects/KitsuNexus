const express = require('express')
const fs = require('fs')
const { Device, Favorite, sequelize } = require('../db')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')
const config = require('../config')

const router = express.Router()

router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const devices = await Device.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })
  const favorites = await Favorite.findAll({ where: { userId: req.user.id } })

  const byType = { friend: 0, world: 0, avatar: 0 }
  const byCollection = {}
  for (const f of favorites) {
    byType[f.type] = (byType[f.type] || 0) + 1
    byCollection[f.collection] = (byCollection[f.collection] || 0) + 1
  }

  let dbSizeBytes = 0
  try { dbSizeBytes = fs.statSync(sequelize.options.storage).size } catch (_) {}

  res.render('dashboard', {
    title: 'Dashboard — KitsuNexus',
    user: req.user,
    devices,
    favoriteCount: favorites.length,
    byType,
    byCollection: Object.entries(byCollection).sort((a, b) => b[1] - a[1]),
    server: {
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      dbSizeBytes,
      siteUrl: config.siteUrl,
    },
  })
}))

router.post('/dashboard/devices/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  await Device.destroy({ where: { id: req.params.id, userId: req.user.id } })
  res.redirect('/dashboard')
}))

module.exports = router

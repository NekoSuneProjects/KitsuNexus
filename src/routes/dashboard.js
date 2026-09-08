const express = require('express')
const { Device, Favorite, DiscordLink } = require('../db')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()

// Personal dashboard — any logged-in account, scoped to their own data only. Server-wide
// stuff (all users, aggregate totals) lives at /admin instead (routes/admin.js).
router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  const devices = await Device.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })
  const favorites = await Favorite.findAll({ where: { userId: req.user.id } })
  const discordLink = await DiscordLink.findOne({ where: { userId: req.user.id } })

  const byType = { friend: 0, world: 0, avatar: 0 }
  const byCollection = {}
  for (const f of favorites) {
    byType[f.type] = (byType[f.type] || 0) + 1
    byCollection[f.collection] = (byCollection[f.collection] || 0) + 1
  }

  res.render('dashboard', {
    title: 'Dashboard — KitsuNexus',
    user: req.user,
    devices,
    discordLink,
    favoriteCount: favorites.length,
    byType,
    byCollection: Object.entries(byCollection).sort((a, b) => b[1] - a[1]),
  })
}))

router.post('/dashboard/devices/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  await Device.destroy({ where: { id: req.params.id, userId: req.user.id } })
  res.redirect('/dashboard')
}))

module.exports = router

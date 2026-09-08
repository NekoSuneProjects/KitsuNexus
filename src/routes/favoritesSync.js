const express = require('express')
const { Op } = require('sequelize')
const { Favorite } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()
router.use('/api/favorites', asyncHandler(requireDeviceToken))

// Pull everything changed (added/edited/removed) since `since` (ms epoch). Removed favorites
// come back with deletedAt set — the client is expected to remove/tombstone them locally too.
router.get('/api/favorites/sync', asyncHandler(async (req, res) => {
  const since = new Date(parseInt(req.query.since, 10) || 0)
  const rows = await Favorite.findAll({
    where: { userId: req.userId, [Op.or]: [{ updatedAt: { [Op.gt]: since } }, { deletedAt: { [Op.gt]: since } }] },
    paranoid: false,
  })
  res.json({
    ok: true,
    serverTime: Date.now(),
    favorites: rows.map(f => ({
      vrchatId: f.vrchatId, type: f.type, displayName: f.displayName, imageUrl: f.imageUrl,
      note: f.note, collection: f.collection, updatedAt: +f.updatedAt, deletedAt: f.deletedAt ? +f.deletedAt : null,
    })),
  })
}))

// Push local changes. Last-write-wins by updatedAt, keyed on (userId, type, vrchatId).
router.post('/api/favorites/sync', asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body && req.body.favorites) ? req.body.favorites : []
  let applied = 0, skipped = 0
  for (const item of incoming) {
    if (!item || !item.type || !item.vrchatId) { skipped++; continue }
    const existing = await Favorite.findOne({ where: { userId: req.userId, type: item.type, vrchatId: item.vrchatId }, paranoid: false })
    const incomingUpdatedAt = new Date(item.updatedAt || Date.now())
    if (existing && existing.updatedAt >= incomingUpdatedAt) { skipped++; continue }
    if (item.deletedAt) {
      if (existing) { await existing.destroy() } // sets deletedAt = now; good enough for a moderate sync interval
      applied++
      continue
    }
    if (existing) {
      await existing.restore().catch(() => {})
      await existing.update({ displayName: item.displayName, imageUrl: item.imageUrl, note: item.note, collection: item.collection || 'default' })
    } else {
      await Favorite.create({ userId: req.userId, type: item.type, vrchatId: item.vrchatId, displayName: item.displayName, imageUrl: item.imageUrl, note: item.note, collection: item.collection || 'default' })
    }
    applied++
  }
  res.json({ ok: true, applied, skipped, serverTime: Date.now() })
}))

module.exports = router

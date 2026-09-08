const express = require('express')
const { Op } = require('sequelize')
const { WorldVisit } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()
router.use('/api/history/worlds', asyncHandler(requireDeviceToken))

// Pull visits recorded since `since` (ms epoch) — append-only, no tombstones needed.
router.get('/api/history/worlds/sync', asyncHandler(async (req, res) => {
  const since = new Date(parseInt(req.query.since, 10) || 0)
  const rows = await WorldVisit.findAll({ where: { userId: req.userId, visitedAt: { [Op.gt]: since } }, order: [['visitedAt', 'ASC']] })
  res.json({
    ok: true,
    serverTime: Date.now(),
    visits: rows.map(v => ({ worldId: v.worldId, worldName: v.worldName, visitedAt: +v.visitedAt })),
  })
}))

// Push new visits. Deduped by (userId, worldId, visitedAt) — a duplicate push (e.g. retried
// after a network blip) is just ignored rather than erroring.
router.post('/api/history/worlds/sync', asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body && req.body.visits) ? req.body.visits : []
  let applied = 0, skipped = 0
  for (const v of incoming) {
    if (!v || !v.worldId || !v.visitedAt) { skipped++; continue }
    const [, created] = await WorldVisit.findOrCreate({
      where: { userId: req.userId, worldId: v.worldId, visitedAt: new Date(v.visitedAt) },
      defaults: { userId: req.userId, worldId: v.worldId, worldName: v.worldName || null, visitedAt: new Date(v.visitedAt) },
    })
    created ? applied++ : skipped++
  }
  res.json({ ok: true, applied, skipped, serverTime: Date.now() })
}))

module.exports = router

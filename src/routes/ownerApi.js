const express = require('express')
const { Op } = require('sequelize')
const { Favorite, WorldVisit } = require('../db')
const requireApiKey = require('../middleware/requireApiKey')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()

// Not the website's own account API — this is meant for an external service (e.g. the owner's
// avatar/world search site) to pull worlds the owner has favorited or visited, as plain JSON.
// Gated by an API key (see /admin ▸ API keys, requireApiKey.js), not a login session.
router.get('/api/worlds/feed', requireApiKey, asyncHandler(async (req, res) => {
  const since = new Date(parseInt(req.query.since, 10) || 0)

  const favorites = await Favorite.findAll({ where: { userId: req.userId, type: 'world' } })
  const visits = await WorldVisit.findAll({ where: { userId: req.userId }, order: [['visitedAt', 'DESC']] })

  const byWorld = new Map()
  for (const v of visits) {
    const entry = byWorld.get(v.worldId) || { worldId: v.worldId, name: v.worldName || '', favorited: false, lastVisitedAt: null, favoritedAt: null }
    if (!entry.lastVisitedAt || v.visitedAt > entry.lastVisitedAt) entry.lastVisitedAt = v.visitedAt
    if (!entry.name && v.worldName) entry.name = v.worldName
    byWorld.set(v.worldId, entry)
  }
  for (const f of favorites) {
    const entry = byWorld.get(f.vrchatId) || { worldId: f.vrchatId, name: f.displayName || '', favorited: false, lastVisitedAt: null, favoritedAt: null }
    entry.favorited = true
    entry.favoritedAt = f.updatedAt
    if (!entry.name && f.displayName) entry.name = f.displayName
    entry.imageUrl = f.imageUrl || entry.imageUrl
    byWorld.set(f.vrchatId, entry)
  }

  let worlds = [...byWorld.values()]
  if (since.getTime() > 0) {
    worlds = worlds.filter(w => (w.lastVisitedAt && w.lastVisitedAt > since) || (w.favoritedAt && w.favoritedAt > since))
  }
  worlds.sort((a, b) => (b.lastVisitedAt || b.favoritedAt || 0) - (a.lastVisitedAt || a.favoritedAt || 0))

  res.json({
    ok: true,
    serverTime: Date.now(),
    count: worlds.length,
    worlds: worlds.map(w => ({
      worldId: w.worldId, name: w.name, imageUrl: w.imageUrl || null, favorited: w.favorited,
      lastVisitedAt: w.lastVisitedAt ? +w.lastVisitedAt : null,
      favoritedAt: w.favoritedAt ? +w.favoritedAt : null,
    })),
  })
}))

module.exports = router

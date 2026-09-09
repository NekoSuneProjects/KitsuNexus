const express = require('express')
const { RankScore, User } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')
const { syncRankRole } = require('../services/discordRankSync')

const router = express.Router()
router.use('/api/ranks', asyncHandler(requireDeviceToken))

// Push the locally-computed Community Rank (modules/ranks in the Electron app — this endpoint
// never computes a score itself, it just receives one) so it can back a real cross-user
// leaderboard. A single install's own sqlite file can never be a leaderboard on its own; this
// is what makes it one.
router.post('/api/ranks/sync', asyncHandler(async (req, res) => {
  const { rankKey, finalScore, tier } = req.body || {}
  if (!rankKey || typeof finalScore !== 'number') {
    return res.status(400).json({ ok: false, error: 'rankKey and finalScore are required' })
  }
  const existing = await RankScore.findOne({ where: { userId: req.userId } })
  const rankChanged = !existing || existing.rankKey !== rankKey
  const patch = { rankKey, finalScore: Math.round(finalScore), tier: tier || 0 }
  if (existing) await existing.update(patch)
  else await RankScore.create({ userId: req.userId, ...patch })

  // Never let a Discord hiccup fail the sync itself — the score is saved either way.
  if (rankChanged) syncRankRole(req.userId, rankKey).catch(err => console.warn('[ranksSync] role sync failed:', err.message))

  res.json({ ok: true, rankChanged })
}))

// Top N by score, across every user who has ever pushed a rank — this IS the leaderboard now;
// the Electron app's own local one only ever had its own single row.
router.get('/api/ranks/leaderboard', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const rows = await RankScore.findAll({
    include: [{ model: User, attributes: ['displayName'] }],
    order: [['finalScore', 'DESC']],
    limit,
  })
  res.json({
    ok: true,
    entries: rows.map(r => ({ displayName: (r.User && r.User.displayName) || 'Someone', rankKey: r.rankKey, finalScore: r.finalScore, tier: r.tier })),
  })
}))

module.exports = router

const express = require('express')
const { Entity, ShareLink, Favorite } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')
const { generateShareCode } = require('../auth/deviceToken')
const config = require('../config')
const { serializeEntity } = require('./entityCache')

const router = express.Router()

// Create a share link for something already cached (routes/entityCache.js) — worlds/avatars
// only; sharing a "user" isn't meaningful here since there's nothing for a recipient to claim.
router.post('/api/share', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  const { type, vrchatId, expiresInHours } = req.body || {}
  if (!['world', 'avatar'].includes(type) || !vrchatId) {
    return res.status(400).json({ ok: false, error: 'type must be "world" or "avatar", and vrchatId is required' })
  }
  const entity = await Entity.findOne({ where: { type, vrchatId } })
  if (!entity) return res.status(404).json({ ok: false, error: 'Nothing cached for that id yet — view it in the app first so there is something to share' })

  const expiresAt = expiresInHours ? new Date(Date.now() + Math.max(1, Number(expiresInHours)) * 3600000) : null
  const link = await ShareLink.create({ code: generateShareCode(), type, vrchatId, createdByUserId: req.userId, expiresAt })
  res.json({ ok: true, code: link.code, url: `${config.siteUrl}/s/${link.code}` })
}))

async function resolveLink (code) {
  const link = await ShareLink.findOne({ where: { code } })
  if (!link) return { error: 'not_found' }
  if (link.revokedAt) return { error: 'revoked' }
  if (link.expiresAt && link.expiresAt < new Date()) return { error: 'expired' }
  const entity = await Entity.findOne({ where: { type: link.type, vrchatId: link.vrchatId } })
  return { link, entity }
}

// Public — no auth. Anyone with the link (KitsuNexus account or not) sees the cached public
// info; this never exposes anything about the sharer beyond the fact that someone shared it.
router.get('/s/:code', asyncHandler(async (req, res) => {
  const { link, entity, error } = await resolveLink(req.params.code)
  if (error) return res.status(404).render('share', { title: 'Link not found — KitsuNexus', link: null, entity: null, error })
  res.render('share', { title: `${(entity && entity.name) || link.vrchatId} — KitsuNexus`, link, entity, error: null })
}))

router.get('/api/share/:code', asyncHandler(async (req, res) => {
  const { link, entity, error } = await resolveLink(req.params.code)
  if (error) return res.status(404).json({ ok: false, error })
  res.json({ ok: true, type: link.type, vrchatId: link.vrchatId, entity: entity ? serializeEntity(entity) : null })
}))

// A recipient's own paired device turns the link into their own Favorite — a plain copy of the
// public vrchatId + cached metadata, same as if they'd favorited it themselves. Never touches
// the sharer's account, tokens, or any private data, and still works even if the sharer has
// since unpaired/disconnected — the link only ever needed the public Entity cache.
router.post('/api/share/:code/claim', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  const { link, entity, error } = await resolveLink(req.params.code)
  if (error) return res.status(404).json({ ok: false, error })
  const [favorite, created] = await Favorite.findOrCreate({
    where: { userId: req.userId, type: link.type, vrchatId: link.vrchatId },
    defaults: {
      userId: req.userId,
      type: link.type,
      vrchatId: link.vrchatId,
      displayName: entity ? entity.name : null,
      imageUrl: entity ? entity.imageUrl : null,
      collection: 'shared',
    },
  })
  if (!created) await favorite.restore().catch(() => {})
  res.json({ ok: true, created, favorite: { vrchatId: favorite.vrchatId, type: favorite.type, displayName: favorite.displayName } })
}))

module.exports = router

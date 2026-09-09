const express = require('express')
const { Entity } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()
router.use('/api/entities', asyncHandler(requireDeviceToken))

const TYPES = ['world', 'avatar', 'user']
const VISIBILITIES = ['public', 'private', 'deleted']

function normalize (item) {
  if (!item || !TYPES.includes(item.type) || !item.vrchatId) return null
  return {
    type: item.type,
    vrchatId: String(item.vrchatId),
    name: item.name || null,
    imageUrl: item.imageUrl || null,
    description: item.description || null,
    authorName: item.authorName || null,
    authorId: item.authorId || null,
    tags: Array.isArray(item.tags) ? JSON.stringify(item.tags) : null,
    extra: item.extra && typeof item.extra === 'object' ? JSON.stringify(item.extra) : null,
    visibility: VISIBILITIES.includes(item.visibility) ? item.visibility : 'unknown',
  }
}

function serialize (e) {
  return {
    type: e.type,
    vrchatId: e.vrchatId,
    name: e.name,
    imageUrl: e.imageUrl,
    description: e.description,
    authorName: e.authorName,
    authorId: e.authorId,
    tags: e.tags ? JSON.parse(e.tags) : [],
    extra: e.extra ? JSON.parse(e.extra) : {},
    visibility: e.visibility,
    lastSeenPublicAt: e.lastSeenPublicAt ? +e.lastSeenPublicAt : null,
    goneAt: e.goneAt ? +e.goneAt : null,
  }
}

// Upsert one or more entities the client just fetched fresh data for from VRChat's own API —
// this is how the cache learns names/images/authors/etc, and how it learns something went
// private or was deleted. Never overwrites known-good name/image/etc with blanks (e.g. a 404
// lookup still carries the previously-cached name forward), so a "gone" entry keeps its
// last-known public info instead of losing it.
router.post('/api/entities/sync', asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body && req.body.entities) ? req.body.entities : []
  let applied = 0, skipped = 0
  for (const raw of incoming) {
    const item = normalize(raw)
    if (!item) { skipped++; continue }
    const existing = await Entity.findOne({ where: { type: item.type, vrchatId: item.vrchatId } })
    const now = new Date()
    const patch = {
      name: item.name || (existing && existing.name) || null,
      imageUrl: item.imageUrl || (existing && existing.imageUrl) || null,
      description: item.description || (existing && existing.description) || null,
      authorName: item.authorName || (existing && existing.authorName) || null,
      authorId: item.authorId || (existing && existing.authorId) || null,
      tags: item.tags || (existing && existing.tags) || null,
      extra: item.extra || (existing && existing.extra) || null,
      visibility: item.visibility,
    }
    if (item.visibility === 'public') patch.lastSeenPublicAt = now
    if (item.visibility === 'private' || item.visibility === 'deleted') {
      patch.goneAt = (existing && existing.goneAt) || now
    }
    if (existing) await existing.update(patch)
    else await Entity.create({ type: item.type, vrchatId: item.vrchatId, ...patch })
    applied++
  }
  res.json({ ok: true, applied, skipped, serverTime: Date.now() })
}))

// Fetch one cached entity — e.g. showing "last known info" for a world that's since gone
// private/deleted, or backing a Favorite whose live VRChat lookup now 404s.
router.get('/api/entities/:type/:vrchatId', asyncHandler(async (req, res) => {
  if (!TYPES.includes(req.params.type)) return res.status(400).json({ ok: false, error: 'Unknown entity type' })
  const entity = await Entity.findOne({ where: { type: req.params.type, vrchatId: req.params.vrchatId } })
  if (!entity) return res.status(404).json({ ok: false, error: 'Not cached' })
  res.json({ ok: true, entity: serialize(entity) })
}))

module.exports = router
module.exports.serializeEntity = serialize

const express = require('express')
const { Device, Favorite, WorldVisit, DiscordLink, RankScore, ShareLink, Entity } = require('../db')
const requireAuth = require('../middleware/requireAuth')
const asyncHandler = require('../utils/asyncHandler')
const session = require('../auth/session')
const config = require('../config')
const { eraseUserData } = require('../services/accountErasure')
const { generateShareCode, generateOverlayId } = require('../auth/deviceToken')

const router = express.Router()

const FAV_PAGE_SIZE = 20
const FAV_TYPES = ['friend', 'world', 'avatar', 'group']

// Personal dashboard — any logged-in account, scoped to their own data only. Server-wide
// stuff (all users, aggregate totals) lives at /admin instead (routes/admin.js).
router.get('/dashboard', requireAuth, asyncHandler(async (req, res) => {
  // Backfills what db/index.js's ensureStubUser and routes/overlay.js's ensureOverlayId already
  // do for the stub account and paired-device users respectively — a website-only account
  // (registered/setup here, never having called the app's /api/overlay/mine) would otherwise
  // never get one and the Overlay panel below would show "not available" forever.
  if (!req.user.overlayId) await req.user.update({ overlayId: generateOverlayId() })

  const devices = await Device.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })
  const discordLink = await DiscordLink.findOne({ where: { userId: req.user.id } })
  const rankScore = await RankScore.findOne({ where: { userId: req.user.id } })
  const worldVisitCount = await WorldVisit.count({ where: { userId: req.user.id } })
  const shareLinks = await ShareLink.findAll({ where: { createdByUserId: req.user.id }, order: [['createdAt', 'DESC']] })

  // Counts + collection breakdown come from every favorite, not just the current page.
  const allFavorites = await Favorite.findAll({ where: { userId: req.user.id }, attributes: ['type', 'collection'] })
  const byType = { friend: 0, world: 0, avatar: 0, group: 0 }
  const byCollection = {}
  for (const f of allFavorites) {
    byType[f.type] = (byType[f.type] || 0) + 1
    byCollection[f.collection] = (byCollection[f.collection] || 0) + 1
  }

  // Paginated list for the active Favorites sub-tab.
  const favType = FAV_TYPES.includes(req.query.favType) ? req.query.favType : 'world'
  const favPage = Math.max(1, parseInt(req.query.favPage, 10) || 1)
  const { rows: favoritePage, count: favTypeCount } = await Favorite.findAndCountAll({
    where: { userId: req.user.id, type: favType },
    order: [['createdAt', 'DESC']],
    limit: FAV_PAGE_SIZE,
    offset: (favPage - 1) * FAV_PAGE_SIZE,
  })

  // For the Share panel — worlds/avatars only (see routes/share.js: sharing a "user" isn't
  // meaningful, nothing for a recipient to claim), most recent first, capped for a simple list.
  const shareableFavorites = await Favorite.findAll({
    where: { userId: req.user.id, type: ['world', 'avatar'] },
    order: [['createdAt', 'DESC']],
    limit: 100,
  })

  res.render('dashboard', {
    title: 'Dashboard — KitsuNexus',
    user: req.user,
    devices,
    discordLink,
    rankScore,
    overlayUrl: req.user.overlayId ? `${config.siteUrl}/overlay/${req.user.overlayId}` : '',
    overlayStyle: req.user.overlayStyle || 'default',
    overlayBoxBg: req.user.overlayBoxBg || 'solid',
    worldVisitCount,
    shareLinks: shareLinks.map(s => ({ id: s.id, type: s.type, vrchatId: s.vrchatId, url: `${config.siteUrl}/s/${s.code}`, revoked: !!s.revokedAt, expiresAt: s.expiresAt, createdAt: s.createdAt })),
    shareableFavorites,
    favoriteCount: allFavorites.length,
    byType,
    byCollection: Object.entries(byCollection).sort((a, b) => b[1] - a[1]),
    favType,
    favPage,
    favTypeCount,
    favTotalPages: Math.max(1, Math.ceil(favTypeCount / FAV_PAGE_SIZE)),
    favoritePage,
  })
}))

router.post('/dashboard/devices/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  await Device.destroy({ where: { id: req.params.id, userId: req.user.id } })
  res.redirect('/dashboard')
}))

const OVERLAY_STYLES = ['default', 'bash', 'discord', 'macos', 'windows', 'soundcloud', 'youtube']
const OVERLAY_BOX_BGS = ['solid', 'thin', 'hidden']
router.post('/dashboard/overlay-settings', requireAuth, asyncHandler(async (req, res) => {
  const style = OVERLAY_STYLES.includes(req.body && req.body.style) ? req.body.style : 'default'
  const boxBg = OVERLAY_BOX_BGS.includes(req.body && req.body.boxBg) ? req.body.boxBg : 'solid'
  await req.user.update({ overlayStyle: style, overlayBoxBg: boxBg })
  res.redirect('/dashboard#overlay')
}))

// Turns an already-favorited world/avatar into a share link — same mechanism the app's own
// /api/share uses, just reachable from the website with your login session instead of a device
// token. Seeds the public Entity cache from the Favorite's own name/image if nothing's cached
// yet, so the share page has something to show even if this exact item was never independently
// viewed/cached through the app.
router.post('/dashboard/share', requireAuth, asyncHandler(async (req, res) => {
  const { type, vrchatId } = req.body || {}
  if (!['world', 'avatar'].includes(type) || !vrchatId) return res.redirect('/dashboard#share')
  const favorite = await Favorite.findOne({ where: { userId: req.user.id, type, vrchatId } })
  if (!favorite) return res.redirect('/dashboard#share')

  const existingEntity = await Entity.findOne({ where: { type, vrchatId } })
  if (!existingEntity) {
    await Entity.create({ type, vrchatId, name: favorite.displayName, imageUrl: favorite.imageUrl, visibility: 'unknown' })
  }

  await ShareLink.create({ code: generateShareCode(), type, vrchatId, createdByUserId: req.user.id })
  res.redirect('/dashboard#share')
}))

router.post('/dashboard/share/:id/revoke', requireAuth, asyncHandler(async (req, res) => {
  const link = await ShareLink.findOne({ where: { id: req.params.id, createdByUserId: req.user.id } })
  if (link) await link.update({ revokedAt: new Date() })
  res.redirect('/dashboard#share')
}))

// Self-service GDPR erasure (see PRIVACY.md §4) — requires typing DELETE to guard against a
// stray click/CSRF, and refuses an owner account outright rather than silently leaving the
// server without one; an owner has to hand ownership to someone else first.
router.post('/dashboard/delete-account', requireAuth, asyncHandler(async (req, res) => {
  if ((req.body && req.body.confirm) !== 'DELETE') {
    return res.render('dashboard-delete', { title: 'Delete account — KitsuNexus', error: 'Type DELETE exactly to confirm.' })
  }
  if (req.user.role === 'owner') {
    return res.render('dashboard-delete', { title: 'Delete account — KitsuNexus', error: 'An owner account can\'t self-delete — promote another account to owner first, or ask that owner to remove you via /admin.' })
  }
  await eraseUserData(req.user.id)
  session.clearCookie(res)
  res.redirect('/')
}))
router.get('/dashboard/delete-account', requireAuth, (req, res) => {
  res.render('dashboard-delete', { title: 'Delete account — KitsuNexus', error: null })
})

module.exports = router

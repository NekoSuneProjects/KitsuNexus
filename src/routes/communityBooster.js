'use strict'

const express = require('express')
const { DiscordLink } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')
const { catalogue, entitlementForLink } = require('../services/communityBooster')

const router = express.Router()

router.get('/api/community-booster/catalog', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json({ ok: true, catalogue })
})

router.get('/api/community-booster/me', asyncHandler(requireDeviceToken), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store')
  const link = await DiscordLink.findOne({ where: { userId: req.userId } })
  try {
    return res.json({ ok: true, ...await entitlementForLink(link) })
  } catch (err) {
    console.warn('[community-booster] Discord lookup failed:', err.message)
    return res.status(503).json({ ok: false, error: 'Could not verify Discord booster status' })
  }
}))

module.exports = router

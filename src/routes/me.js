const express = require('express')
const { User } = require('../db')
const requireDeviceToken = require('../middleware/requireDeviceToken')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()
router.use('/api/me', asyncHandler(requireDeviceToken))

// A paired device asking "who am I paired to, and what's their role?" — used by the desktop
// app to decide whether account-gated app features (e.g. VRC+-only Local Favorites) apply,
// without ever asking VRChat itself (this is a KitsuNexus account, unrelated to VRChat's own
// VRC+ subscription check the app does separately).
router.get('/api/me', asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.userId)
  if (!user) return res.status(404).json({ ok: false, error: 'Account not found' })
  res.json({ ok: true, role: user.role, displayName: user.displayName, isStub: user.isStub })
}))

module.exports = router

const { Device } = require('../db')
const { hashToken } = require('../auth/deviceToken')

// Authenticates API calls coming from a paired KitsuNexus install (Authorization: Bearer <token>).
// This is separate from website session auth (requireAuth.js, added with the real accounts
// system) — a device token only ever grants access to that device's own user's data.
module.exports = async function requireDeviceToken (req, res, next) {
  const header = req.get('authorization') || ''
  const match = /^Bearer (.+)$/i.exec(header)
  if (!match) return res.status(401).json({ ok: false, error: 'Missing device token' })
  const device = await Device.findOne({ where: { tokenHash: hashToken(match[1]), status: 'paired' } })
  if (!device) return res.status(401).json({ ok: false, error: 'Invalid or revoked device token' })
  device.lastSeenAt = new Date()
  await device.save()
  req.device = device
  req.userId = device.userId
  next()
}

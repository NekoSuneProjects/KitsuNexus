const express = require('express')
const { Op } = require('sequelize')
const { Device, STUB_USER_ID } = require('../db')
const { generateToken, hashToken, generatePairingCode } = require('../auth/deviceToken')
const pendingTokens = require('../pairing/pendingTokens')
const asyncHandler = require('../utils/asyncHandler')
const requireAuth = require('../middleware/requireAuth')

const router = express.Router()
const CODE_TTL_MS = 10 * 60 * 1000

// Desktop app: "I'd like to pair — give me a code to show the user."
router.post('/api/pairing/start', asyncHandler(async (req, res) => {
  const name = (req.body && req.body.name) || 'KitsuNexus Desktop'
  const token = generateToken()
  const device = await Device.create({
    userId: STUB_USER_ID, // placeholder — reassigned to the real logged-in user in POST /pair below
    name,
    status: 'pending',
    pairingCode: generatePairingCode(),
    pairingCodeExpiresAt: new Date(Date.now() + CODE_TTL_MS),
    tokenHash: hashToken(token),
  })
  pendingTokens.put(device.id, token)
  res.json({ ok: true, deviceId: device.id, code: device.pairingCode, expiresAt: device.pairingCodeExpiresAt })
}))

// Desktop app polls this until the user enters the code on the website.
router.get('/api/pairing/poll/:deviceId', asyncHandler(async (req, res) => {
  const device = await Device.findByPk(req.params.deviceId)
  if (!device) return res.status(404).json({ ok: false, error: 'Unknown device' })
  if (device.status === 'paired') {
    return res.json({ ok: true, paired: true, token: pendingTokens.take(device.id) })
  }
  if (device.pairingCodeExpiresAt && device.pairingCodeExpiresAt < new Date()) {
    return res.json({ ok: true, paired: false, expired: true })
  }
  res.json({ ok: true, paired: false })
}))

// Website: enter-code page + form submit. Requires being logged in as the account you want
// the device attached to (closes the earlier gap where anyone could claim a pending code).
router.get('/pair', requireAuth, (req, res) => {
  res.render('pair', { title: 'Connect a device — KitsuNexus', result: null })
})
router.post('/pair', requireAuth, asyncHandler(async (req, res) => {
  const code = String((req.body && req.body.code) || '').trim().toUpperCase()
  const device = await Device.findOne({ where: { pairingCode: code, status: 'pending', pairingCodeExpiresAt: { [Op.gt]: new Date() } } })
  if (!device) return res.render('pair', { title: 'Connect a device — KitsuNexus', result: { ok: false, message: 'That code is invalid or has expired. Generate a new one from the app and try again.' } })
  device.userId = req.user.id
  device.status = 'paired'
  device.pairingCode = null
  device.pairingCodeExpiresAt = null
  device.lastSeenAt = new Date()
  await device.save()
  res.render('pair', { title: 'Connect a device — KitsuNexus', result: { ok: true, message: `"${device.name}" is now connected to your account.` } })
}))

module.exports = router

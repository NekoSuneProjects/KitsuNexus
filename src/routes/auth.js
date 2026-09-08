const express = require('express')
const bcrypt = require('bcryptjs')
const { User, Device, Favorite, STUB_USER_ID } = require('../db')
const session = require('../auth/session')
const asyncHandler = require('../utils/asyncHandler')

const router = express.Router()

async function ownerExists () { return !!(await User.findOne({ where: { role: 'owner' } })) }

// First-run wizard — creates the single Owner account. Locked once an owner exists; public
// registration (role: 'user') is a separate, later step (see TODO.md).
router.get('/setup', asyncHandler(async (req, res) => {
  if (await ownerExists()) return res.redirect('/login')
  res.render('setup', { title: 'First-time setup — KitsuNexus', error: null })
}))

router.post('/setup', asyncHandler(async (req, res) => {
  if (await ownerExists()) return res.redirect('/login')
  const { email, password, confirmPassword, displayName } = req.body || {}
  const fail = msg => res.render('setup', { title: 'First-time setup — KitsuNexus', error: msg })
  if (!email || !password) return fail('Email and password are required.')
  if (password.length < 8) return fail('Password must be at least 8 characters.')
  if (password !== confirmPassword) return fail('Passwords do not match.')

  const passwordHash = await bcrypt.hash(password, 12)
  const owner = await User.create({ email: String(email).trim().toLowerCase(), passwordHash, displayName: displayName || 'Owner', role: 'owner', isStub: false })

  // Anything paired/favorited before the owner existed was attached to the stub account —
  // hand it all over now instead of losing it.
  await Device.update({ userId: owner.id }, { where: { userId: STUB_USER_ID } })
  await Favorite.update({ userId: owner.id }, { where: { userId: STUB_USER_ID } })

  session.setCookie(res, session.sign(owner))
  res.redirect('/dashboard')
}))

router.get('/login', asyncHandler(async (req, res) => {
  if (!await ownerExists()) return res.redirect('/setup')
  res.render('login', { title: 'Log in — KitsuNexus', error: null })
}))

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {}
  const user = await User.findOne({ where: { email: String(email || '').trim().toLowerCase() } })
  const valid = user && user.passwordHash && await bcrypt.compare(password || '', user.passwordHash)
  if (!valid) return res.render('login', { title: 'Log in — KitsuNexus', error: 'Incorrect email or password.' })
  session.setCookie(res, session.sign(user))
  res.redirect('/dashboard')
}))

router.get('/logout', (req, res) => { session.clearCookie(res); res.redirect('/') })

module.exports = router

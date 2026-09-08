const jwt = require('jsonwebtoken')
const config = require('../config')

const COOKIE_NAME = 'kn_session'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function sign (user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '30d' })
}

function verify (token) {
  try { return jwt.verify(token, config.jwtSecret) } catch (_) { return null }
}

function setCookie (res, token) {
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_MS, secure: isSiteHttps() })
}
// SITE_URL should be set to https://kitsunexus.nekosunevr.co.uk once deployed there — this
// makes the session cookie "secure" (https-only) automatically at that point.
function isSiteHttps () { return config.siteUrl.startsWith('https://') }

function clearCookie (res) { res.clearCookie(COOKIE_NAME) }

module.exports = { COOKIE_NAME, sign, verify, setCookie, clearCookie }

const { User } = require('../db')
const session = require('../auth/session')
const asyncHandler = require('../utils/asyncHandler')

// Website session auth (cookie), for page routes like /dashboard and /pair — distinct from
// requireDeviceToken.js, which authenticates the desktop app's own API calls.
module.exports = asyncHandler(async function requireAuth (req, res, next) {
  const token = req.cookies && req.cookies[session.COOKIE_NAME]
  const payload = token && session.verify(token)
  if (!payload) return res.redirect('/login')
  const user = await User.findByPk(payload.sub)
  if (!user) { session.clearCookie(res); return res.redirect('/login') }
  req.user = user
  next()
})

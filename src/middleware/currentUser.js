const { User } = require('../db')
const session = require('../auth/session')

// Soft auth check (no redirect) so every page — not just requireAuth-gated ones — can show
// "Log in" vs. "Dashboard / Log out" in the nav. Runs before every request; keep it cheap.
module.exports = async function currentUser (req, res, next) {
  res.locals.currentUser = null
  const token = req.cookies && req.cookies[session.COOKIE_NAME]
  const payload = token && session.verify(token)
  if (payload) {
    const user = await User.findByPk(payload.sub)
    if (user) res.locals.currentUser = user
  }
  next()
}

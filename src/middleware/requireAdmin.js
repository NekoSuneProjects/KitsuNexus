const requireAuth = require('./requireAuth')

const ADMIN_ROLES = new Set(['owner', 'admin'])

// Gates /admin — server-operator stuff (all users, aggregate stats) that a regular account
// should never see. Only the Owner qualifies today; 'admin' is here so a future "promote this
// user to admin" feature doesn't need another gate rewritten.
function requireAdmin (req, res, next) {
  if (!ADMIN_ROLES.has(req.user.role)) return res.status(403).render('403', { title: 'Forbidden — KitsuNexus' })
  next()
}

module.exports = [requireAuth, requireAdmin]

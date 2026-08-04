const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config')

// Verifies `Authorization: Bearer <session JWT>`, attaches req.discordUserId.
// This JWT identifies the caller only (scope: identify) — it is never the bot
// token and grants no Discord permissions by itself.
module.exports = function requireAuth (req, res, next) {
  const header = req.get('authorization') || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }
  try {
    const payload = jwt.verify(token, jwtSecret)
    req.discordUserId = payload.sub
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session token' })
  }
}

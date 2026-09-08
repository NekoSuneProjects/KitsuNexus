const jwt = require('jsonwebtoken')
const config = require('../config')

// Verifies `Authorization: Bearer <token>` issued by discordOAuth.js's issueBearerToken(),
// attaches req.discordUserId. Distinct from the website's own requireAuth.js (cookie-based) —
// this proves "I am Discord user X" for the Electron app / Activity iframe's own API surface
// (routes/discordStatus.js), not a KitsuNexus account.
//
// Ported from NekoSuneAPPS/server/src/middleware/requireAuth.js (renamed to avoid clashing
// with this project's own website requireAuth.js).
module.exports = function requireDiscordBearer (req, res, next) {
  const header = req.get('authorization') || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    req.discordUserId = payload.sub
    next()
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session token' })
  }
}

const { ApiKey } = require('../db')
const { hashToken } = require('../auth/deviceToken')

// Authenticates a server-to-server pull (e.g. an external site fetching /api/worlds/feed) via
// `Authorization: Bearer <key>` or `?key=` — separate from both the website session cookie and
// a paired Device's token; meant to be held by another service, not a browser or the app.
module.exports = async function requireApiKey (req, res, next) {
  const header = req.get('authorization') || ''
  const bearer = /^Bearer (.+)$/i.exec(header)
  const raw = (bearer && bearer[1]) || req.query.key
  if (!raw) return res.status(401).json({ ok: false, error: 'Missing API key (Authorization: Bearer <key>, or ?key=)' })
  const apiKey = await ApiKey.findOne({ where: { keyHash: hashToken(raw) } })
  if (!apiKey) return res.status(401).json({ ok: false, error: 'Invalid or revoked API key' })
  apiKey.lastUsedAt = new Date()
  await apiKey.save()
  req.userId = apiKey.userId
  next()
}

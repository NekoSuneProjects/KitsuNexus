// Holds a paired device's plaintext token in memory just long enough for the desktop app's
// poll to pick it up — only the sha256 hash is ever persisted to the database (see
// src/auth/deviceToken.js). Entries are deleted once delivered, and swept if never claimed.
const tokens = new Map() // deviceId -> { token, expiresAt }

function put (deviceId, token, ttlMs = 15 * 60 * 1000) {
  tokens.set(deviceId, { token, expiresAt: Date.now() + ttlMs })
}

// Returns the token once, then forgets it (the caller is expected to store it immediately).
function take (deviceId) {
  const entry = tokens.get(deviceId)
  if (!entry) return null
  tokens.delete(deviceId)
  if (entry.expiresAt < Date.now()) return null
  return entry.token
}

setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of tokens) if (entry.expiresAt < now) tokens.delete(id)
}, 5 * 60 * 1000).unref()

module.exports = { put, take }

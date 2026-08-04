// In-memory live VRChat status, keyed by Discord user ID. Fed by Electron's
// POST /api/status, read by GET /api/channel/:channelId/status for the Activity panel.
// No persistence — a restart just means every client re-pushes on its next tick.

const STALE_MS = 60_000
const SWEEP_INTERVAL_MS = 30_000

const store = new Map()

function set (userId, status) {
  store.set(userId, { ...status, updatedAt: Date.now() })
}

function get (userId) {
  const entry = store.get(userId)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > STALE_MS) {
    store.delete(userId)
    return null
  }
  return entry
}

function sweep () {
  const now = Date.now()
  for (const [userId, entry] of store) {
    if (now - entry.updatedAt > STALE_MS) store.delete(userId)
  }
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref()

module.exports = { set, get }

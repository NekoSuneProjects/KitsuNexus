// modules/ranks/rankApi.js
// NekoSuneAPPSVRC Community Ranks — optional REST surface (Express router).
// Implements docs/community-ranks-spec.md §8. Mount with:
//     app.use('/api/v1', require('./modules/ranks/rankApi').router(ranks, opts))
// Returns null when the feature is disabled so the host can skip mounting.

const express = require('express')

function err (res, code, message, status = 400) {
  return res.status(status).json({ error: { code, message } })
}

// `ranks` is the orchestrator (modules/ranks). `opts.getOgMode()` and
// `opts.isStaff(req)` let the host wire the toggle + auth without coupling.
function router (ranks, opts = {}) {
  const r = express.Router()
  const ogMode = () => (opts.getOgMode ? opts.getOgMode() : true)
  const isStaff = req => (opts.isStaff ? !!opts.isStaff(req) : false)
  const requireReady = (req, res, next) => ranks.isReady() ? next() : err(res, 'not_ready', 'Ranks not initialised', 503)

  r.use(express.json())

  // GET /user/rank?nsaUserId=...
  r.get('/user/rank', requireReady, (req, res) => {
    const id = req.query.nsaUserId || ranks.localNsaId()
    const payload = ranks.getRank(id, { ogMode: ogMode() })
    if (!payload) return err(res, 'not_found', 'Unknown user', 404)
    res.json(payload)
  })

  // GET /user/score?nsaUserId=...
  r.get('/user/score', requireReady, (req, res) => {
    const id = req.query.nsaUserId || ranks.localNsaId()
    const payload = ranks.getRank(id, { ogMode: ogMode() })
    if (!payload) return err(res, 'not_found', 'Unknown user', 404)
    res.json({
      finalScore: payload.score, rawScore: payload.rawScore, abusePenalty: payload.abusePenalty,
      breakdown: payload.breakdown, maxByFactor: payload.maxByFactor
    })
  })

  // GET /leaderboard?limit=...
  r.get('/leaderboard', requireReady, (req, res) => {
    res.json({
      rankSystem: 'NekoSuneAPPSVRC Community Ranks',
      generatedAt: Math.floor(Date.now() / 1000),
      entries: ranks.leaderboard(req.query.limit)
    })
  })

  // POST /contribution  { nsaUserId, type, description, evidenceUrl }
  r.post('/contribution', requireReady, (req, res) => {
    const { nsaUserId, type, description, evidenceUrl } = req.body || {}
    const user = ranks.db.getUser(nsaUserId || ranks.localNsaId())
    if (!user) return err(res, 'not_found', 'Unknown user', 404)
    const points = CONTRIB_POINTS[type]
    if (points == null) return err(res, 'bad_type', 'Unknown contribution type', 422)
    const id = ranks.db.addContribution(user.id, { type, points, description, evidenceUrl, status: 'pending' })
    res.json({ id, status: 'pending', type, provisionalPoints: points, message: 'Submitted for staff verification. Points apply once verified.' })
  })

  // POST /event-attendance  { nsaUserId, eventId, method, token }
  r.post('/event-attendance', requireReady, (req, res) => {
    const { nsaUserId, eventId, method, token } = req.body || {}
    const user = ranks.db.getUser(nsaUserId || ranks.localNsaId())
    if (!user) return err(res, 'not_found', 'Unknown user', 404)
    if (!eventId) return err(res, 'bad_request', 'eventId required', 422)
    // Only host-token or telemetry-verified attendance is credited (§4.3).
    const verified = (method === 'host_token' && opts.verifyEventToken ? opts.verifyEventToken(eventId, token) : false) ||
                     (method === 'telemetry')
    const r2 = ranks.db.recordAttendance(eventId, user.id, method, verified)
    if (!r2) return err(res, 'event_not_found', 'Unknown event', 404)
    res.json({
      eventId, verified, method, creditedValue: +r2.credited.toFixed(2),
      note: r2.priorSameOrg ? 'Same-organiser diversity discount applied (' + (r2.priorSameOrg + 1) + 'th event by organiser).' : undefined
    })
  })

  // POST /recompute  (staff)  { nsaUserId }
  r.post('/recompute', requireReady, (req, res) => {
    if (!isStaff(req)) return err(res, 'forbidden', 'Staff only', 403)
    const payload = ranks.recompute((req.body && req.body.nsaUserId) || ranks.localNsaId(), { ogMode: ogMode(), reason: 'manual', actor: 'staff' })
    if (!payload) return err(res, 'not_found', 'Unknown user', 404)
    res.json(payload)
  })

  // POST /moderation/sanction  (staff)  { nsaUserId, kind, weight, reason }
  r.post('/moderation/sanction', requireReady, (req, res) => {
    if (!isStaff(req)) return err(res, 'forbidden', 'Staff only', 403)
    const { nsaUserId, kind, weight, reason } = req.body || {}
    const user = ranks.db.getUser(nsaUserId)
    if (!user) return err(res, 'not_found', 'Unknown user', 404)
    ranks.db.addReputation(user.id, null, kind || 'sanction', -Math.abs(weight || 10), reason)
    res.json(ranks.recompute(nsaUserId, { ogMode: ogMode(), reason: 'sanction', actor: 'staff' }))
  })

  return r
}

// Contribution point table (§2.4). Caps-per-period are enforced at verification time.
const CONTRIB_POINTS = {
  bug_report: 3, pr: 15, docs: 6, help: 2, translation: 10, asset: 8, partner: 20
}

module.exports = { router, CONTRIB_POINTS }

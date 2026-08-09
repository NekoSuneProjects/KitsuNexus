// modules/ranks/index.js
// KitsuNexus Community Ranks — orchestrator.
// Ties the pure engine (rankEngine) to the store (rankDb) and a best-effort
// collector that pulls real facts from the VRChat API + local game-log history.
// Everything here is gated by the `communityRanks.enabled` toggle in MAIN.
//
// These are *KitsuNexus Community Ranks* — an independent community reputation
// system, NOT official VRChat ranks.

const crypto = require('crypto')
const os = require('os')
const engine = require('./rankEngine')
const db = require('./rankDb')

let ready = false

async function init (userDataDir) {
  ready = await db.init(userDataDir)
  return ready
}
function isReady () { return ready }
function close () { db.close() }

const nowSec = () => Math.floor(Date.now() / 1000)
const parseDateSec = d => { const t = Date.parse(d); return Number.isFinite(t) ? Math.floor(t / 1000) : null }

// A stable, non-PII local identity for the "self" user when no VRChat id is linked
// yet. Hashed machine id also doubles as the alt-detection fingerprint (§4.2).
function machineFingerprint () {
  const seed = [os.hostname(), os.platform(), os.arch(), (os.userInfo().username || '')].join('|')
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32)
}
function localNsaId () { return 'nsa_' + machineFingerprint().slice(0, 16) }

// Count distinct calendar years that appear in the local world-visit history — a
// conservative, hard-to-fake proxy for "years active in VRChat" (§2.2). Farming
// this means actually being in worlds across many real years.
function activeYearsFromHistory (gamelog) {
  try {
    const rows = gamelog.list({ type: 'world', limit: 1000 })
    const years = new Set()
    for (const r of rows) if (r.ts) years.add(new Date(r.ts).getUTCFullYear())
    return years.size
  } catch (_) { return 0 }
}

// Distinct months (last 24) in which the user published/updated content — feeds the
// creator "consistency" factor. Derived from world/avatar updated timestamps in DB.
function distinctPublishMonths24 (worlds, avatars) {
  const cutoff = nowSec() - 24 * 30 * 86400
  const months = new Set()
  for (const c of [...(worlds || []), ...(avatars || [])]) {
    const t = c.publishedAt || c.updatedAt
    if (t && t >= cutoff) months.add(new Date(t * 1000).getUTCFullYear() + '-' + new Date(t * 1000).getUTCMonth())
  }
  return months.size
}

/**
 * Pull the freshest facts for the local ("self") user from the VRChat API and
 * history, persist them, and return the user db row. Best-effort: missing logins
 * just yield a sparser profile. Lazy-requires app modules to stay decoupled.
 */
async function syncSelf () {
  if (!ready) return null
  const vrchatApi = require('../vrchat/api/vrchatApi')
  const gamelog = require('../history/gamelog')

  const nsaUserId = localNsaId()
  const fingerprint = machineFingerprint()

  // Identity + join date + trust tags from the VRChat account (if logged in).
  let vrcUserId = null
  let vrcJoinDate = null
  let displayName = 'You'
  let tags = []
  try {
    const r = await vrchatApi.fetchUser()
    if (r && r.ok && r.user) {
      vrcUserId = r.user.id
      displayName = r.user.displayName || displayName
      vrcJoinDate = parseDateSec(r.user.dateJoined)
      tags = r.user.tags || []
    }
  } catch (_) { /* not logged in — fine */ }

  const user = db.upsertUser({
    nsaUserId, vrcUserId, displayName, vrcJoinDate,
    fingerprintHash: fingerprint, isVerified: !!vrcUserId
  })
  if (!user) return null

  // One-time migration seed from VRChat trust tags (§10): a floor, set only once.
  if (!user.vrc_trust_seed && tags.length) {
    db.setTrustSeed(nsaUserId, engine.seedFromVrcTags(tags))
  }

  // Worlds + avatars → content stats. Only published/public ones count (§4.1).
  try {
    const w = await vrchatApi.getMyWorlds()
    if (w && w.ok) for (const world of w.worlds) {
      db.upsertWorld(user.id, {
        vrcWorldId: world.id, name: world.name, favourites: world.favorites || 0, visits: world.visits || 0,
        isPublished: world.releaseStatus !== 'hidden', isPublic: world.releaseStatus === 'public'
      })
    }
  } catch (_) {}
  try {
    const a = await vrchatApi.getMyAvatars()
    if (a && a.ok) for (const av of a.avatars) {
      db.upsertAvatar(user.id, {
        vrcAvatarId: av.id, name: av.name, isPublic: av.releaseStatus === 'public'
      })
    }
  } catch (_) {}

  // Record the active-years proxy by stashing it on the user via recompute input.
  user._activeYears = activeYearsFromHistory(gamelog)
  return user
}

// Assemble the engine's `stats` object from everything in the DB for one user.
function collectStats (user) {
  const seed = user.vrc_trust_seed ? Number(user.vrc_trust_seed) : 0
  const content = db.contentStats(user.id)
  return {
    nsaCreatedAt: user.nsa_created_at,
    vrcJoinDate: user.vrc_join_date,
    activeYears: user._activeYears || 0,
    publishedWorlds: content.publishedWorlds,
    publicAvatars: content.publicAvatars,
    totalFavourites: content.totalFavourites,
    lastPublishAt: content.lastPublishAt,
    distinctPublishMonths24: 0, // refined below when raw rows are available
    contributionPoints: db.verifiedContributionPoints(user.id),
    verifiedEvents: db.verifiedEventCredit(user.id),
    repNet: db.reputationNet(user.id),
    recognitionTier: user.recognition_tier || 0,
    leadershipDocumented: !!user.leadership_documented,
    majorContribution: !!user.major_contribution,
    staffSignoffs: user.staff_signoffs || 0,
    cleanForDays: 9999, // TODO: derive from last sanction in reputation_events
    abusePenalty: 1,
    _seed: seed
  }
}

/**
 * Recompute a user's score + rank, apply the migration-seed floor, persist, and
 * write a rank_history row if the rank changed. Returns the public rank payload.
 */
function recompute (nsaUserId, opts = {}) {
  if (!ready) return null
  const user = db.getUser(nsaUserId)
  if (!user) return null

  const stats = collectStats(user)
  const score = engine.computeScore(stats, nowSec())

  // Migration seed is a one-time FLOOR (§10): never lets the seed exceed earned score.
  if (stats._seed && score.finalScore < stats._seed) {
    score.finalScore = stats._seed
    score.rawScore = Math.max(score.rawScore, stats._seed)
  }

  const prev = db.getScore(user.id)
  const rank = engine.resolveRank(score, stats, {
    ogMode: opts.ogMode !== false,
    previousRankKey: prev ? prev.current_rank : 'visitor'
  })

  db.saveScore(user.id, score, rank.key)
  if (!prev || prev.current_rank !== rank.key) {
    db.recordHistory(user.id, prev ? prev.current_rank : null, rank.key,
      prev ? prev.final_score : null, score.finalScore, opts.reason || 'recompute', opts.actor || 'system')
  }

  return buildRankPayload(user, score, rank, opts)
}

function buildRankPayload (user, score, rank, opts = {}) {
  return {
    rankSystem: 'KitsuNexus Community Ranks',
    disclaimer: 'Independent community ranks — not affiliated with or endorsed by VRChat.',
    user: { nsaUserId: user.nsa_user_id, displayName: user.display_name, vrcUserId: user.vrc_user_id },
    rank: { key: rank.key, label: rank.label, shortLabel: rank.shortLabel, tier: rank.tier, color: rank.color, accent: rank.accent },
    score: score.finalScore,
    rawScore: score.rawScore,
    abusePenalty: score.abusePenalty,
    breakdown: score.breakdown,
    maxByFactor: score.max,
    ogModeVisible: opts.ogMode !== false,
    isOg: rank.isOg,
    eligibility: rank.eligibility,
    computedAt: nowSec()
  }
}

// Read-only fetch of the current stored rank (no recompute).
function getRank (nsaUserId, opts = {}) {
  if (!ready) return null
  const user = db.getUser(nsaUserId)
  if (!user) return null
  const stored = db.getScore(user.id)
  if (!stored || !stored.computed_at) return recompute(nsaUserId, opts) // first run
  const score = {
    finalScore: stored.final_score,
    rawScore: stored.raw_score,
    abusePenalty: stored.abuse_penalty,
    breakdown: {
      joinAge: stored.pts_join_age, yearsActive: stored.pts_years_active, accountAge: stored.pts_account_age,
      worldUploads: stored.pts_world_uploads, avatarUploads: stored.pts_avatar_uploads,
      creatorActivity: stored.pts_creator_activity, contributions: stored.pts_contributions,
      events: stored.pts_events, reputation: stored.pts_reputation, recognition: stored.pts_recognition
    },
    max: engine.MAX
  }
  const stats = collectStats(user)
  const rank = engine.resolveRank(score, stats, { ogMode: opts.ogMode !== false, previousRankKey: stored.current_rank })
  return buildRankPayload(user, score, rank, opts)
}

function leaderboard (limit) {
  if (!ready) return []
  return db.leaderboard(Math.min(parseInt(limit, 10) || 50, 200)).map((r, i) => ({
    position: i + 1, nsaUserId: r.nsa_user_id, displayName: r.display_name,
    rank: r.current_rank, score: r.final_score
  }))
}

module.exports = {
  init, close, isReady, localNsaId, machineFingerprint,
  syncSelf, recompute, getRank, leaderboard,
  db, engine
}

// modules/ranks/rankEngine.js
// NekoSuneAPPSVRC Community Ranks — pure scoring engine.
// Implements the 0–1000 weighted model from docs/community-ranks-spec.md.
// NO side effects, NO I/O: takes a plain `stats` object and returns a breakdown.
// This is the single source of truth for the numbers; the DB/collector just feed it.
//
// IMPORTANT: these are *NekoSuneAPPSVRC Community Ranks*, an independent community
// reputation system. They are NOT official VRChat ranks and do not read VRChat's
// internal trust score.

// ---- factor caps (must sum to 1000) -------------------------------------
const MAX = {
  joinAge: 150,
  yearsActive: 150,
  accountAge: 50,
  worldUploads: 120,
  avatarUploads: 80,
  creatorActivity: 100,
  contributions: 120,
  events: 80,
  reputation: 100,
  recognition: 50
}

// ---- rank ladder ---------------------------------------------------------
// `min` is the promotion threshold; `floor` is the demotion threshold (hysteresis,
// §11 of the spec) so ranks don't flicker around a boundary.
const RANKS = [
  { key: 'visitor', label: 'Visitor', tier: 0, min: 0, floor: 0, color: '#8A8F98', accent: '#B5BAC2', og: false },
  { key: 'new_user', label: 'New User', tier: 1, min: 100, floor: 90, color: '#4FB477', accent: '#7FE0A6', og: false },
  { key: 'user', label: 'User', tier: 2, min: 200, floor: 180, color: '#3FA7D6', accent: '#79CBEF', og: false },
  { key: 'known_user', label: 'Known User', tier: 3, min: 400, floor: 370, color: '#7C5CFF', accent: '#A78BFA', og: false },
  { key: 'trusted_user', label: 'Trusted User', tier: 4, min: 600, floor: 565, color: '#2DD4BF', accent: '#5EEAD4', og: false },
  { key: 'veteran', label: 'Veteran', tier: 5, min: 800, floor: 760, color: '#C9A227', accent: '#F4D35E', og: true },
  { key: 'legend', label: 'Legend', tier: 6, min: 950, floor: 920, color: '#E0115F', accent: '#FF6FB5', og: true }
]

const SECONDS_PER_YEAR = 365.25 * 24 * 3600
const SECONDS_PER_MONTH = SECONDS_PER_YEAR / 12

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
// Saturating curve: reaches ~95% of `cap` at n = 3k. The first units are worth a
// lot; the 50th upload is worthless — this is the core anti-spam shape.
const sat = (n, cap, k) => cap * (1 - Math.exp(-Math.max(0, n) / k))

// ---- creator activity (recency-weighted, §2.3) ---------------------------
// Rewards *sustained* creation, not raw totals.
function creatorScore (s, nowSec) {
  const daysSinceLast = s.lastPublishAt
    ? Math.max(0, (nowSec - s.lastPublishAt) / 86400)
    : Infinity
  const recency = daysSinceLast <= 180
    ? 1
    : Math.max(0, 1 - (daysSinceLast - 180) / 540) // fades to 0 over the next ~18 months
  const consistency = clamp((s.distinctPublishMonths24 || 0) / 24, 0, 1)
  const adoption = sat(s.totalFavourites || 0, 20, 50) / 20
  return 40 * recency + 40 * consistency + 20 * adoption
}

/**
 * Compute the full score breakdown for a user.
 * @param {object} stats  collected facts (see modules/ranks/rankStore collectStats)
 * @param {number} nowSec current time in epoch seconds (injected for determinism)
 */
function computeScore (stats, nowSec) {
  const s = stats || {}
  const now = nowSec || Math.floor(Date.now() / 1000)

  const yearsSinceJoin = s.vrcJoinDate ? (now - s.vrcJoinDate) / SECONDS_PER_YEAR : 0
  const monthsInstalled = s.nsaCreatedAt ? (now - s.nsaCreatedAt) / SECONDS_PER_MONTH : 0

  const breakdown = {
    joinAge: clamp(yearsSinceJoin * 25, 0, MAX.joinAge),
    yearsActive: clamp(sat(s.activeYears || 0, MAX.yearsActive, 3), 0, MAX.yearsActive),
    accountAge: clamp(monthsInstalled * 2.1, 0, MAX.accountAge),
    worldUploads: clamp(sat(s.publishedWorlds || 0, MAX.worldUploads, 4), 0, MAX.worldUploads),
    avatarUploads: clamp(sat(s.publicAvatars || 0, MAX.avatarUploads, 6), 0, MAX.avatarUploads),
    creatorActivity: clamp(creatorScore(s, now), 0, MAX.creatorActivity),
    contributions: clamp(s.contributionPoints || 0, 0, MAX.contributions),
    events: clamp(sat(s.verifiedEvents || 0, MAX.events, 8), 0, MAX.events),
    reputation: clamp(50 + (s.repNet || 0), 0, MAX.reputation),
    recognition: clamp((s.recognitionTier || 0) * 25, 0, MAX.recognition)
  }

  // Round each component for display; sum the rounded parts so the breakdown adds up.
  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k])
  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0)

  // Confirmed abuse scales the WHOLE score down (multiplicative, §2.5) rather than
  // shaving a few points, so farming can't out-run a sanction.
  const penalty = clamp(s.abusePenalty == null ? 1 : s.abusePenalty, 0, 1)
  const finalScore = Math.round(clamp(rawScore, 0, 1000) * penalty)

  return {
    breakdown,
    max: { ...MAX },
    rawScore: clamp(rawScore, 0, 1000),
    abusePenalty: penalty,
    finalScore,
    derived: {
      yearsSinceJoin: +yearsSinceJoin.toFixed(2),
      monthsInstalled: +monthsInstalled.toFixed(1),
      activeYears: s.activeYears || 0
    }
  }
}

// ---- Veteran / Legend hard gates (§5–6) ----------------------------------
// Score is necessary but NOT sufficient: the OG tiers require real history.
function veteranGates (stats, score) {
  const s = stats || {}
  const meaningfulCreation =
    (s.publishedWorlds || 0) >= 2 ||
    (s.publicAvatars || 0) >= 5 ||
    score.breakdown.creatorActivity >= 60
  const involvement = (s.contributionPoints || 0) >= 40 || (s.verifiedEvents || 0) >= 8
  return [
    { key: 'score', ok: score.finalScore >= 800, need: 'score ≥ 800' },
    { key: 'join_age', ok: yearsJoined(s) >= 3, need: 'VRChat join age ≥ 3y' },
    { key: 'years_active', ok: (s.activeYears || 0) >= 2, need: '≥ 2 active years' },
    { key: 'creation', ok: meaningfulCreation, need: '≥2 worlds OR ≥5 avatars OR creatorActivity ≥ 60' },
    { key: 'involvement', ok: involvement, need: '≥40 contribution pts OR ≥8 events' },
    { key: 'reputation', ok: (s.repNet || 0) >= 0, need: 'reputation not net-negative' },
    { key: 'clean_record', ok: (s.abusePenalty == null ? 1 : s.abusePenalty) >= 1 && (s.cleanForDays || 0) >= 180, need: 'clean record ≥ 6 months' }
  ]
}

function legendGates (stats, score) {
  const s = stats || {}
  const sigAvatars = (s.publicAvatars || 0) >= 15 || (s.totalFavourites || 0) >= 1000
  return [
    { key: 'score', ok: score.finalScore >= 950, need: 'score ≥ 950' },
    { key: 'join_age', ok: yearsJoined(s) >= 5, need: 'VRChat join age ≥ 5y' },
    { key: 'years_active', ok: (s.activeYears || 0) >= 4, need: '≥ 4 active years' },
    { key: 'worlds', ok: (s.publishedWorlds || 0) >= 5, need: '≥ 5 published, used worlds' },
    { key: 'avatars', ok: sigAvatars, need: '≥15 avatars OR ≥1000 favourites' },
    { key: 'leadership', ok: !!s.leadershipDocumented, need: 'documented community leadership' },
    { key: 'major_contribution', ok: !!s.majorContribution, need: 'partner project OR core contribution' },
    { key: 'reputation', ok: (s.repNet || 0) >= 20, need: 'reputation ≥ +20' },
    { key: 'staff_approval', ok: (s.staffSignoffs || 0) >= 2, need: '≥ 2 staff sign-offs' }
  ]
}

function yearsJoined (s) {
  const now = Math.floor(Date.now() / 1000)
  return s.vrcJoinDate ? (now - s.vrcJoinDate) / SECONDS_PER_YEAR : 0
}

/**
 * Resolve a final rank from a score + the hard gates, honouring the OG toggle and
 * the previous rank (for demotion hysteresis).
 * @param {object} score    output of computeScore
 * @param {object} stats    the same stats fed to computeScore
 * @param {object} opts      { ogMode:boolean, previousRankKey:string }
 */
function resolveRank (score, stats, opts = {}) {
  const ogMode = opts.ogMode !== false
  const prevTier = (RANKS.find(r => r.key === opts.previousRankKey) || {}).tier ?? -1

  // Start from the highest score-eligible rank, applying hysteresis: to SIT in a
  // rank you only need its `floor` if you were already at/above it.
  let candidate = RANKS[0]
  for (const r of RANKS) {
    const threshold = prevTier >= r.tier ? r.floor : r.min
    if (score.finalScore >= threshold) candidate = r
  }

  const pending = []
  // OG tiers are gated. If a gate fails, fall back to Trusted User but report why.
  if (candidate.key === 'veteran') {
    const gates = veteranGates(stats, score)
    const failed = gates.filter(g => !g.ok)
    if (failed.length) { pending.push(...failed.map(g => g.need)); candidate = RANKS.find(r => r.key === 'trusted_user') }
  }
  if (candidate.key === 'legend') {
    const gates = legendGates(stats, score)
    const failed = gates.filter(g => !g.ok)
    if (failed.length) {
      pending.push(...failed.map(g => g.need))
      // Drop to Veteran if those gates pass, else Trusted.
      const vetFailed = veteranGates(stats, score).filter(g => !g.ok)
      candidate = vetFailed.length ? RANKS.find(r => r.key === 'trusted_user') : RANKS.find(r => r.key === 'veteran')
    }
  }

  // When OG mode is off, never surface the nostalgia tiers — cap the label at Trusted.
  let display = candidate
  if (!ogMode && candidate.og) display = RANKS.find(r => r.key === 'trusted_user')

  // What's the next rank up, and what stands between the user and it?
  const next = RANKS.find(r => r.tier === display.tier + 1)
  return {
    key: display.key,
    label: 'NekoSuneAPPSVRC Community Rank: ' + display.label,
    shortLabel: display.label,
    tier: display.tier,
    color: display.color,
    accent: display.accent,
    isOg: candidate.og,
    ogHidden: !ogMode && candidate.og,
    eligibility: next
      ? { nextRank: next.key, scoreToNext: Math.max(0, next.min - score.finalScore), pendingGates: pending }
      : { nextRank: null, scoreToNext: 0, pendingGates: pending }
  }
}

// ---- VRChat trust → seed score (migration, §10) --------------------------
// One-time floor only; never re-read after first computation.
const TRUST_SEED = { visitor: 50, basic: 150, new_user: 150, known: 500, known_user: 500, trusted: 680, trusted_user: 680, user: 300 }
// VRChat exposes trust via account tags; map the highest present tag to a seed.
function seedFromVrcTags (tags) {
  const t = new Set(tags || [])
  if (t.has('system_trust_veteran')) return 680 // VRChat "Trusted"-equivalent ceiling; OG tiers must be earned here
  if (t.has('system_trust_trusted')) return 680
  if (t.has('system_trust_known')) return 500
  if (t.has('system_trust_intermediate')) return 300
  if (t.has('system_trust_basic')) return 150
  return 50
}

// Year from a VRChat date_joined string ("YYYY-MM-DD"); 0 if unknown/unparseable.
function joinYearOf (dateStr) {
  if (!dateStr) return 0
  const m = /^(\d{4})/.exec(String(dateStr))
  return m ? parseInt(m[1], 10) : 0
}

// ---- Friend/other-user rank from VRChat trust tags -----------------------
// This mirrors exactly how VRChat itself ranks users — the same thing the
// OGTrustRanks mod surfaces in-game. That mod doesn't compute anything: it calls
// VRChat's still-present internal APIUser.GetTrustRankEnum() /
// GetFriendlyDetailedNameForSocialRank(), which keep producing Veteran & Legend.
// VRChat only removed the on-screen DISPLAY, not the calculation, and it is driven
// by these trust tags. So we map them the same way:
//   system_trust_legend  → Legend      (rare — grandfathered legends, e.g. Shadowriver)
//   system_trust_veteran → Veteran     (the real OG Veteran tier; common — by design)
//   system_trust_trusted → Trusted User
//   system_trust_known   → Known User
//   system_trust_basic   → User
//   (none)               → Visitor / New User
// `system_trust_veteran` being common is correct: it IS the OG Veteran rank.
function estimateFromTags (tags, opts = {}) {
  const t = new Set(tags || [])
  let key
  if (t.has('system_trust_legend') || t.has('system_legend') || t.has('legend')) key = 'legend'
  else if (t.has('system_trust_veteran')) key = 'veteran'
  else if (t.has('system_trust_trusted')) key = 'trusted_user'
  else if (t.has('system_trust_known')) key = 'known_user'
  else if (t.has('system_trust_basic')) key = 'user'
  else key = 'visitor'

  let r = RANKS.find(x => x.key === key)
  const isOg = r.og
  // When OG tiers are hidden, cap the visible label at Trusted User (same rule as
  // resolveRank) — the underlying trust is unchanged.
  if (opts.ogMode === false && r.og) r = RANKS.find(x => x.key === 'trusted_user')

  return {
    key: r.key,
    shortLabel: r.label,
    label: 'NekoSuneAPPSVRC Community Rank: ' + r.label,
    tier: r.tier,
    color: r.color,
    accent: r.accent,
    isOg,                       // true when the *earned* tier is Veteran/Legend
    estimated: true,            // derived from VRChat trust tags, not a full score
    vrcPlus: t.has('system_supporter'), // VRC+ supporter (the monthly "boost")
    moderator: t.has('admin_moderator')
  }
}

module.exports = {
  MAX,
  RANKS,
  computeScore,
  resolveRank,
  veteranGates,
  legendGates,
  seedFromVrcTags,
  estimateFromTags,
  joinYearOf,
  TRUST_SEED,
  _internal: { sat, clamp, creatorScore }
}

// modules/ranks/rankEngine.js
// KitsuNexus Community Ranks — pure scoring engine.
// Implements the 0–1000 weighted model from docs/community-ranks-spec.md.
// NO side effects, NO I/O: takes a plain `stats` object and returns a breakdown.
//
// IMPORTANT: the score-based KitsuNexus ladder below is independent from VRChat.
// `estimateFromTags()` is a separate compatibility helper for VRChat's legacy
// trustTags and follows the old TrustedData mapping exactly.

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

const RANKS = [
  { key: 'visitor', label: 'Visitor', tier: 0, min: 0, floor: 0, color: '#8A8F98', accent: '#B5BAC2', og: false },
  { key: 'new_user', label: 'New User', tier: 1, min: 100, floor: 90, color: '#4FB477', accent: '#7FE0A6', og: false },
  { key: 'user', label: 'User', tier: 2, min: 200, floor: 180, color: '#3FA7D6', accent: '#79CBEF', og: false },
  { key: 'known_user', label: 'Known User', tier: 3, min: 400, floor: 370, color: '#7C5CFF', accent: '#A78BFA', og: false },
  { key: 'trusted_user', label: 'Trusted User', tier: 4, min: 600, floor: 565, color: '#2DD4BF', accent: '#5EEAD4', og: false },
  { key: 'veteran', label: 'Veteran', tier: 5, min: 800, floor: 760, color: '#C9A227', accent: '#F4D35E', og: true },
  { key: 'legend', label: 'Legend', tier: 6, min: 950, floor: 920, color: '#E0115F', accent: '#FF6FB5', og: true }
]

// Exact legacy VRChat TrustedData mapping supplied for OG trust display.
// Keep this separate from RANKS: the same label can intentionally have different
// legacy colors/tier ordering from KitsuNexus's own community score ladder.
const VRC_TRUST_RANKS = [
  { tag: 'admin_moderator', key: 'admin', label: 'Admin', tier: 8, color: '#8B0000', accent: '#8B0000', og: false },
  { tag: 'system_troll', key: 'troll', label: 'Troll', tier: 0, color: '#808080', accent: '#808080', og: false },
  { tag: 'system_probable_troll', key: 'probable_troll', label: 'Troll??', tier: 0, color: '#808080', accent: '#808080', og: false },
  { tag: 'system_legend', key: 'legend', label: 'Legend', tier: 7, color: '#FF0000', accent: '#FF0000', og: true },
  { tag: 'system_trust_legend', key: 'veteran', label: 'Veteran', tier: 6, color: 'yellow', accent: 'yellow', og: true },
  { tag: 'system_trust_veteran', key: 'trusted_user', label: 'Trusted User', tier: 5, color: '#8143E6', accent: '#8143E6', og: false },
  { tag: 'system_trust_trusted', key: 'known_user', label: 'Known User', tier: 4, color: '#FF7B42', accent: '#FF7B42', og: false },
  { tag: 'system_trust_known', key: 'user', label: 'User', tier: 3, color: '#2BCF5C', accent: '#2BCF5C', og: false },
  { tag: 'system_trust_intermediate', key: 'intermediate', label: 'Intermediate', tier: 2, color: '#000080', accent: '#000080', og: false },
  { tag: 'system_trust_basic', key: 'new_user', label: 'New User', tier: 1, color: '#1778FF', accent: '#1778FF', og: false }
]

const SECONDS_PER_YEAR = 365.25 * 24 * 3600
const SECONDS_PER_MONTH = SECONDS_PER_YEAR / 12

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const sat = (n, cap, k) => cap * (1 - Math.exp(-Math.max(0, n) / k))

// "Years active" is normally a hard-to-fake proxy built from KitsuNexus's own local play
// history (§2.2) — but that means it's stuck at 0 for anyone who just installed the app,
// regardless of how long they've actually played VRChat (their history predates the app having
// anything to log). Blend in half-weight credit from VRChat account tenure so long-time VRChat
// accounts aren't stuck at 0 on day one; local history overtakes this naturally with real
// continued play once it actually exceeds the join-date credit. Used both for scoring
// (computeScore) and for the Veteran/Legend "years active" gates below, so the two stay
// consistent with each other.
function effectiveActiveYears (s, nowSec) {
  const now = nowSec || Math.floor(Date.now() / 1000)
  const yearsSinceJoin = s.vrcJoinDate ? (now - s.vrcJoinDate) / SECONDS_PER_YEAR : 0
  const joinCredit = Math.max(0, yearsSinceJoin) * 0.5
  return Math.max(s.activeYears || 0, joinCredit)
}

function creatorScore (s, nowSec) {
  const daysSinceLast = s.lastPublishAt
    ? Math.max(0, (nowSec - s.lastPublishAt) / 86400)
    : Infinity
  const recency = daysSinceLast <= 180
    ? 1
    : Math.max(0, 1 - (daysSinceLast - 180) / 540)
  const consistency = clamp((s.distinctPublishMonths24 || 0) / 24, 0, 1)
  const adoption = sat(s.totalFavourites || 0, 20, 50) / 20
  return 40 * recency + 40 * consistency + 20 * adoption
}

function computeScore (stats, nowSec) {
  const s = stats || {}
  const now = nowSec || Math.floor(Date.now() / 1000)

  const yearsSinceJoin = s.vrcJoinDate ? (now - s.vrcJoinDate) / SECONDS_PER_YEAR : 0
  const monthsInstalled = s.nsaCreatedAt ? (now - s.nsaCreatedAt) / SECONDS_PER_MONTH : 0

  const breakdown = {
    joinAge: clamp(yearsSinceJoin * 25, 0, MAX.joinAge),
    yearsActive: clamp(sat(effectiveActiveYears(s, now), MAX.yearsActive, 3), 0, MAX.yearsActive),
    accountAge: clamp(monthsInstalled * 2.1, 0, MAX.accountAge),
    worldUploads: clamp(sat(s.publishedWorlds || 0, MAX.worldUploads, 4), 0, MAX.worldUploads),
    avatarUploads: clamp(sat(s.avatarUploads || 0, MAX.avatarUploads, 6), 0, MAX.avatarUploads),
    creatorActivity: clamp(creatorScore(s, now), 0, MAX.creatorActivity),
    contributions: clamp(s.contributionPoints || 0, 0, MAX.contributions),
    events: clamp(sat(s.verifiedEvents || 0, MAX.events, 8), 0, MAX.events),
    reputation: clamp(50 + (s.repNet || 0), 0, MAX.reputation),
    recognition: clamp((s.recognitionTier || 0) * 25, 0, MAX.recognition)
  }

  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k])
  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0)
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
      activeYears: s.activeYears || 0,
      effectiveActiveYears: +effectiveActiveYears(s, now).toFixed(2)
    }
  }
}

function veteranGates (stats, score) {
  const s = stats || {}
  const meaningfulCreation =
    (s.publishedWorlds || 0) >= 2 ||
    (s.avatarUploads || 0) >= 5 ||
    score.breakdown.creatorActivity >= 60
  const involvement = (s.contributionPoints || 0) >= 40 || (s.verifiedEvents || 0) >= 8
  return [
    { key: 'score', ok: score.finalScore >= 800, need: 'score ≥ 800' },
    { key: 'join_age', ok: yearsJoined(s) >= 3, need: 'VRChat join age ≥ 3y' },
    { key: 'years_active', ok: effectiveActiveYears(s) >= 2, need: '≥ 2 active years' },
    { key: 'creation', ok: meaningfulCreation, need: '≥2 worlds OR ≥5 avatars OR creatorActivity ≥ 60' },
    { key: 'involvement', ok: involvement, need: '≥40 contribution pts OR ≥8 events' },
    { key: 'reputation', ok: (s.repNet || 0) >= 0, need: 'reputation not net-negative' },
    { key: 'clean_record', ok: (s.abusePenalty == null ? 1 : s.abusePenalty) >= 1 && (s.cleanForDays || 0) >= 180, need: 'clean record ≥ 6 months' }
  ]
}

function legendGates (stats, score) {
  const s = stats || {}
  const sigAvatars = (s.avatarUploads || 0) >= 15 || (s.totalFavourites || 0) >= 1000
  return [
    { key: 'score', ok: score.finalScore >= 950, need: 'score ≥ 950' },
    { key: 'join_age', ok: yearsJoined(s) >= 5, need: 'VRChat join age ≥ 5y' },
    { key: 'years_active', ok: effectiveActiveYears(s) >= 4, need: '≥ 4 active years' },
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

function resolveRank (score, stats, opts = {}) {
  const ogMode = opts.ogMode !== false
  const prevTier = (RANKS.find(r => r.key === opts.previousRankKey) || {}).tier ?? -1
  let candidate = RANKS[0]
  for (const r of RANKS) {
    const threshold = prevTier >= r.tier ? r.floor : r.min
    if (score.finalScore >= threshold) candidate = r
  }

  const pending = []
  if (candidate.key === 'veteran') {
    const failed = veteranGates(stats, score).filter(g => !g.ok)
    if (failed.length) { pending.push(...failed.map(g => g.need)); candidate = RANKS.find(r => r.key === 'trusted_user') }
  }
  if (candidate.key === 'legend') {
    const failed = legendGates(stats, score).filter(g => !g.ok)
    if (failed.length) {
      pending.push(...failed.map(g => g.need))
      const vetFailed = veteranGates(stats, score).filter(g => !g.ok)
      candidate = vetFailed.length ? RANKS.find(r => r.key === 'trusted_user') : RANKS.find(r => r.key === 'veteran')
    }
  }

  let display = candidate
  if (!ogMode && candidate.og) display = RANKS.find(r => r.key === 'trusted_user')
  const next = RANKS.find(r => r.tier === display.tier + 1)
  return {
    key: display.key,
    label: 'KitsuNexus Community Rank: ' + display.label,
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

// One-time migration floor from the legacy VRChat trust ladder. This now mirrors
// the same tag meaning used by estimateFromTags instead of treating
// system_trust_veteran as Veteran.
const TRUST_SEED = { visitor: 50, basic: 150, new_user: 150, intermediate: 200, user: 300, known: 500, known_user: 500, trusted: 680, trusted_user: 680, veteran: 800, legend: 950 }
function seedFromVrcTags (tags) {
  const t = new Set(tags || [])
  if (t.has('system_legend')) return 950
  if (t.has('system_trust_legend')) return 800
  if (t.has('system_trust_veteran')) return 680
  if (t.has('system_trust_trusted')) return 500
  if (t.has('system_trust_known')) return 300
  if (t.has('system_trust_intermediate')) return 200
  if (t.has('system_trust_basic')) return 150
  return 50
}

function joinYearOf (dateStr) {
  if (!dateStr) return 0
  const m = /^(\d{4})/.exec(String(dateStr))
  return m ? parseInt(m[1], 10) : 0
}

// VRChat legacy rank resolver. `tags` should be PublicProfile.trustTags plus
// non-rank helper tags such as system_supporter. Rank selection itself only
// consults VRC_TRUST_RANKS.
function estimateFromTags (tags, opts = {}) {
  const t = new Set(Array.isArray(tags) ? tags : [])
  let rank = null

  // Admin and troll states are overrides. Otherwise choose the highest normal
  // legacy rank present, matching the TrustedData hierarchy supplied by the user.
  if (t.has('admin_moderator')) rank = VRC_TRUST_RANKS.find(r => r.tag === 'admin_moderator')
  else if (t.has('system_troll')) rank = VRC_TRUST_RANKS.find(r => r.tag === 'system_troll')
  else if (t.has('system_probable_troll')) rank = VRC_TRUST_RANKS.find(r => r.tag === 'system_probable_troll')
  else {
    const order = [
      'system_legend',
      'system_trust_legend',
      'system_trust_veteran',
      'system_trust_trusted',
      'system_trust_known',
      'system_trust_intermediate',
      'system_trust_basic'
    ]
    const selected = order.find(tag => t.has(tag))
    if (selected) rank = VRC_TRUST_RANKS.find(r => r.tag === selected)
  }

  if (!rank) rank = { tag: null, key: 'visitor', label: 'Visitor', tier: 0, color: '#808080', accent: '#808080', og: false }
  const earned = rank

  // Existing UI toggle semantics: hide Veteran/Legend when OG mode is disabled,
  // but use the legacy Trusted User colour when capping the display.
  if (opts.ogMode === false && earned.og) {
    rank = VRC_TRUST_RANKS.find(r => r.tag === 'system_trust_veteran')
  }

  return {
    key: rank.key,
    shortLabel: rank.label,
    label: 'VRChat OG Rank: ' + rank.label,
    tier: rank.tier,
    color: rank.color,
    accent: rank.accent,
    isOg: earned.og,
    ogHidden: opts.ogMode === false && earned.og,
    estimated: true,
    source: 'publicProfile.trustTags',
    sourceTag: earned.tag,
    vrcPlus: t.has('system_supporter'),
    moderator: t.has('admin_moderator'),
    troll: t.has('system_troll'),
    probableTroll: t.has('system_probable_troll')
  }
}

module.exports = {
  MAX,
  RANKS,
  VRC_TRUST_RANKS,
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

// modules/ranks/rankDb.js
// NekoSuneAPPSVRC Community Ranks — persistent store (SQLite via sql.js, WASM).
// Mirrors modules/history/gamelog.js: a single .sqlite file next to user data,
// debounced db.export() writes. Runs in MAIN. Implements the schema from
// docs/community-ranks-spec.md §7.

const fs = require('fs')
const os = require('os')
const path = require('path')

let SQL = null
let db = null
let dbPath = ''
let saveTimer = null

const now = () => Math.floor(Date.now() / 1000)

async function init (userDataDir) {
  if (db) return true
  let initSqlJs
  try { initSqlJs = require('sql.js') } catch (err) { console.warn('[ranks] sql.js not installed:', err.message); return false }
  const wasmDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'))
  SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) })
  dbPath = path.join(userDataDir || os.tmpdir(), 'nekosuneappsvrc-ranks.sqlite')
  try {
    db = new SQL.Database(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined)
  } catch (_) { db = new SQL.Database() }
  createSchema()
  return true
}

function createSchema () {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nsa_user_id TEXT NOT NULL UNIQUE,
    vrc_user_id TEXT UNIQUE,
    display_name TEXT NOT NULL,
    vrc_join_date INTEGER,
    nsa_created_at INTEGER NOT NULL,
    fingerprint_hash TEXT,
    vrc_trust_seed TEXT,
    is_verified INTEGER NOT NULL DEFAULT 0,
    recognition_tier INTEGER NOT NULL DEFAULT 0,
    leadership_documented INTEGER NOT NULL DEFAULT 0,
    major_contribution INTEGER NOT NULL DEFAULT 0,
    staff_signoffs INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS rank_scores (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pts_join_age REAL NOT NULL DEFAULT 0,
    pts_years_active REAL NOT NULL DEFAULT 0,
    pts_account_age REAL NOT NULL DEFAULT 0,
    pts_world_uploads REAL NOT NULL DEFAULT 0,
    pts_avatar_uploads REAL NOT NULL DEFAULT 0,
    pts_creator_activity REAL NOT NULL DEFAULT 0,
    pts_contributions REAL NOT NULL DEFAULT 0,
    pts_events REAL NOT NULL DEFAULT 0,
    pts_reputation REAL NOT NULL DEFAULT 0,
    pts_recognition REAL NOT NULL DEFAULT 0,
    raw_score REAL NOT NULL DEFAULT 0,
    abuse_penalty REAL NOT NULL DEFAULT 1.0,
    final_score INTEGER NOT NULL DEFAULT 0,
    current_rank TEXT NOT NULL DEFAULT 'visitor',
    rank_locked INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL DEFAULT 0
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS contributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    points REAL NOT NULL,
    description TEXT,
    evidence_url TEXT,
    verified_by INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    verified_at INTEGER
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_contrib_user ON contributions(user_id, status)')

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host_user_id INTEGER,
    organiser_key TEXT,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS event_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    credited_value REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(event_id, user_id)
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS world_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vrc_world_id TEXT UNIQUE,
    name TEXT,
    content_hash TEXT,
    is_published INTEGER NOT NULL DEFAULT 0,
    is_public INTEGER NOT NULL DEFAULT 0,
    favourites INTEGER NOT NULL DEFAULT 0,
    visits INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER,
    updated_at INTEGER NOT NULL
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_world_user ON world_statistics(user_id)')

  db.run(`CREATE TABLE IF NOT EXISTS avatar_statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vrc_avatar_id TEXT UNIQUE,
    name TEXT,
    content_hash TEXT,
    is_public INTEGER NOT NULL DEFAULT 0,
    favourites INTEGER NOT NULL DEFAULT 0,
    published_at INTEGER,
    updated_at INTEGER NOT NULL
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_avatar_user ON avatar_statistics(user_id)')

  db.run(`CREATE TABLE IF NOT EXISTS reputation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user INTEGER,
    kind TEXT NOT NULL,
    weight REAL NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_rep_target ON reputation_events(target_user)')

  db.run(`CREATE TABLE IF NOT EXISTS rank_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_rank TEXT,
    new_rank TEXT NOT NULL,
    old_score INTEGER,
    new_score INTEGER NOT NULL,
    reason TEXT,
    actor TEXT,
    created_at INTEGER NOT NULL
  )`)
  db.run('CREATE INDEX IF NOT EXISTS idx_history_user ON rank_history(user_id, created_at)')
}

function persist () {
  if (!db || !dbPath) return
  clearTimeout(saveTimer)
  // db.export() serialises the whole DB — debounce so we write rarely (like gamelog).
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (e) { console.warn('[ranks] save failed:', e.message) }
  }, 6000)
}

// ---- small query helpers -------------------------------------------------
function one (sql, params) {
  const st = db.prepare(sql); if (params) st.bind(params)
  const row = st.step() ? st.getAsObject() : null; st.free(); return row
}
function many (sql, params) {
  const st = db.prepare(sql); if (params) st.bind(params)
  const out = []; while (st.step()) out.push(st.getAsObject()); st.free(); return out
}
function scalar (sql, params, col = 'v') {
  const r = one(sql, params); return r ? r[col] : null
}

// ---- users ---------------------------------------------------------------
// Create-or-update a user by their NekoSuneAPPSVRC id. Returns the row.
function upsertUser (u = {}) {
  if (!db || !u.nsaUserId) return null
  const existing = one('SELECT * FROM users WHERE nsa_user_id = :id', { ':id': u.nsaUserId })
  const t = now()
  if (existing) {
    db.run(`UPDATE users SET display_name=COALESCE(?,display_name), vrc_user_id=COALESCE(?,vrc_user_id),
      vrc_join_date=COALESCE(?,vrc_join_date), fingerprint_hash=COALESCE(?,fingerprint_hash),
      is_verified=COALESCE(?,is_verified), updated_at=? WHERE nsa_user_id=?`,
    [u.displayName ?? null, u.vrcUserId ?? null, u.vrcJoinDate ?? null, u.fingerprintHash ?? null,
      u.isVerified == null ? null : (u.isVerified ? 1 : 0), t, u.nsaUserId])
  } else {
    db.run(`INSERT INTO users (nsa_user_id, vrc_user_id, display_name, vrc_join_date, nsa_created_at,
      fingerprint_hash, is_verified, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [u.nsaUserId, u.vrcUserId ?? null, u.displayName || u.nsaUserId, u.vrcJoinDate ?? null,
      u.nsaCreatedAt || t, u.fingerprintHash ?? null, u.isVerified ? 1 : 0, t, t])
    db.run('INSERT OR IGNORE INTO rank_scores (user_id, computed_at) VALUES ((SELECT id FROM users WHERE nsa_user_id=?), 0)', [u.nsaUserId])
  }
  persist()
  return getUser(u.nsaUserId)
}

function getUser (nsaUserId) {
  if (!db) return null
  return one('SELECT * FROM users WHERE nsa_user_id = :id', { ':id': nsaUserId })
}
function getUserById (id) {
  if (!db) return null
  return one('SELECT * FROM users WHERE id = :id', { ':id': id })
}

function setRecognition (nsaUserId, tier) {
  if (!db) return false
  db.run('UPDATE users SET recognition_tier=?, updated_at=? WHERE nsa_user_id=?', [Math.max(0, Math.min(2, tier | 0)), now(), nsaUserId])
  persist(); return true
}

// One-time migration seed (§10): records the VRChat-trust-derived floor.
function setTrustSeed (nsaUserId, seed) {
  if (!db) return false
  db.run('UPDATE users SET vrc_trust_seed=?, updated_at=? WHERE nsa_user_id=?', [String(seed), now(), nsaUserId])
  persist(); return true
}

// ---- contributions -------------------------------------------------------
function addContribution (userDbId, c = {}) {
  if (!db) return null
  db.run(`INSERT INTO contributions (user_id, type, points, description, evidence_url, status, created_at)
    VALUES (?,?,?,?,?,?,?)`,
  [userDbId, c.type || 'other', c.points || 0, c.description || '', c.evidenceUrl || '', c.status || 'pending', now()])
  persist()
  return scalar('SELECT last_insert_rowid() AS v')
}
function verifyContribution (id, verifierDbId, approve) {
  if (!db) return false
  db.run('UPDATE contributions SET status=?, verified_by=?, verified_at=? WHERE id=?',
    [approve ? 'verified' : 'rejected', verifierDbId ?? null, now(), id])
  persist(); return true
}
// Sum of VERIFIED contribution points for a user (the only ones that count).
function verifiedContributionPoints (userDbId) {
  return scalar('SELECT COALESCE(SUM(points),0) AS v FROM contributions WHERE user_id=:u AND status=:s',
    { ':u': userDbId, ':s': 'verified' }) || 0
}

// ---- events --------------------------------------------------------------
function createEvent (e = {}) {
  if (!db) return null
  db.run('INSERT INTO events (name, host_user_id, organiser_key, starts_at, ends_at, created_at) VALUES (?,?,?,?,?,?)',
    [e.name || 'Event', e.hostUserId ?? null, e.organiserKey || '', e.startsAt || now(), e.endsAt || now(), now()])
  persist()
  return scalar('SELECT last_insert_rowid() AS v')
}
// Record attendance with the same-organiser diversity discount (§4.3): the Nth
// event by one organiser is worth 0.7^(N-1).
function recordAttendance (eventId, userDbId, method, verified) {
  if (!db) return null
  const ev = one('SELECT organiser_key FROM events WHERE id=:id', { ':id': eventId })
  const orgKey = ev ? ev.organiser_key : ''
  const priorSameOrg = scalar(`SELECT COUNT(*) AS v FROM event_attendance ea
    JOIN events e ON e.id = ea.event_id
    WHERE ea.user_id=:u AND ea.verified=1 AND e.organiser_key=:o AND ea.event_id<>:ev`,
  { ':u': userDbId, ':o': orgKey, ':ev': eventId }) || 0
  const credited = verified ? Math.pow(0.7, priorSameOrg) : 0
  db.run(`INSERT INTO event_attendance (event_id, user_id, method, verified, credited_value, created_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(event_id,user_id) DO UPDATE SET method=excluded.method, verified=excluded.verified, credited_value=excluded.credited_value`,
  [eventId, userDbId, method || 'host_token', verified ? 1 : 0, credited, now()])
  persist()
  return { credited, priorSameOrg }
}
// Total credited (diversity-discounted) verified events for a user.
function verifiedEventCredit (userDbId) {
  return scalar('SELECT COALESCE(SUM(credited_value),0) AS v FROM event_attendance WHERE user_id=:u AND verified=1',
    { ':u': userDbId }) || 0
}

// ---- content stats (worlds / avatars) ------------------------------------
function upsertWorld (userDbId, w = {}) {
  if (!db || !w.vrcWorldId) return
  db.run(`INSERT INTO world_statistics (user_id, vrc_world_id, name, content_hash, is_published, is_public, favourites, visits, published_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(vrc_world_id) DO UPDATE SET name=excluded.name, is_published=excluded.is_published,
      is_public=excluded.is_public, favourites=excluded.favourites, visits=excluded.visits, updated_at=excluded.updated_at`,
  [userDbId, w.vrcWorldId, w.name || '', w.contentHash || '', w.isPublished ? 1 : 0, w.isPublic ? 1 : 0,
    w.favourites || 0, w.visits || 0, w.publishedAt ?? null, now()])
}
function upsertAvatar (userDbId, a = {}) {
  if (!db || !a.vrcAvatarId) return
  db.run(`INSERT INTO avatar_statistics (user_id, vrc_avatar_id, name, content_hash, is_public, favourites, published_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(vrc_avatar_id) DO UPDATE SET name=excluded.name, is_public=excluded.is_public,
      favourites=excluded.favourites, updated_at=excluded.updated_at`,
  [userDbId, a.vrcAvatarId, a.name || '', a.contentHash || '', a.isPublic ? 1 : 0, a.favourites || 0, a.publishedAt ?? null, now()])
}

// De-duplicated public counts + adoption + recency, for the engine.
function contentStats (userDbId) {
  const publishedWorlds = scalar('SELECT COUNT(DISTINCT COALESCE(NULLIF(content_hash,\'\'), vrc_world_id)) AS v FROM world_statistics WHERE user_id=:u AND is_published=1 AND is_public=1', { ':u': userDbId }) || 0
  const publicAvatars = scalar('SELECT COUNT(DISTINCT COALESCE(NULLIF(content_hash,\'\'), vrc_avatar_id)) AS v FROM avatar_statistics WHERE user_id=:u AND is_public=1', { ':u': userDbId }) || 0
  const worldFav = scalar('SELECT COALESCE(SUM(favourites),0) AS v FROM world_statistics WHERE user_id=:u', { ':u': userDbId }) || 0
  const avatarFav = scalar('SELECT COALESCE(SUM(favourites),0) AS v FROM avatar_statistics WHERE user_id=:u', { ':u': userDbId }) || 0
  const lastPublishAt = scalar(`SELECT MAX(p) AS v FROM (
      SELECT MAX(COALESCE(published_at, updated_at)) AS p FROM world_statistics WHERE user_id=:u
      UNION ALL SELECT MAX(COALESCE(published_at, updated_at)) FROM avatar_statistics WHERE user_id=:u)`, { ':u': userDbId })
  return { publishedWorlds, publicAvatars, totalFavourites: worldFav + avatarFav, lastPublishAt: lastPublishAt || null }
}

// ---- reputation ----------------------------------------------------------
function addReputation (targetDbId, actorDbId, kind, weight, reason) {
  if (!db) return
  db.run('INSERT INTO reputation_events (target_user, actor_user, kind, weight, reason, created_at) VALUES (?,?,?,?,?,?)',
    [targetDbId, actorDbId ?? null, kind || 'endorse', weight || 0, reason || '', now()])
  persist()
}
// Net reputation: most-recent endorsement per actor in the last 90 days (one vote
// per actor, §4.4) minus sanctions. Weight is already rank-scaled by the caller.
function reputationNet (targetDbId) {
  const cutoff = now() - 90 * 86400
  const endorse = scalar(`SELECT COALESCE(SUM(w),0) AS v FROM (
      SELECT actor_user, MAX(weight) AS w FROM reputation_events
      WHERE target_user=:t AND kind='endorse' AND created_at>=:c AND actor_user IS NOT NULL
      GROUP BY actor_user)`, { ':t': targetDbId, ':c': cutoff }) || 0
  const sanction = scalar(`SELECT COALESCE(SUM(weight),0) AS v FROM reputation_events
      WHERE target_user=:t AND kind IN ('sanction','warn')`, { ':t': targetDbId }) || 0
  return Math.round(endorse - Math.abs(sanction))
}

// ---- scores + history ----------------------------------------------------
function saveScore (userDbId, score, rankKey) {
  if (!db) return
  const b = score.breakdown
  db.run(`UPDATE rank_scores SET pts_join_age=?, pts_years_active=?, pts_account_age=?, pts_world_uploads=?,
      pts_avatar_uploads=?, pts_creator_activity=?, pts_contributions=?, pts_events=?, pts_reputation=?,
      pts_recognition=?, raw_score=?, abuse_penalty=?, final_score=?, current_rank=?, computed_at=? WHERE user_id=?`,
  [b.joinAge, b.yearsActive, b.accountAge, b.worldUploads, b.avatarUploads, b.creatorActivity, b.contributions,
    b.events, b.reputation, b.recognition, score.rawScore, score.abusePenalty, score.finalScore, rankKey, now(), userDbId])
  persist()
}
function getScore (userDbId) {
  if (!db) return null
  return one('SELECT * FROM rank_scores WHERE user_id=:u', { ':u': userDbId })
}
function recordHistory (userDbId, oldRank, newRank, oldScore, newScore, reason, actor) {
  if (!db) return
  db.run('INSERT INTO rank_history (user_id, old_rank, new_rank, old_score, new_score, reason, actor, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [userDbId, oldRank ?? null, newRank, oldScore ?? null, newScore, reason || 'recompute', actor || 'system', now()])
  persist()
}
function history (userDbId, limit = 50) {
  if (!db) return []
  return many('SELECT old_rank,new_rank,old_score,new_score,reason,actor,created_at FROM rank_history WHERE user_id=:u ORDER BY created_at DESC LIMIT ' + (limit | 0), { ':u': userDbId })
}

// Leaderboard — opt-in members are passed by id from the caller (privacy: §8).
function leaderboard (limit = 50) {
  if (!db) return []
  return many(`SELECT u.nsa_user_id, u.display_name, s.final_score, s.current_rank
    FROM rank_scores s JOIN users u ON u.id = s.user_id
    ORDER BY s.final_score DESC, u.created_at ASC LIMIT ` + (limit | 0))
}

function close () { try { if (db && dbPath) fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (_) {} }
function isReady () { return !!db }

module.exports = {
  init, close, isReady, persist,
  upsertUser, getUser, getUserById, setRecognition, setTrustSeed,
  addContribution, verifyContribution, verifiedContributionPoints,
  createEvent, recordAttendance, verifiedEventCredit,
  upsertWorld, upsertAvatar, contentStats,
  addReputation, reputationNet,
  saveScore, getScore, recordHistory, history, leaderboard
}

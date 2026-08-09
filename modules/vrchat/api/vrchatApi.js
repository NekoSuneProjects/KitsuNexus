// modules/vrchat/api/vrchatApi.js
// Minimal VRChat API client (same endpoints the `vrchat` npm wraps) used ONLY to
// read your own account status (join me / active / ask me / busy) so the Discord
// presence gate can follow it automatically. Implemented with axios (already a
// dependency) for full control over the auth/2FA/cookie flow.
//
// SECURITY: we never store your password — only the session cookies VRChat
// returns (auth + twoFactorAuth), persisted via electron-store. Runs in MAIN.
//
// VRChat requires a descriptive User-Agent with contact info or it returns 403.

const axios = require('axios')
const settings = require('../../../settings')
const rankEngine = require('../../ranks/rankEngine') // pure, no side effects — maps VRChat trust tags → community rank

const BASE = 'https://api.vrchat.cloud/api/1'
const UA = 'KitsuNexus/1.0.0 nekosunevr@nekosunevr.co.uk'
const COOKIE_KEY = 'vrchatCookies'

let cookies = {}

function loadCookies () { cookies = settings.get(COOKIE_KEY, {}) || {} }
function saveCookies () { settings.set(COOKIE_KEY, cookies) }
function cookieHeader () { return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') }

function storeSetCookie (res) {
  const sc = res && res.headers && res.headers['set-cookie']
  if (Array.isArray(sc)) {
    for (const line of sc) {
      const m = line.match(/^([^=]+)=([^;]+)/)
      if (m) cookies[m[1].trim()] = m[2].trim()
    }
    saveCookies()
  }
}

function baseHeaders (extra) {
  return Object.assign({ 'User-Agent': UA, Cookie: cookieHeader() }, extra || {})
}
const REQ = { validateStatus: () => true, timeout: 15000 }

// ---- Lightweight cache to keep VRChat API rate-limit minimal ----
// Caches successful GETs for a TTL and de-dupes concurrent identical calls so the
// friends panel, friend-diff logger and status poller share one request.
const _cache = new Map()
const _inflight = new Map()
// Global 429 backoff — if VRChat rate-limits us, stop hitting the API for a while
// and serve stale cache instead (prevents request storms / crashes).
let rateLimitedUntil = 0
axios.interceptors.response.use(r => {
  if (r && r.status === 429) {
    const ra = parseInt(r.headers && r.headers['retry-after'], 10)
    rateLimitedUntil = Date.now() + (ra ? ra * 1000 : 60000)
    console.warn('[vrchat] 429 rate limited — backing off ' + Math.round((rateLimitedUntil - Date.now()) / 1000) + 's')
  }
  return r
}, e => Promise.reject(e))
function isRateLimited () { return Date.now() < rateLimitedUntil }
function _memo (key, ttl, fn) {
  const hit = _cache.get(key)
  // Serve cache within TTL, or any stale cache while rate-limited.
  if (hit && (Date.now() - hit.ts < ttl || isRateLimited())) return Promise.resolve(hit.val)
  if (_inflight.has(key)) return _inflight.get(key)
  const p = Promise.resolve().then(fn)
    .then(v => { if (v && v.ok) _cache.set(key, { ts: Date.now(), val: v }); _inflight.delete(key); return v })
    .catch(e => { _inflight.delete(key); throw e })
  _inflight.set(key, p)
  return p
}
function invalidate (prefix) {
  for (const k of _cache.keys()) if (!prefix || k.startsWith(prefix)) _cache.delete(k)
}

let currentUserId = '' // captured on login so group/profile calls can use it

function pickUser (d) {
  if (d && d.id) currentUserId = d.id
  return {
    id: d.id,
    displayName: d.displayName,
    status: d.status, // "join me" | "active" | "ask me" | "busy" | "offline"
    statusDescription: d.statusDescription,
    bio: typeof d.bio === 'string' ? d.bio : null, // null = not returned by this endpoint
    pronouns: typeof d.pronouns === 'string' ? d.pronouns : null,
    bioLinks: Array.isArray(d.bioLinks) ? d.bioLinks.filter(Boolean) : [],
    userIcon: d.userIcon || d.profilePicOverride || d.currentAvatarThumbnailImageUrl || null,
    state: d.state,
    // Additive fields used by the Community Ranks module (join age + trust seed).
    dateJoined: d.date_joined || null, // "YYYY-MM-DD"
    tags: Array.isArray(d.tags) ? d.tags : [],
    // The authoritative full friend-id list — used to reconcile the (sometimes
    // incomplete) paginated friends endpoints. See getAllFriends().
    friendIds: Array.isArray(d.friends) ? d.friends : []
  }
}
function errOf (res, fallback) {
  return (res.data && res.data.error && res.data.error.message) || fallback || `HTTP ${res.status}`
}

async function login (username, password) {
  loadCookies()
  const basic = Buffer.from(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`).toString('base64')
  const res = await axios.get(`${BASE}/auth/user`, Object.assign({ headers: baseHeaders({ Authorization: `Basic ${basic}` }) }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data) {
    if (res.data.requiresTwoFactorAuth) return { ok: true, needs2fa: true, methods: res.data.requiresTwoFactorAuth }
    if (res.data.id) return { ok: true, needs2fa: false, user: pickUser(res.data) }
  }
  return { ok: false, error: errOf(res, 'Login failed') }
}

// method: 'emailotp' (email code) or 'totp' (authenticator app)
async function verify2fa (code, method) {
  loadCookies()
  const path = method === 'emailotp' ? 'emailotp' : 'totp'
  const res = await axios.post(`${BASE}/auth/twofactorauth/${path}/verify`, { code: String(code).trim() },
    Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.verified) return fetchUser()
  return { ok: false, error: errOf(res, 'Invalid 2FA code') }
}

function fetchUser () { return _memo('self', 20000, _fetchUser) }
async function _fetchUser () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/auth/user`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.id) return { ok: true, user: pickUser(res.data) }
  if (res.data && res.data.requiresTwoFactorAuth) return { ok: false, needs2fa: true, methods: res.data.requiresTwoFactorAuth }
  return { ok: false, error: errOf(res, 'Could not fetch user') }
}

// Map VRChat's status string to our world-visibility gate keys.
function mapStatus (s) {
  switch (String(s || '').toLowerCase()) {
    case 'join me': return 'join'
    case 'active': return 'active'
    case 'ask me': return 'ask'
    case 'busy': return 'busy'
    default: return 'busy' // offline / unknown -> hide world
  }
}

// Parse a VRChat location string into world/instance + access type.
// type: public | friends+ | friends | invite+ | invite | group | group+ | groupMembers
// `private` = invite-only / members-only (can't self-invite); `joinable` = you can
// see it and self-invite (public / friends / friends+ / group / group+).
function parseInstance (location) {
  if (!location || location === 'offline' || location === 'traveling') return { type: location || 'offline', private: false, joinable: false }
  if (location === 'private') return { type: 'private', private: true, joinable: false }
  const m = String(location).match(/^(wrld_[^:]+):([^~]+)(~.*)?$/)
  if (!m) return { type: 'unknown', private: false, joinable: false }
  const worldId = m[1]
  const tags = m[3] || ''
  let type = 'public'
  if (/~group\(/.test(tags)) {
    const ga = (tags.match(/~groupAccessType\((\w+)\)/) || [])[1] || 'members'
    type = ga === 'public' ? 'group' : (ga === 'plus' ? 'group+' : 'groupMembers')
  } else if (/~private\(/.test(tags)) type = /~canRequestInvite/.test(tags) ? 'invite+' : 'invite'
  else if (/~friends\(/.test(tags)) type = 'friends'
  else if (/~hidden\(/.test(tags)) type = 'friends+'
  const isPrivate = type === 'invite' || type === 'invite+' || type === 'groupMembers'
  return {
    worldId,
    instanceId: m[2] + tags, // full instance id (with access tags) for URLs / self-invite
    type,
    private: isPrivate,
    joinable: !isPrivate && type !== 'unknown',
    region: (tags.match(/~region\((\w+)\)/) || [])[1] || ''
  }
}

// Pull the spoken-language codes out of a user's VRChat tags. VRChat stores these
// as `language_xxx` tags (xxx = ISO 639-2/3 code, e.g. language_eng, language_jpn).
function languagesFromTags (tags) {
  return (Array.isArray(tags) ? tags : [])
    .filter(t => typeof t === 'string' && t.startsWith('language_'))
    .map(t => t.slice('language_'.length))
}

// ---- Friend Den: online friends + their location ----
function pickFriend (f) {
  const inst = parseInstance(f.location)
  return {
    id: f.id,
    displayName: f.displayName,
    status: f.status,
    statusDescription: f.statusDescription,
    location: f.location, // "offline" | "private" | "traveling" | "wrld_..:inst"
    worldId: inst.worldId || '',
    instanceId: inst.instanceId || '',
    instanceType: inst.type, // public | friends+ | friends | invite(+) | group(+) | groupMembers
    private: inst.private,
    joinable: inst.joinable,
    state: f.state, // "online" (in-game) | "active" (on website) | "offline"
    platform: f.platform,
    languages: languagesFromTags(f.tags), // ['eng','jpn',...] → flag badges in the UI
    // Estimated KitsuNexus Community Rank from VRChat trust tags (Veteran/Legend
    // show when earned). Renderer decides whether to display it (feature toggle).
    // Join year (when present) gates OG Veteran so not every trusted user is one.
    communityRank: rankEngine.estimateFromTags(f.tags, { joinYear: rankEngine.joinYearOf(f.date_joined) }),
    image: f.userIcon || f.profilePicOverride || f.currentAvatarThumbnailImageUrl || ''
  }
}
// Online list refreshes often; the heavy paginated offline list rarely changes.
function getFriends (offline = false) { return _memo(`friends:${!!offline}`, offline ? 300000 : 90000, () => _getFriends(offline)) }
async function _getFriends (offline = false) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  // The endpoint returns max 100 per call — paginate to get the WHOLE list.
  const all = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const res = await axios.get(`${BASE}/auth/user/friends`, Object.assign({ headers: baseHeaders(), params: { offline: !!offline, n: 100, offset } }, REQ))
    storeSetCookie(res)
    if (res.status !== 200 || !Array.isArray(res.data)) {
      if (offset === 0) return { ok: false, error: errOf(res, 'Could not list friends') }
      break
    }
    all.push(...res.data)
    if (res.data.length < 100) break
  }
  return { ok: true, friends: all.map(pickFriend) }
}

// The COMPLETE friend list. VRChat's two paginated buckets (online + offline)
// don't always add up to your real friend list — a known gap that VRCX works
// around by reconciling against the authoritative `auth/user.friends` id array
// and fetching any stragglers individually. This does the same.
function getAllFriends () { return _memo('friends:all', 120000, _getAllFriends) }
async function _getAllFriends () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const [on, off, me] = await Promise.all([getFriends(false), getFriends(true), fetchUser()])
  if (!on.ok && !off.ok) return { ok: false, error: on.error || off.error || 'Could not list friends' }

  // TRUST THE BUCKETS, not each friend's `state` field — VRChat's friends endpoint
  // doesn't reliably include `state`, so deriving online/offline from it marks
  // everyone offline. The endpoint you asked (offline=false / =true) IS the answer.
  const seen = new Set()
  const online = []
  const offline = []
  for (const f of (on.friends || [])) { if (!seen.has(f.id)) { seen.add(f.id); online.push({ ...f, online: true }) } }
  for (const f of (off.friends || [])) { if (!seen.has(f.id)) { seen.add(f.id); offline.push({ ...f, online: false }) } }

  // Reconcile: any id the account says is a friend but neither bucket returned.
  const wantIds = (me && me.ok && me.user && me.user.friendIds) || []
  const missing = wantIds.filter(id => !seen.has(id))
  let recovered = 0
  // Cap individual look-ups so a huge gap can't hammer the API; the rest still show.
  for (const id of missing.slice(0, 60)) {
    try {
      const r = await getUser(id)
      if (r && r.ok && r.user) {
        const f = pickFriend(r.user)
        // A recovered friend is "online" only if VRChat reports a live location/state.
        const isOn = (f.location && f.location !== 'offline' && f.location !== 'traveling') || f.state === 'online' || f.state === 'active'
        ;(isOn ? online : offline).push({ ...f, online: isOn })
        seen.add(id); recovered++
      }
    } catch (_) { /* skip — best effort */ }
  }

  const friends = [...online, ...offline]
  return {
    ok: true,
    friends,
    online,
    offline,
    total: friends.length,
    onlineCount: online.length,
    expected: wantIds.length || friends.length,
    recovered,
    stillMissing: Math.max(0, missing.length - recovered)
  }
}

// ---- User profile (clicked from the friends panel) ----
function getUser (id) { return _memo('user:' + id, 45000, () => _getUser(id)) }
async function _getUser (id) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/users/${id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.id) return { ok: true, user: res.data }
  return { ok: false, error: errOf(res, 'Could not load user') }
}

// ---- Social actions from the profile modal ----
async function sendFriendRequest (userId) {
  loadCookies()
  const res = await axios.post(`${BASE}/user/${userId}/friendRequest`, null, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Friend request failed') }
}
// Ask a user to invite you to where they are. VRChat uses canned "message slots"
// (0–11) instead of free text; pass a slot or omit for the default request.
async function requestInvite (userId, messageSlot) {
  loadCookies()
  const body = (typeof messageSlot === 'number') ? { messageSlot } : {}
  const res = await axios.post(`${BASE}/requestInvite/${userId}`, body, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Request invite failed') }
}

// Already friends? -> remove them.
async function unfriend (userId) {
  loadCookies()
  const res = await axios.delete(`${BASE}/auth/user/friends/${userId}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Unfriend failed') }
}
// Invite a user to an instance (your current one). Optional canned message slot.
async function inviteUser (userId, instanceId, messageSlot) {
  loadCookies()
  const body = { instanceId }
  if (typeof messageSlot === 'number') body.messageSlot = messageSlot
  const res = await axios.post(`${BASE}/invite/${userId}`, body, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Invite failed') }
}
// Profile tabs: a user's groups + public worlds.
async function getUserGroups (userId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/users/${userId}/groups`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, groups: res.data.map(g => ({ id: g.groupId || g.id, name: g.name, icon: g.iconUrl || '', members: g.memberCount, ownerId: g.ownerId })) }
  return { ok: false, error: errOf(res, 'Could not load groups') }
}
async function getUserWorlds (userId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/worlds`, Object.assign({ headers: baseHeaders(), params: { userId, releaseStatus: 'public', n: 50, sort: 'updated', order: 'descending' } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, worlds: res.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites })) }
  return { ok: false, error: errOf(res, 'Could not load worlds') }
}

// Boop a user (real VRChat API — POST /users/{id}/boop). Optional emoji id.
async function sendBoop (userId, emojiId) {
  loadCookies()
  const body = emojiId ? { emojiId } : {}
  const res = await axios.post(`${BASE}/users/${userId}/boop`, body, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Boop failed') }
}

// Online user count (server activity). VRChat's /visits is the TOTAL across all
// platforms; Steam's public API gives the Steam (PC desktop + PCVR) concurrent count
// for VRChat (appid 438100), so Quest/other = total − steam — same method the public
// VRChat metrics sites use. Steam needs no API key.
const STEAM_APPID = 438100
async function getOnlineCount () {
  loadCookies()
  const res = await axios.get(`${BASE}/visits`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status !== 200) return { ok: false, error: errOf(res, 'Could not load online count') }
  const total = Number(res.data) || 0
  let steam = null
  try {
    const sr = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${STEAM_APPID}`, REQ)
    if (sr.status === 200 && sr.data && sr.data.response && typeof sr.data.response.player_count === 'number') steam = sr.data.response.player_count
  } catch (_) { /* Steam unreachable — show total only */ }
  const quest = (steam != null) ? Math.max(0, total - steam) : null
  return { ok: true, count: total, total, steam, quest }
}
// Group posts/announcements (for group alerts).
async function getGroupPosts (groupId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${groupId}/posts`, Object.assign({ headers: baseHeaders(), params: { n: 10 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200) {
    const arr = Array.isArray(res.data) ? res.data : (res.data && res.data.posts) || []
    return { ok: true, posts: arr.map(p => ({ id: p.id, title: p.title, text: p.text, createdAt: p.createdAt })) }
  }
  return { ok: false, error: errOf(res, 'Could not load posts') }
}

// ---- Inventory (icons / emoji / stickers / prints) + image proxy ----
function bestFileUrl (f) {
  const v = (f.versions || []).filter(x => x.file && x.file.url)
  if (v.length) return v[v.length - 1].file.url
  return f.thumbnailUrl || f.imageUrl || ''
}
async function getInventory (tag) { // tag: icon | emoji | sticker | gallery
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/files`, Object.assign({ headers: baseHeaders(), params: { tag, n: 60 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, items: res.data.map(f => ({ id: f.id, name: f.name || tag, url: bestFileUrl(f) })).filter(i => i.url) }
  return { ok: false, error: errOf(res, 'Could not load ' + tag) }
}
async function getPrints () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const res = await axios.get(`${BASE}/prints/user/${currentUserId}`, Object.assign({ headers: baseHeaders(), params: { n: 60 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, items: res.data.map(p => ({ id: p.id, name: p.note || 'Print', url: (p.files && (p.files.image || p.files.fileUrl)) || p.image || '' })).filter(i => i.url) }
  return { ok: false, error: errOf(res, 'Could not load prints') }
}
// Fetch an auth-gated VRChat image and return it as a data URL (for <img>).
const _imgCache = new Map()
async function imageData (url) {
  if (!url) return { ok: false, error: 'no url' }
  if (_imgCache.has(url)) return { ok: true, data: _imgCache.get(url) }
  loadCookies()
  const res = await axios.get(url, { headers: baseHeaders(), responseType: 'arraybuffer', validateStatus: () => true, timeout: 20000 })
  if (res.status === 200) {
    const ct = res.headers['content-type'] || 'image/png'
    const dataUrl = `data:${ct};base64,${Buffer.from(res.data).toString('base64')}`
    if (_imgCache.size < 300) _imgCache.set(url, dataUrl)
    return { ok: true, data: dataUrl }
  }
  return { ok: false, error: 'HTTP ' + res.status }
}

// ---- Avatar detail, group members/roles, moderations ----
async function getAvatar (id) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/avatars/${id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.id) {
    const a = res.data
    const platforms = [...new Set((a.unityPackages || []).map(p => p.platform).filter(Boolean))]
    const perf = [...new Set((a.unityPackages || []).map(p => p.performanceRating).filter(Boolean))]
    return { ok: true, avatar: { id: a.id, name: a.name, description: a.description, image: a.thumbnailImageUrl || a.imageUrl, authorName: a.authorName, authorId: a.authorId, releaseStatus: a.releaseStatus, platforms, performance: perf, created: a.created_at, updated: a.updated_at } }
  }
  return { ok: false, error: errOf(res, 'Could not load avatar') }
}
async function getGroupMembers (groupId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${groupId}/members`, Object.assign({ headers: baseHeaders(), params: { n: 50 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, members: res.data.map(m => ({ id: (m.user && m.user.id) || m.userId, name: (m.user && m.user.displayName) || '', icon: (m.user && (m.user.userIcon || m.user.currentAvatarThumbnailImageUrl)) || '', roleIds: m.roleIds || [], isOwner: m.isGroupRepresentation || false })) }
  return { ok: false, error: errOf(res, 'Could not load members') }
}
async function getGroupRoles (groupId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${groupId}/roles`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, roles: res.data.map(r => ({ id: r.id, name: r.name, permissions: r.permissions || [] })) }
  return { ok: false, error: errOf(res, 'Could not load roles') }
}
async function getModerations () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/auth/user/playermoderations`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, moderations: res.data.map(m => ({ id: m.id, type: m.type, targetUserId: m.targetUserId, targetName: m.targetDisplayName })) }
  return { ok: false, error: errOf(res, 'Could not load moderations') }
}

// ---- Messenger (invite/response message slots) ----
// type: message (invite) | response | request (request invite) | requestResponse
async function getMessages (type) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const res = await axios.get(`${BASE}/message/${currentUserId}/${type}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, messages: res.data.map(m => ({ slot: m.slot, message: m.message })) }
  return { ok: false, error: errOf(res, 'Could not load messages') }
}
async function updateMessage (type, slot, message) {
  loadCookies()
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const res = await axios.put(`${BASE}/message/${currentUserId}/${type}/${slot}`, { message }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Update message failed') }
}

// ---- Group posts + galleries ----
async function getGroupGalleries (groupId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${groupId}/galleries`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, galleries: res.data.map(g => ({ id: g.id, name: g.name })) }
  return { ok: false, error: errOf(res, 'Could not load galleries') }
}
async function getGroupGalleryImages (groupId, galleryId) {
  loadCookies()
  const res = await axios.get(`${BASE}/groups/${groupId}/galleries/${galleryId}`, Object.assign({ headers: baseHeaders(), params: { n: 30 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, images: res.data.map(i => i.imageUrl).filter(Boolean) }
  return { ok: false, error: errOf(res, 'Could not load images') }
}

// ---- Notes, moderation (block/mute), favorite-friend ids ----
async function setNote (userId, note) {
  loadCookies()
  const res = await axios.post(`${BASE}/userNotes`, { targetUserId: userId, note }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Save note failed') }
}
async function moderate (userId, type) { // type: 'block' | 'mute'
  loadCookies()
  const res = await axios.post(`${BASE}/auth/user/playermoderations`, { moderated: userId, type }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Moderation failed') }
}
async function unmoderate (userId, type) {
  loadCookies()
  const res = await axios.put(`${BASE}/auth/user/unplayermoderate`, { moderated: userId, type }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Un-moderation failed') }
}
async function getFavoriteFriendIds () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/favorites`, Object.assign({ headers: baseHeaders(), params: { type: 'friend', n: 100 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) {
    const groups = {}
    for (const f of res.data) groups[f.favoriteId] = (f.tags && f.tags[0]) || 'group_0'
    return { ok: true, ids: res.data.map(f => f.favoriteId), groups }
  }
  return { ok: false, error: errOf(res, 'Could not load favorite friends') }
}

// ---- Self profile editor / avatars / instances / group invite ----
async function updateProfile (fields) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const res = await axios.put(`${BASE}/users/${currentUserId}`, fields, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res); invalidate('self')
  return res.status === 200 ? { ok: true, user: pickUser(res.data) } : { ok: false, error: errOf(res, 'Profile update failed') }
}
async function selectAvatar (id) {
  loadCookies()
  const res = await axios.put(`${BASE}/avatars/${id}/select`, {}, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Select avatar failed') }
}
async function deleteAvatar (id) {
  loadCookies()
  const res = await axios.delete(`${BASE}/avatars/${id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Delete avatar failed') }
}
// Create an instance for a world. access: public|friends+|friends|invite+|invite
async function createInstance (worldId, access, region) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const body = { worldId, region: region || 'us' }
  if (access === 'public') body.type = 'public'
  else if (access === 'friends+') { body.type = 'hidden'; body.ownerId = currentUserId }
  else if (access === 'friends') { body.type = 'friends'; body.ownerId = currentUserId }
  else if (access === 'invite+') { body.type = 'private'; body.ownerId = currentUserId; body.canRequestInvite = true }
  else { body.type = 'private'; body.ownerId = currentUserId }
  const res = await axios.post(`${BASE}/instances`, body, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data) {
    const instanceId = res.data.instanceId || (res.data.id || '').split(':')[1]
    return { ok: true, instanceId, location: res.data.location || `${worldId}:${instanceId}`, worldId }
  }
  return { ok: false, error: errOf(res, 'Create instance failed') }
}
// Create a GROUP instance for a world. access: public | plus | members
async function createGroupInstance (worldId, groupId, access, region) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const body = { worldId, type: 'group', region: region || 'us', ownerId: groupId, groupAccessType: access || 'members', roleIds: [] }
  const res = await axios.post(`${BASE}/instances`, body, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data) {
    const instanceId = res.data.instanceId || (res.data.id || '').split(':')[1]
    return { ok: true, instanceId, location: res.data.location || `${worldId}:${instanceId}`, worldId }
  }
  return { ok: false, error: errOf(res, 'Create group instance failed') }
}
async function inviteSelf (location) {
  loadCookies()
  const res = await axios.post(`${BASE}/invite/myself/to/${location}`, {}, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Self-invite failed') }
}
async function groupInvite (groupId, userId) {
  loadCookies()
  const res = await axios.post(`${BASE}/groups/${groupId}/invites`, { userId }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Group invite failed') }
}

// ---- Search + detail (users / worlds / groups) ----
async function searchUsers (q) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/users`, Object.assign({ headers: baseHeaders(), params: { search: q, n: 24 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, users: res.data.map(u => ({ id: u.id, displayName: u.displayName, statusDescription: u.statusDescription, status: u.status, image: u.userIcon || u.profilePicOverride || u.currentAvatarThumbnailImageUrl || '' })) }
  return { ok: false, error: errOf(res, 'User search failed') }
}
async function searchWorlds (q) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/worlds`, Object.assign({ headers: baseHeaders(), params: { search: q, n: 24, sort: 'relevance', order: 'descending' } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, worlds: res.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, authorName: w.authorName, visits: w.visits, favorites: w.favorites, occupants: w.occupants })) }
  return { ok: false, error: errOf(res, 'World search failed') }
}
async function searchGroups (q) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups`, Object.assign({ headers: baseHeaders(), params: { query: q, n: 24 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, groups: res.data.map(g => ({ id: g.id, name: g.name, shortCode: g.shortCode, icon: g.iconUrl || '', members: g.memberCount })) }
  return { ok: false, error: errOf(res, 'Group search failed') }
}
function getWorld (id) { return _memo('world:' + id, 300000, () => _getWorld(id)) }
// Just the world name (memoized 30 min) — for labelling friends' instances cheaply.
async function getWorldName (id) {
  if (!id || !/^wrld_/.test(id)) return { ok: false, error: 'bad id' }
  return _memo('worldName:' + id, 1800000, async () => {
    const r = await _getWorld(id)
    return r && r.ok && r.world ? { ok: true, name: r.world.name || '' } : { ok: false, error: (r && r.error) || 'failed' }
  })
}
async function _getWorld (id) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/worlds/${id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.id) return { ok: true, world: res.data }
  return { ok: false, error: errOf(res, 'Could not load world') }
}
function getGroup (id) { return _memo('group:' + id, 300000, () => _getGroup(id)) }
async function _getGroup (id) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && res.data && res.data.id) return { ok: true, group: res.data }
  return { ok: false, error: errOf(res, 'Could not load group') }
}

// Favorites add/remove. type: 'world' | 'avatar' | 'friend'.
function favTag (type) { return type === 'world' ? 'worlds1' : type === 'avatar' ? 'avatars1' : 'group_0' }
async function addFavorite (type, id) {
  loadCookies()
  const res = await axios.post(`${BASE}/favorites`, { type, favoriteId: id, tags: [favTag(type)] }, Object.assign({ headers: baseHeaders({ 'Content-Type': 'application/json' }) }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Add favorite failed') }
}
async function removeFavorite (favoriteId) {
  loadCookies()
  // favoriteId is the world/avatar/user id — find its favorite record then delete it.
  const listRes = await axios.get(`${BASE}/favorites`, Object.assign({ headers: baseHeaders(), params: { n: 200 } }, REQ))
  storeSetCookie(listRes)
  const rec = Array.isArray(listRes.data) ? listRes.data.find(f => f.favoriteId === favoriteId) : null
  if (!rec) return { ok: false, error: 'Not in your favorites' }
  const res = await axios.delete(`${BASE}/favorites/${rec.id}`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Remove favorite failed') }
}

// Your own worlds (all release statuses) for the Content page.
async function getMyWorlds () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/worlds`, Object.assign({ headers: baseHeaders(), params: { user: 'me', releaseStatus: 'all', n: 100, sort: 'updated', order: 'descending' } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, worlds: res.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites, releaseStatus: w.releaseStatus })) }
  return { ok: false, error: errOf(res, 'Could not load worlds') }
}

// Your own avatars (for the Content page).
async function getMyAvatars () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/avatars`, Object.assign({ headers: baseHeaders(), params: { releaseStatus: 'all', user: 'me', n: 50, sort: 'updated', order: 'descending' } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, avatars: res.data.map(a => ({ id: a.id, name: a.name, image: a.thumbnailImageUrl || a.imageUrl, releaseStatus: a.releaseStatus })) }
  return { ok: false, error: errOf(res, 'Could not load avatars') }
}

// Mutual friends (Shared Connections). 403 = the user has it turned OFF.
async function getMutualFriends (userId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/users/${userId}/mutuals`, Object.assign({ headers: baseHeaders(), params: { n: 100 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, friends: res.data.map(pickFriend) }
  if (res.status === 403) return { ok: false, off: true, error: 'This user has Shared Connections turned off.' }
  return { ok: false, error: errOf(res, 'Could not load mutual friends') }
}
// Your own favorite worlds (favorites are private to other users), tagged with
// which favorite GROUP each belongs to so the UI can categorise them.
async function getFavoriteWorlds () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/worlds/favorites`, Object.assign({ headers: baseHeaders(), params: { n: 100 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) {
    return { ok: true, worlds: res.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites, group: w.favoriteGroup || (Array.isArray(w.favoriteGroups) && w.favoriteGroups[0]) || 'worlds1' })) }
  }
  return { ok: false, error: errOf(res, 'Could not load favorites') }
}
// Favorite group display names (worlds1 -> "Game Worlds", etc.).
async function getFavoriteGroups (type = 'world') {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/favorite/groups`, Object.assign({ headers: baseHeaders(), params: { type, n: 25 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, groups: res.data.map(g => ({ name: g.name, displayName: g.displayName })) }
  return { ok: false, error: errOf(res, 'Could not load favorite groups') }
}

// ---- Event Scout: your groups + each group's calendar events ----
async function getMyGroups () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  if (!currentUserId) { const u = await fetchUser(); if (!u.ok) return u }
  const res = await axios.get(`${BASE}/users/${currentUserId}/groups`, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) {
    return { ok: true, groups: res.data.map(g => ({ id: g.groupId || g.id, name: g.name, icon: g.iconUrl || '' })) }
  }
  return { ok: false, error: errOf(res, 'Could not list groups') }
}
async function getGroupEvents (groupId) {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/groups/${groupId}/events`, Object.assign({ headers: baseHeaders(), params: { n: 20 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200) {
    const arr = Array.isArray(res.data) ? res.data : (res.data && res.data.results) || []
    return { ok: true, events: arr.map(e => ({ id: e.id, title: e.title || e.name, startsAt: e.startsAt || e.startTime, description: e.description, groupId })) }
  }
  return { ok: false, error: errOf(res, 'Could not list events') }
}

// ---- Auto-Greeter: notifications + accept friend request ----
function getNotifications () { return _memo('notifs', 30000, _getNotifications) }
async function _getNotifications () {
  loadCookies()
  if (!cookies.auth) return { ok: false, error: 'Not logged in' }
  const res = await axios.get(`${BASE}/auth/user/notifications`, Object.assign({ headers: baseHeaders(), params: { n: 100 } }, REQ))
  storeSetCookie(res)
  if (res.status === 200 && Array.isArray(res.data)) return { ok: true, notifications: res.data }
  return { ok: false, error: errOf(res, 'Could not list notifications') }
}
async function acceptFriendRequest (notificationId) {
  loadCookies()
  const res = await axios.put(`${BASE}/auth/user/notifications/${notificationId}/accept`, null, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res); invalidate('notifs')
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Accept failed') }
}
// Dismiss / hide a notification.
async function hideNotification (notificationId) {
  loadCookies()
  const res = await axios.put(`${BASE}/auth/user/notifications/${notificationId}/hide`, null, Object.assign({ headers: baseHeaders() }, REQ))
  storeSetCookie(res); invalidate('notifs')
  return res.status === 200 ? { ok: true } : { ok: false, error: errOf(res, 'Dismiss failed') }
}

// Map VRChat's status string to our world-visibility gate keys.
function mapStatus (s) {
  switch (String(s || '').toLowerCase()) {
    case 'join me': return 'join'
    case 'active': return 'active'
    case 'ask me': return 'ask'
    case 'busy': return 'busy'
    default: return 'busy' // offline / unknown -> hide world
  }
}

function isLoggedIn () { loadCookies(); return !!cookies.auth }
function logout () { cookies = {}; currentUserId = ''; saveCookies(); invalidate() }

module.exports = {
  login, verify2fa, fetchUser, mapStatus, isLoggedIn, logout, invalidate,
  getFriends, getAllFriends, getUser, sendFriendRequest, requestInvite, unfriend, inviteUser, getUserGroups, getUserWorlds,
  getMutualFriends, getFavoriteWorlds, getFavoriteGroups, sendBoop, getMyAvatars, getMyWorlds, addFavorite, removeFavorite,
  searchUsers, searchWorlds, searchGroups, getWorld, getWorldName, getGroup, parseInstance,
  updateProfile, selectAvatar, deleteAvatar, createInstance, createGroupInstance, inviteSelf, groupInvite, isRateLimited,
  setNote, moderate, unmoderate, getFavoriteFriendIds, getOnlineCount, getGroupPosts,
  getMessages, updateMessage, getGroupGalleries, getGroupGalleryImages,
  getAvatar, getGroupMembers, getGroupRoles, getModerations,
  getInventory, getPrints, imageData,
  getMyGroups, getGroupEvents, getNotifications, acceptFriendRequest, hideNotification
}

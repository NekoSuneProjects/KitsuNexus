// KitsuNexus VRChat API facade, backed by the `vrchat` npm SDK (VRChat.js).
// GetUserByID supplies normal user tags; Get Public Profile supplies trustTags.
// OG trust ranks are resolved ONLY from PublicProfile.trustTags.

const axios = require('axios')
const core = require('./vrchatClient')
const rankEngine = require('../../ranks/rankEngine')

function mapStatus (s) {
  switch (String(s || '').toLowerCase()) {
    case 'join me': return 'join'
    case 'active': return 'active'
    case 'ask me': return 'ask'
    case 'busy': return 'busy'
    default: return 'busy'
  }
}

function parseInstance (location) {
  if (!location || location === 'offline' || location === 'traveling') return { type: location || 'offline', private: false, joinable: false }
  if (location === 'private') return { type: 'private', private: true, joinable: false }
  const m = String(location).match(/^(wrld_[^:]+):([^~]+)(~.*)?$/)
  if (!m) return { type: 'unknown', private: false, joinable: false }
  const tags = m[3] || ''
  let type = 'public'
  if (/~group\(/.test(tags)) {
    const access = (tags.match(/~groupAccessType\((\w+)\)/) || [])[1] || 'members'
    type = access === 'public' ? 'group' : (access === 'plus' ? 'group+' : 'groupMembers')
  } else if (/~private\(/.test(tags)) type = /~canRequestInvite/.test(tags) ? 'invite+' : 'invite'
  else if (/~friends\(/.test(tags)) type = 'friends'
  else if (/~hidden\(/.test(tags)) type = 'friends+'
  const priv = type === 'invite' || type === 'invite+' || type === 'groupMembers'
  return { worldId: m[1], instanceId: m[2] + tags, type, private: priv, joinable: !priv && type !== 'unknown', region: (tags.match(/~region\((\w+)\)/) || [])[1] || '' }
}

function languagesFromTags (tags) {
  return (Array.isArray(tags) ? tags : []).filter(t => typeof t === 'string' && t.startsWith('language_')).map(t => t.slice(9))
}

const TRUST_TAGS = new Set([
  'admin_moderator', 'system_troll', 'system_probable_troll',
  'system_trust_legend', 'system_trust_veteran', 'system_trust_trusted',
  'system_trust_known', 'system_trust_intermediate', 'system_trust_basic', 'system_legend'
])
function isTrustTag (tag) { return TRUST_TAGS.has(String(tag || '')) }

function normalizePublicProfile (p = {}) {
  return {
    ageVerificationStatus: p.ageVerificationStatus ?? null,
    ageVerified: p.ageVerified === true,
    backgroundType: p.backgroundType ?? null,
    badges: Array.isArray(p.badges) ? p.badges.map(b => ({
      assignedAt: b.assignedAt ?? null,
      badgeDescription: b.badgeDescription ?? '',
      badgeId: b.badgeId ?? '',
      badgeImageUrl: b.badgeImageUrl ?? '',
      badgeName: b.badgeName ?? '',
      hidden: b.hidden === true,
      isQuantifiable: b.isQuantifiable === true,
      showcased: b.showcased === true,
      updatedAt: b.updatedAt ?? null
    })) : [],
    bannerColor: p.bannerColor ?? null,
    bannerType: p.bannerType ?? null,
    bio: typeof p.bio === 'string' ? p.bio : '',
    bioLinks: Array.isArray(p.bioLinks) ? p.bioLinks.filter(Boolean) : [],
    displayName: p.displayName || '',
    hasVrcPlus: p.hasVrcPlus === true,
    iconFrame: p.iconFrame ?? null,
    iconUrl: p.iconUrl || '',
    id: p.id || '',
    isEconomyCreator: p.isEconomyCreator === true,
    languages: Array.isArray(p.languages) ? p.languages.filter(Boolean) : [],
    nameplateEffect: p.nameplateEffect ?? null,
    profileEffect: p.profileEffect ?? null,
    pronouns: typeof p.pronouns === 'string' ? p.pronouns : '',
    representedGroup: p.representedGroup ? {
      bannerUrl: p.representedGroup.bannerUrl || '',
      iconUrl: p.representedGroup.iconUrl || '',
      id: p.representedGroup.id || '',
      name: p.representedGroup.name || ''
    } : null,
    themeId: p.themeId ?? null,
    trustTags: Array.isArray(p.trustTags) ? p.trustTags.filter(t => typeof t === 'string') : []
  }
}

function mergeUserProfile (user = {}, profile = normalizePublicProfile()) {
  const userTags = Array.isArray(user.tags) ? user.tags.slice() : []
  const trustTags = profile.trustTags.slice()
  const normalTags = userTags.filter(t => !isTrustTag(t))
  const languageTags = profile.languages.map(x => String(x).startsWith('language_') ? String(x) : `language_${x}`)
  const tags = [...new Set([...normalTags, ...trustTags, ...languageTags, ...(profile.hasVrcPlus ? ['system_supporter'] : [])])]
  const verified = profile.isEconomyCreator === true
  const rawName = profile.displayName || user.displayName || ''
  return {
    ...user,
    ageVerificationStatus: profile.ageVerificationStatus ?? user.ageVerificationStatus,
    ageVerified: profile.ageVerified || user.ageVerified === true,
    backgroundType: profile.backgroundType ?? user.backgroundType,
    badges: profile.badges,
    bannerColor: profile.bannerColor ?? user.bannerColor,
    bannerType: profile.bannerType ?? user.bannerType,
    bio: profile.bio || user.bio || '',
    bioLinks: profile.bioLinks.length ? profile.bioLinks : (Array.isArray(user.bioLinks) ? user.bioLinks : []),
    displayName: verified ? `${rawName} ✓` : rawName,
    vrchatDisplayName: rawName,
    hasVrcPlus: profile.hasVrcPlus,
    iconFrame: profile.iconFrame ?? user.iconFrame,
    iconUrl: profile.iconUrl || user.iconUrl || '',
    isEconomyCreator: verified,
    economyCreatorVerified: verified,
    economyCreatorLabel: verified ? 'Economy Creator' : '',
    verifiedTick: verified ? '✓' : '',
    languages: profile.languages,
    nameplateEffect: profile.nameplateEffect ?? user.nameplateEffect,
    profileEffect: profile.profileEffect ?? user.profileEffect,
    pronouns: profile.pronouns || user.pronouns || '',
    representedGroup: profile.representedGroup,
    themeId: profile.themeId ?? user.themeId,
    trustTags,
    userTags,
    tags,
    publicProfile: profile,
    communityRank: rankEngine.estimateFromTags([...trustTags, ...(profile.hasVrcPlus ? ['system_supporter'] : [])])
  }
}

function pickUser (u = {}) {
  if (u.id) core.setCurrentUserId(u.id)
  return {
    id: u.id, displayName: u.displayName, status: u.status, statusDescription: u.statusDescription,
    bio: typeof u.bio === 'string' ? u.bio : null, pronouns: typeof u.pronouns === 'string' ? u.pronouns : null,
    bioLinks: Array.isArray(u.bioLinks) ? u.bioLinks.filter(Boolean) : [],
    userIcon: u.userIcon || u.iconUrl || u.profilePicOverride || u.currentAvatarThumbnailImageUrl || null,
    state: u.state, dateJoined: u.date_joined || null, date_joined: u.date_joined || null,
    tags: Array.isArray(u.tags) ? u.tags.slice() : [], userTags: Array.isArray(u.tags) ? u.tags.slice() : [],
    friendIds: Array.isArray(u.friends) ? u.friends.slice() : [], isEconomyCreator: u.isEconomyCreator === true
  }
}

function pickFriend (f = {}) {
  const inst = parseInstance(f.location)
  const trustTags = Array.isArray(f.trustTags) ? f.trustTags : []
  return {
    id: f.id, displayName: f.displayName, status: f.status, statusDescription: f.statusDescription,
    location: f.location, worldId: inst.worldId || '', instanceId: inst.instanceId || '', instanceType: inst.type,
    private: inst.private, joinable: inst.joinable, state: f.state, platform: f.platform,
    languages: Array.isArray(f.languages) && f.languages.length ? f.languages : languagesFromTags(f.tags),
    trustTags,
    communityRank: trustTags.length ? rankEngine.estimateFromTags([...trustTags, ...((f.tags || []).includes('system_supporter') ? ['system_supporter'] : [])]) : null,
    isEconomyCreator: f.isEconomyCreator === true, economyCreatorVerified: f.isEconomyCreator === true,
    image: f.userIcon || f.iconUrl || f.profilePicOverride || f.currentAvatarThumbnailImageUrl || ''
  }
}

async function login (username, password) {
  const user = String(username || '').trim(); const pass = String(password || '')
  if (!user || !pass) return { ok: false, error: 'Username and password are required' }
  core.clearTwoFactorMethods()
  try {
    const value = await core.getClient().login({ username: user, password: pass, twoFactorCode: '' })
    if (value && value.data && value.data.id) { core.setLoggedIn(true); return { ok: true, needs2fa: false, user: pickUser(value.data) } }
    const methods = core.getTwoFactorMethods()
    const msg = value && value.error && (value.error.message || value.error.error && value.error.error.message) || 'Login failed'
    if (methods.length || /two.?factor|2fa|totp|otp/i.test(msg)) return { ok: true, needs2fa: true, methods: methods.length ? methods : ['totp', 'emailOtp'] }
    core.setLoggedIn(false); return { ok: false, error: msg }
  } catch (e) {
    const methods = core.getTwoFactorMethods(); const msg = e && e.message || 'Login failed'
    if (methods.length || /two.?factor|2fa|totp|otp/i.test(msg)) return { ok: true, needs2fa: true, methods: methods.length ? methods : ['totp', 'emailOtp'] }
    core.setLoggedIn(false); return { ok: false, error: msg }
  }
}

async function verify2fa (code, method) {
  const clean = String(code || '').trim(); if (!clean) return { ok: false, error: '2FA code is required' }
  const m = String(method || '').toLowerCase()
  const name = m.includes('email') ? 'verify2FaEmailCode' : (m.includes('recovery') || m === 'otp' ? 'verifyRecoveryCode' : 'verify2Fa')
  const path = m.includes('email') ? 'emailotp' : (m.includes('recovery') || m === 'otp' ? 'otp' : 'totp')
  const r = await core.call(name, { body: { code: clean } }, { method: 'POST', url: `/auth/twofactorauth/${path}/verify`, body: { code: clean } }, 'Invalid 2FA code')
  if (!r.ok || !r.data || r.data.verified !== true) return { ok: false, error: r.error || 'Invalid 2FA code' }
  core.invalidate('self'); return fetchUser()
}

function fetchUser () { return core.memo('self', 20000, async () => {
  const r = await core.call('getCurrentUser', {}, { method: 'GET', url: '/auth/user' }, 'Could not fetch user')
  if (r.ok && r.data && r.data.id) { core.setLoggedIn(true); return { ok: true, user: pickUser(r.data) } }
  if (r.data && Array.isArray(r.data.requiresTwoFactorAuth)) return { ok: false, needs2fa: true, methods: r.data.requiresTwoFactorAuth }
  core.setLoggedIn(false); return { ok: false, error: r.error || 'Could not fetch user' }
}) }

function getPublicProfile (id) { return core.memo(`publicProfile:${id}`, 120000, async () => {
  const r = await core.call('getPublicProfile', { path: { userId: id } }, { method: 'GET', url: `/profile/${encodeURIComponent(id)}` }, 'Could not load public profile')
  return r.ok && r.data ? { ok: true, profile: normalizePublicProfile(r.data) } : { ok: false, error: r.error || 'Could not load public profile' }
}) }

function getUser (id) { return core.memo(`user:${id}`, 45000, async () => {
  const [u, p] = await Promise.all([
    core.call('getUser', { path: { userId: id } }, { method: 'GET', url: `/users/${encodeURIComponent(id)}` }, 'Could not load user'),
    getPublicProfile(id)
  ])
  if (!u.ok || !u.data || !u.data.id) return { ok: false, error: u.error || 'Could not load user' }
  const profile = p.ok ? p.profile : normalizePublicProfile({ id, displayName: u.data.displayName })
  return { ok: true, user: mergeUserProfile(u.data, profile), publicProfile: profile, publicProfileError: p.ok ? null : p.error }
}) }

function getFriends (offline = false) { return core.memo(`friends:${!!offline}`, offline ? 300000 : 90000, async () => {
  const all = []
  for (let offset = 0; offset < 5000; offset += 100) {
    const q = { offline: !!offline, n: 100, offset }
    const r = await core.request('GET', '/auth/user/friends', q, undefined, 'Could not list friends')
    if (!r.ok || !Array.isArray(r.data)) { if (!offset) return { ok: false, error: r.error || 'Could not list friends' }; break }
    all.push(...r.data); if (r.data.length < 100) break
  }
  return { ok: true, friends: all.map(pickFriend) }
}) }

function getAllFriends () { return core.memo('friends:all', 120000, async () => {
  const [on, off, me] = await Promise.all([getFriends(false), getFriends(true), fetchUser()])
  if (!on.ok && !off.ok) return { ok: false, error: on.error || off.error || 'Could not list friends' }
  const seen = new Set(); const online = []; const offline = []
  for (const f of on.friends || []) if (!seen.has(f.id)) { seen.add(f.id); online.push({ ...f, online: true }) }
  for (const f of off.friends || []) if (!seen.has(f.id)) { seen.add(f.id); offline.push({ ...f, online: false }) }
  const want = me && me.ok && me.user && me.user.friendIds || []
  const missing = want.filter(id => !seen.has(id)); let recovered = 0
  for (const id of missing.slice(0, 60)) {
    try {
      const r = await getUser(id); if (!r.ok || !r.user) continue
      const f = pickFriend(r.user); const isOn = (f.location && !['offline', 'traveling'].includes(f.location)) || f.state === 'online' || f.state === 'active'
      ;(isOn ? online : offline).push({ ...f, online: isOn }); seen.add(id); recovered++
    } catch (_) {}
  }
  const friends = [...online, ...offline]
  return { ok: true, friends, online, offline, total: friends.length, onlineCount: online.length, expected: want.length || friends.length, recovered, stillMissing: Math.max(0, missing.length - recovered) }
}) }

async function simple (method, url, body, message) {
  const r = await core.request(method, url, undefined, body, message)
  return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error }
}
async function sendFriendRequest (id) { const r = await simple('POST', `/user/${encodeURIComponent(id)}/friendRequest`, undefined, 'Friend request failed'); return r.ok ? { ok: true } : r }
async function requestInvite (id, slot) { const r = await simple('POST', `/requestInvite/${encodeURIComponent(id)}`, typeof slot === 'number' ? { messageSlot: slot } : {}, 'Request invite failed'); return r.ok ? { ok: true } : r }
async function unfriend (id) { const r = await simple('DELETE', `/auth/user/friends/${encodeURIComponent(id)}`, undefined, 'Unfriend failed'); return r.ok ? { ok: true } : r }
async function inviteUser (id, instanceId, slot) { const b = { instanceId }; if (typeof slot === 'number') b.messageSlot = slot; const r = await simple('POST', `/invite/${encodeURIComponent(id)}`, b, 'Invite failed'); return r.ok ? { ok: true } : r }
async function sendBoop (id, emojiId) { const r = await simple('POST', `/users/${encodeURIComponent(id)}/boop`, emojiId ? { emojiId } : {}, 'Boop failed'); return r.ok ? { ok: true } : r }

async function getUserGroups (id) {
  const r = await core.request('GET', `/users/${encodeURIComponent(id)}/groups`, undefined, undefined, 'Could not load groups')
  return r.ok && Array.isArray(r.data) ? { ok: true, groups: r.data.map(g => ({ id: g.groupId || g.id, name: g.name, icon: g.iconUrl || '', members: g.memberCount, ownerId: g.ownerId })) } : { ok: false, error: r.error || 'Could not load groups' }
}
async function getUserWorlds (id) {
  const q = { userId: id, releaseStatus: 'public', n: 50, sort: 'updated', order: 'descending' }; const r = await core.request('GET', '/worlds', q, undefined, 'Could not load worlds')
  return r.ok && Array.isArray(r.data) ? { ok: true, worlds: r.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites })) } : { ok: false, error: r.error || 'Could not load worlds' }
}

const STEAM_APPID = 438100
async function getOnlineCount () {
  const r = await core.request('GET', '/visits', undefined, undefined, 'Could not load online count'); if (!r.ok) return { ok: false, error: r.error }
  const total = Number(r.data) || 0; let steam = null
  try { const s = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${STEAM_APPID}`, { timeout: 15000 }); if (s.data && s.data.response) steam = s.data.response.player_count } catch (_) {}
  return { ok: true, count: total, total, steam, quest: steam == null ? null : Math.max(0, total - steam) }
}

async function getGroupPosts (id) { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}/posts`, { n: 10 }, undefined, 'Could not load posts'); const a = r.ok ? (Array.isArray(r.data) ? r.data : r.data && r.data.posts || []) : []; return r.ok ? { ok: true, posts: a.map(p => ({ id: p.id, title: p.title, text: p.text, createdAt: p.createdAt })) } : { ok: false, error: r.error } }
function bestFileUrl (f) { const v = (f.versions || []).filter(x => x.file && x.file.url); return v.length ? v[v.length - 1].file.url : f.thumbnailUrl || f.imageUrl || '' }
async function getInventory (tag) { const r = await core.request('GET', '/files', { tag, n: 60 }, undefined, `Could not load ${tag}`); return r.ok && Array.isArray(r.data) ? { ok: true, items: r.data.map(f => ({ id: f.id, name: f.name || tag, url: bestFileUrl(f) })).filter(i => i.url) } : { ok: false, error: r.error } }
async function getPrints () { let id = core.getCurrentUserId(); if (!id) { const u = await fetchUser(); if (!u.ok) return u; id = core.getCurrentUserId() } const r = await core.request('GET', `/prints/user/${encodeURIComponent(id)}`, { n: 60 }, undefined, 'Could not load prints'); return r.ok && Array.isArray(r.data) ? { ok: true, items: r.data.map(p => ({ id: p.id, name: p.note || 'Print', url: p.files && (p.files.image || p.files.fileUrl) || p.image || '' })).filter(i => i.url) } : { ok: false, error: r.error } }
const imageCache = new Map()
async function imageData (url) {
  if (!url) return { ok: false, error: 'no url' }; if (imageCache.has(url)) return { ok: true, data: imageCache.get(url) }
  try { const r = await axios.get(url, { headers: { 'User-Agent': `${core.APP.name}/${core.APP.version} (${core.APP.contact})`, Cookie: core.persistedCookieHeader() }, responseType: 'arraybuffer', validateStatus: () => true, timeout: 20000 }); if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` }; const out = `data:${r.headers['content-type'] || 'image/png'};base64,${Buffer.from(r.data).toString('base64')}`; if (imageCache.size < 300) imageCache.set(url, out); return { ok: true, data: out } } catch (e) { return { ok: false, error: e.message || 'Image request failed' } }
}

async function getAvatar (id) { const r = await core.request('GET', `/avatars/${encodeURIComponent(id)}`, undefined, undefined, 'Could not load avatar'); if (!r.ok || !r.data || !r.data.id) return { ok: false, error: r.error }; const a = r.data; return { ok: true, avatar: { id: a.id, name: a.name, description: a.description, image: a.thumbnailImageUrl || a.imageUrl, authorName: a.authorName, authorId: a.authorId, releaseStatus: a.releaseStatus, platforms: [...new Set((a.unityPackages || []).map(p => p.platform).filter(Boolean))], performance: [...new Set((a.unityPackages || []).map(p => p.performanceRating).filter(Boolean))], created: a.created_at, updated: a.updated_at } } }
async function getGroupMembers (id) { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}/members`, { n: 50 }, undefined, 'Could not load members'); return r.ok && Array.isArray(r.data) ? { ok: true, members: r.data.map(m => ({ id: m.user && m.user.id || m.userId, name: m.user && m.user.displayName || '', icon: m.user && (m.user.userIcon || m.user.iconUrl || m.user.currentAvatarThumbnailImageUrl) || '', roleIds: m.roleIds || [], isOwner: m.isGroupRepresentation || false })) } : { ok: false, error: r.error } }
async function getGroupRoles (id) { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}/roles`, undefined, undefined, 'Could not load roles'); return r.ok && Array.isArray(r.data) ? { ok: true, roles: r.data.map(x => ({ id: x.id, name: x.name, permissions: x.permissions || [] })) } : { ok: false, error: r.error } }
async function getModerations () { const r = await core.request('GET', '/auth/user/playermoderations', undefined, undefined, 'Could not load moderations'); return r.ok && Array.isArray(r.data) ? { ok: true, moderations: r.data.map(m => ({ id: m.id, type: m.type, targetUserId: m.targetUserId, targetName: m.targetDisplayName })) } : { ok: false, error: r.error } }

async function getMessages (type) { let id = core.getCurrentUserId(); if (!id) { const u = await fetchUser(); if (!u.ok) return u; id = core.getCurrentUserId() } const r = await core.request('GET', `/message/${encodeURIComponent(id)}/${encodeURIComponent(type)}`, undefined, undefined, 'Could not load messages'); return r.ok && Array.isArray(r.data) ? { ok: true, messages: r.data.map(m => ({ slot: m.slot, message: m.message })) } : { ok: false, error: r.error } }
async function updateMessage (type, slot, message) { let id = core.getCurrentUserId(); if (!id) { const u = await fetchUser(); if (!u.ok) return u; id = core.getCurrentUserId() } const r = await simple('PUT', `/message/${encodeURIComponent(id)}/${encodeURIComponent(type)}/${encodeURIComponent(slot)}`, { message }, 'Update message failed'); return r.ok ? { ok: true } : r }
async function getGroupGalleries (id) { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}/galleries`, undefined, undefined, 'Could not load galleries'); return r.ok && Array.isArray(r.data) ? { ok: true, galleries: r.data.map(g => ({ id: g.id, name: g.name })) } : { ok: false, error: r.error } }
async function getGroupGalleryImages (groupId, galleryId) { const r = await core.request('GET', `/groups/${encodeURIComponent(groupId)}/galleries/${encodeURIComponent(galleryId)}`, { n: 30 }, undefined, 'Could not load images'); return r.ok && Array.isArray(r.data) ? { ok: true, images: r.data.map(i => i.imageUrl).filter(Boolean) } : { ok: false, error: r.error } }
async function setNote (id, note) { const r = await simple('POST', '/userNotes', { targetUserId: id, note }, 'Save note failed'); return r.ok ? { ok: true } : r }
async function moderate (id, type) { const r = await simple('POST', '/auth/user/playermoderations', { moderated: id, type }, 'Moderation failed'); return r.ok ? { ok: true } : r }
async function unmoderate (id, type) { const r = await simple('PUT', '/auth/user/unplayermoderate', { moderated: id, type }, 'Un-moderation failed'); return r.ok ? { ok: true } : r }
async function getFavoriteFriendIds () { const r = await core.request('GET', '/favorites', { type: 'friend', n: 100 }, undefined, 'Could not load favorite friends'); if (!r.ok || !Array.isArray(r.data)) return { ok: false, error: r.error }; const groups = {}; for (const f of r.data) groups[f.favoriteId] = f.tags && f.tags[0] || 'group_0'; return { ok: true, ids: r.data.map(f => f.favoriteId), groups } }

async function updateProfile (fields) { let id = core.getCurrentUserId(); if (!id) { const u = await fetchUser(); if (!u.ok) return u; id = core.getCurrentUserId() } const r = await core.request('PUT', `/users/${encodeURIComponent(id)}`, undefined, fields, 'Profile update failed'); core.invalidate('self'); core.invalidate(`user:${id}`); core.invalidate(`publicProfile:${id}`); return r.ok && r.data ? { ok: true, user: pickUser(r.data) } : { ok: false, error: r.error } }
async function selectAvatar (id) { const r = await simple('PUT', `/avatars/${encodeURIComponent(id)}/select`, {}, 'Select avatar failed'); return r.ok ? { ok: true } : r }
async function deleteAvatar (id) { const r = await simple('DELETE', `/avatars/${encodeURIComponent(id)}`, undefined, 'Delete avatar failed'); return r.ok ? { ok: true } : r }
async function createInstance (worldId, access, region) { let me = core.getCurrentUserId(); if (!me) { const u = await fetchUser(); if (!u.ok) return u; me = core.getCurrentUserId() } const b = { worldId, region: region || 'us' }; if (access === 'public') b.type = 'public'; else if (access === 'friends+') { b.type = 'hidden'; b.ownerId = me } else if (access === 'friends') { b.type = 'friends'; b.ownerId = me } else { b.type = 'private'; b.ownerId = me; if (access === 'invite+') b.canRequestInvite = true } const r = await core.request('POST', '/instances', undefined, b, 'Create instance failed'); if (!r.ok || !r.data) return { ok: false, error: r.error }; const instanceId = r.data.instanceId || String(r.data.id || '').split(':')[1]; return { ok: true, instanceId, location: r.data.location || `${worldId}:${instanceId}`, worldId } }
async function createGroupInstance (worldId, groupId, access, region) { const b = { worldId, type: 'group', region: region || 'us', ownerId: groupId, groupAccessType: access || 'members', roleIds: [] }; const r = await core.request('POST', '/instances', undefined, b, 'Create group instance failed'); if (!r.ok || !r.data) return { ok: false, error: r.error }; const instanceId = r.data.instanceId || String(r.data.id || '').split(':')[1]; return { ok: true, instanceId, location: r.data.location || `${worldId}:${instanceId}`, worldId } }
async function inviteSelf (location) { const r = await simple('POST', `/invite/myself/to/${encodeURIComponent(location)}`, {}, 'Self-invite failed'); return r.ok ? { ok: true } : r }
async function groupInvite (groupId, userId) { const r = await simple('POST', `/groups/${encodeURIComponent(groupId)}/invites`, { userId }, 'Group invite failed'); return r.ok ? { ok: true } : r }

async function searchUsers (q) { const r = await core.request('GET', '/users', { search: q, n: 24 }, undefined, 'User search failed'); return r.ok && Array.isArray(r.data) ? { ok: true, users: r.data.map(u => ({ id: u.id, displayName: u.displayName, statusDescription: u.statusDescription, status: u.status, image: u.userIcon || u.iconUrl || u.profilePicOverride || u.currentAvatarThumbnailImageUrl || '' })) } : { ok: false, error: r.error } }
async function searchWorlds (q) { const r = await core.request('GET', '/worlds', { search: q, n: 24, sort: 'relevance', order: 'descending' }, undefined, 'World search failed'); return r.ok && Array.isArray(r.data) ? { ok: true, worlds: r.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, authorName: w.authorName, visits: w.visits, favorites: w.favorites, occupants: w.occupants })) } : { ok: false, error: r.error } }
async function searchGroups (q) { const r = await core.request('GET', '/groups', { query: q, n: 24 }, undefined, 'Group search failed'); return r.ok && Array.isArray(r.data) ? { ok: true, groups: r.data.map(g => ({ id: g.id, name: g.name, shortCode: g.shortCode, icon: g.iconUrl || '', members: g.memberCount })) } : { ok: false, error: r.error } }
function getWorld (id) { return core.memo(`world:${id}`, 300000, async () => { const r = await core.request('GET', `/worlds/${encodeURIComponent(id)}`, undefined, undefined, 'Could not load world'); return r.ok && r.data && r.data.id ? { ok: true, world: r.data } : { ok: false, error: r.error } }) }
function getWorldName (id) { if (!id || !/^wrld_/.test(id)) return Promise.resolve({ ok: false, error: 'bad id' }); return core.memo(`worldName:${id}`, 1800000, async () => { const r = await getWorld(id); return r.ok ? { ok: true, name: r.world.name || '' } : r }) }
function getGroup (id) { return core.memo(`group:${id}`, 300000, async () => { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}`, undefined, undefined, 'Could not load group'); return r.ok && r.data && r.data.id ? { ok: true, group: r.data } : { ok: false, error: r.error } }) }
function favTag (type) { return type === 'world' ? 'worlds1' : type === 'avatar' ? 'avatars1' : 'group_0' }
async function addFavorite (type, id, group) { const r = await simple('POST', '/favorites', { type, favoriteId: id, tags: [group || favTag(type)] }, 'Add favorite failed'); return r.ok ? { ok: true } : r }
async function removeFavorite (favoriteId) { const list = await core.request('GET', '/favorites', { n: 200 }, undefined, 'Could not list favorites'); const rec = list.ok && Array.isArray(list.data) ? list.data.find(f => f.favoriteId === favoriteId) : null; if (!rec) return { ok: false, error: 'Not in your favorites' }; const r = await simple('DELETE', `/favorites/${encodeURIComponent(rec.id)}`, undefined, 'Remove favorite failed'); return r.ok ? { ok: true } : r }
async function getMyWorlds () { const r = await core.request('GET', '/worlds', { user: 'me', releaseStatus: 'all', n: 100, sort: 'updated', order: 'descending' }, undefined, 'Could not load worlds'); return r.ok && Array.isArray(r.data) ? { ok: true, worlds: r.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites, releaseStatus: w.releaseStatus })) } : { ok: false, error: r.error } }
async function getMyAvatars () { const r = await core.request('GET', '/avatars', { releaseStatus: 'all', user: 'me', n: 50, sort: 'updated', order: 'descending' }, undefined, 'Could not load avatars'); return r.ok && Array.isArray(r.data) ? { ok: true, avatars: r.data.map(a => ({ id: a.id, name: a.name, image: a.thumbnailImageUrl || a.imageUrl, releaseStatus: a.releaseStatus })) } : { ok: false, error: r.error } }
async function getMutualFriends (id) { const r = await core.request('GET', `/users/${encodeURIComponent(id)}/mutuals`, { n: 100 }, undefined, 'Could not load mutual friends'); if (r.status === 403) return { ok: false, off: true, error: 'This user has Shared Connections turned off.' }; return r.ok && Array.isArray(r.data) ? { ok: true, friends: r.data.map(pickFriend) } : { ok: false, error: r.error } }
// The /worlds/favorites and /avatars/favorites endpoints return the World/Avatar objects
// themselves, which don't carry which favorite group (tags1/2/3...) each one is filed under —
// so without this, every item silently fell back to the default group ("worlds1"/"avatars1")
// and the other groups looked empty even though VRChat had items in them. The group tag only
// exists on the plain Favorite record from /favorites, so fetch that in parallel and merge by id
// (same approach VRCX uses).
async function favoriteGroupTags (type, fallback) {
  const r = await core.request('GET', '/favorites', { type, n: 100 }, undefined, 'Could not load favorites')
  const tags = {}
  if (r.ok && Array.isArray(r.data)) for (const f of r.data) tags[f.favoriteId] = (f.tags && f.tags[0]) || fallback
  return tags
}
async function getFavoriteWorlds () {
  const [favRes, tags] = await Promise.all([core.request('GET', '/worlds/favorites', { n: 100 }, undefined, 'Could not load favorites'), favoriteGroupTags('world', 'worlds1')])
  return favRes.ok && Array.isArray(favRes.data) ? { ok: true, worlds: favRes.data.map(w => ({ id: w.id, name: w.name, image: w.thumbnailImageUrl || w.imageUrl, visits: w.visits, favorites: w.favorites, group: tags[w.id] || w.favoriteGroup || Array.isArray(w.favoriteGroups) && w.favoriteGroups[0] || 'worlds1' })) } : { ok: false, error: favRes.error }
}
async function getFavoriteAvatars () {
  const [favRes, tags] = await Promise.all([core.request('GET', '/avatars/favorites', { n: 100 }, undefined, 'Could not load favorite avatars'), favoriteGroupTags('avatar', 'avatars1')])
  return favRes.ok && Array.isArray(favRes.data) ? { ok: true, avatars: favRes.data.map(a => ({ id: a.id, name: a.name, image: a.thumbnailImageUrl || a.imageUrl, releaseStatus: a.releaseStatus, group: tags[a.id] || a.favoriteGroup || Array.isArray(a.favoriteGroups) && a.favoriteGroups[0] || 'avatars1' })) } : { ok: false, error: favRes.error }
}
async function getFavoriteGroups (type = 'world') { const r = await core.request('GET', '/favorite/groups', { type, n: 25 }, undefined, 'Could not load favorite groups'); return r.ok && Array.isArray(r.data) ? { ok: true, groups: r.data.map(g => ({ name: g.name, displayName: g.displayName })) } : { ok: false, error: r.error } }
async function getMyGroups () { let id = core.getCurrentUserId(); if (!id) { const u = await fetchUser(); if (!u.ok) return u; id = core.getCurrentUserId() } return getUserGroups(id) }
async function getGroupEvents (id) { const r = await core.request('GET', `/groups/${encodeURIComponent(id)}/events`, { n: 20 }, undefined, 'Could not list events'); const a = r.ok ? (Array.isArray(r.data) ? r.data : r.data && r.data.results || []) : []; return r.ok ? { ok: true, events: a.map(e => ({ id: e.id, title: e.title || e.name, startsAt: e.startsAt || e.startTime, description: e.description, groupId: id })) } : { ok: false, error: r.error } }
function getNotifications () { return core.memo('notifs', 30000, async () => { const r = await core.request('GET', '/auth/user/notifications', { n: 100 }, undefined, 'Could not list notifications'); return r.ok && Array.isArray(r.data) ? { ok: true, notifications: r.data } : { ok: false, error: r.error } }) }
async function acceptFriendRequest (id) { const r = await simple('PUT', `/auth/user/notifications/${encodeURIComponent(id)}/accept`, undefined, 'Accept failed'); core.invalidate('notifs'); return r.ok ? { ok: true } : r }
async function hideNotification (id) { const r = await simple('PUT', `/auth/user/notifications/${encodeURIComponent(id)}/hide`, undefined, 'Dismiss failed'); core.invalidate('notifs'); return r.ok ? { ok: true } : r }
function logout () { imageCache.clear(); core.logout() }

module.exports = {
  login, verify2fa, fetchUser, mapStatus, isLoggedIn: core.isLoggedIn, logout, invalidate: core.invalidate,
  getFriends, getAllFriends, getUser, getPublicProfile, sendFriendRequest, requestInvite, unfriend, inviteUser, getUserGroups, getUserWorlds,
  getMutualFriends, getFavoriteWorlds, getFavoriteAvatars, getFavoriteGroups, sendBoop, getMyAvatars, getMyWorlds, addFavorite, removeFavorite,
  searchUsers, searchWorlds, searchGroups, getWorld, getWorldName, getGroup, parseInstance,
  updateProfile, selectAvatar, deleteAvatar, createInstance, createGroupInstance, inviteSelf, groupInvite, isRateLimited: core.isRateLimited,
  setNote, moderate, unmoderate, getFavoriteFriendIds, getOnlineCount, getGroupPosts,
  getMessages, updateMessage, getGroupGalleries, getGroupGalleryImages,
  getAvatar, getGroupMembers, getGroupRoles, getModerations,
  getInventory, getPrints, imageData,
  getMyGroups, getGroupEvents, getNotifications, acceptFriendRequest, hideNotification,
  normalizePublicProfile
}

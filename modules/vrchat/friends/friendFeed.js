// modules/vrchat/friends/friendFeed.js
// Turns VRChat friend data into two streams, like VRCX's Feed and Friend Log:
//   feed      — online / offline / GPS (world change) / status / avatar / bio
//   friendLog — friend added / removed, display-name change, trust rank change
// Fed by the pipeline websocket (live) and by the periodic full friend-list
// poll (catch-up). Both share one snapshot, so an event is logged once. The
// snapshot is persisted, so changes made while KitsuNexus was closed are
// picked up on the next launch. Pure logic — storage is injected. MAIN process.

const TRUST_ORDER = [
  ['system_trust_veteran', 'Trusted User'],
  ['system_trust_trusted', 'Known User'],
  ['system_trust_known', 'User'],
  ['system_trust_basic', 'New User']
]
function trustLevelFromTags (tags) {
  const t = new Set(Array.isArray(tags) ? tags : [])
  if (t.has('system_troll') || t.has('system_probable_troll')) return 'Nuisance'
  for (const [tag, name] of TRUST_ORDER) if (t.has(tag)) return name
  return Array.isArray(tags) ? 'Visitor' : ''
}

function pick (user) {
  if (!user || typeof user !== 'object') return {}
  const out = {}
  if (typeof user.displayName === 'string') out.displayName = user.displayName
  if (typeof user.status === 'string') out.status = user.status
  if (typeof user.statusDescription === 'string') out.statusDescription = user.statusDescription
  if (typeof user.bio === 'string') out.bio = user.bio
  const thumb = user.currentAvatarThumbnailImageUrl || user.imageUrl
  if (typeof thumb === 'string' && thumb) out.avatarThumb = thumb
  if (Array.isArray(user.tags)) out.trustLevel = trustLevelFromTags(user.tags)
  else if (typeof user.trustLevel === 'string' && user.trustLevel) out.trustLevel = user.trustLevel
  return out
}

const isRealLocation = l => typeof l === 'string' && /^wrld_/.test(l)

function createFriendFeed ({ loadSnapshot, saveSnapshot, onFeed, onFriendLog, resolveWorldName } = {}) {
  const loaded = (typeof loadSnapshot === 'function' && loadSnapshot()) || null
  const snap = new Map(loaded && typeof loaded === 'object' ? Object.entries(loaded) : [])
  let primed = snap.size > 0
  let saveTimer = null

  const save = () => {
    if (typeof saveSnapshot !== 'function') return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSnapshot(Object.fromEntries(snap)), 2000)
    if (saveTimer.unref) saveTimer.unref()
  }
  const feed = e => { if (typeof onFeed === 'function') onFeed({ ts: Date.now(), ...e }) }
  const flog = e => { if (typeof onFriendLog === 'function') onFriendLog({ ts: Date.now(), ...e }) }
  const nameOf = (id, user) => (user && user.displayName) || (snap.get(id) || {}).displayName || id

  async function gps (id, name, location) {
    let worldName = ''
    if (typeof resolveWorldName === 'function') {
      try { worldName = await resolveWorldName(location.split(':')[0]) } catch (_) {}
    }
    feed({ type: 'gps', userId: id, name, location, worldName })
  }

  // Diff profile fields of a friend we already know; logs feed + friend-log entries.
  function diffProfile (id, prev, next) {
    const name = next.displayName || prev.displayName || id
    if (next.displayName && prev.displayName && next.displayName !== prev.displayName) {
      flog({ type: 'name_change', userId: id, name: next.displayName, detail: `was "${prev.displayName}"` })
    }
    if (next.trustLevel && prev.trustLevel && next.trustLevel !== prev.trustLevel) {
      flog({ type: 'trust_change', userId: id, name, detail: `${prev.trustLevel} → ${next.trustLevel}` })
    }
    if ((next.status !== undefined && prev.status !== undefined && next.status !== prev.status) ||
        (next.statusDescription !== undefined && prev.statusDescription !== undefined && next.statusDescription !== prev.statusDescription)) {
      feed({ type: 'status', userId: id, name, status: next.status ?? prev.status, detail: next.statusDescription ?? prev.statusDescription ?? '' })
    }
    if (next.avatarThumb && prev.avatarThumb && next.avatarThumb !== prev.avatarThumb) {
      feed({ type: 'avatar', userId: id, name, detail: next.avatarThumb })
    }
    if (next.bio !== undefined && prev.bio !== undefined && next.bio !== prev.bio) {
      feed({ type: 'bio', userId: id, name, detail: next.bio })
    }
  }

  function upsert (id, user, extra = {}) {
    const prev = snap.get(id) || {}
    const next = { ...prev, ...pick(user), ...extra }
    snap.set(id, next)
    save()
    return { prev, next }
  }

  // Pipeline event -> feed / friend log.
  function handlePipeline (type, c = {}) {
    const id = c.userId || (c.user && c.user.id)
    if (!id) return
    switch (type) {
      case 'friend-online': {
        const { prev, next } = upsert(id, c.user, { online: true, location: c.location || '' })
        if (prev.displayName) diffProfile(id, prev, next)
        feed({ type: 'online', userId: id, name: nameOf(id, c.user), location: c.location || '', platform: c.platform || '' })
        if (isRealLocation(c.location)) gps(id, nameOf(id, c.user), c.location)
        return
      }
      case 'friend-offline': {
        const prev = snap.get(id) || {}
        upsert(id, null, { online: false, location: 'offline' })
        if (prev.online !== false) feed({ type: 'offline', userId: id, name: nameOf(id), platform: c.platform || '' })
        return
      }
      case 'friend-location': {
        const loc = c.location === 'traveling' ? (c.travelingToLocation || '') : (c.location || '')
        if (!loc || loc === 'traveling') return
        const prev = snap.get(id) || {}
        const { next } = upsert(id, c.user, { online: true, location: loc })
        if (prev.displayName) diffProfile(id, prev, next)
        if (prev.location === loc) return
        if (isRealLocation(loc)) gps(id, nameOf(id, c.user), loc)
        else if (loc === 'private') feed({ type: 'gps', userId: id, name: nameOf(id, c.user), location: 'private', worldName: 'Private' })
        return
      }
      case 'friend-update':
      case 'friend-active': {
        const prev = snap.get(id) || {}
        const { next } = upsert(id, c.user)
        if (prev.displayName) diffProfile(id, prev, next)
        return
      }
      case 'friend-add': {
        if (!snap.has(id)) flog({ type: 'friend_add', userId: id, name: nameOf(id, c.user), detail: 'New friend' })
        upsert(id, c.user, { friend: true })
        return
      }
      case 'friend-delete': {
        if (snap.has(id)) { flog({ type: 'friend_remove', userId: id, name: nameOf(id), detail: 'No longer friends' }); snap.delete(id); save() }
      }
    }
  }

  // Full friend list (periodic poll) -> catch-up adds/removes/renames/trust.
  // `friends` = [{ id, displayName, trustLevel?, status?, statusDescription? }]
  function reconcile (friends) {
    if (!Array.isArray(friends)) return
    const seen = new Set()
    for (const f of friends) {
      if (!f || !f.id) continue
      seen.add(f.id)
      const had = snap.has(f.id)
      const prev = snap.get(f.id) || {}
      const fields = pick(f)
      // the poll's status data is less reliable than the live feed: only diff names + trust
      const next = { ...prev, ...fields }
      snap.set(f.id, next)
      if (!primed) continue
      if (!had) flog({ type: 'friend_add', userId: f.id, name: f.displayName || f.id, detail: 'New friend' })
      else {
        if (fields.displayName && prev.displayName && fields.displayName !== prev.displayName) flog({ type: 'name_change', userId: f.id, name: fields.displayName, detail: `was "${prev.displayName}"` })
        if (fields.trustLevel && prev.trustLevel && fields.trustLevel !== prev.trustLevel) flog({ type: 'trust_change', userId: f.id, name: next.displayName || f.id, detail: `${prev.trustLevel} → ${fields.trustLevel}` })
      }
    }
    if (primed) {
      for (const [id, v] of [...snap]) if (!seen.has(id)) { flog({ type: 'friend_remove', userId: id, name: v.displayName || id, detail: 'No longer friends' }); snap.delete(id) }
    } else {
      for (const id of [...snap.keys()]) if (!seen.has(id)) snap.delete(id)
    }
    primed = true
    save()
  }

  return { handlePipeline, reconcile, get: id => (snap.has(id) ? { ...snap.get(id) } : null), size: () => snap.size, flush: () => { if (typeof saveSnapshot === 'function') saveSnapshot(Object.fromEntries(snap)) } }
}

module.exports = { createFriendFeed, trustLevelFromTags }

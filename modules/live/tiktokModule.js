// modules/live/tiktokModule.js
// TikTok LIVE follower counter (tiktok-live-connector v2). Connects to a creator's
// live room and reports total followers + session new-follows, viewers and likes.
// Runs in the MAIN process.
//
// IMPORTANT: tiktok-live-connector does NOT talk to TikTok directly - it routes the
// webcast request through an external signing service (Euler Stream). Anonymous
// signing is heavily rate-limited and can fail; for reliable connects, get a FREE
// API key at https://www.eulerstream.com and set it in the Live tab. The old
// "SignatureError 404" came from the deprecated v1 signing endpoint.

const axios = require('axios')

let TikTokLiveConnection, WebcastEvent, ControlEvent, SignConfig
try {
  ({ TikTokLiveConnection, WebcastEvent, ControlEvent, SignConfig } = require('tiktok-live-connector'))
} catch (err) {
  console.warn('tiktok-live-connector not installed yet:', err.message)
}

/* ------------------------------------------------------------------ */
/* Follower count WITHOUT being live - reads the public profile page.   */
/* tiktok-live-connector needs the creator to be live; this does not.   */
/* ------------------------------------------------------------------ */

let followersTimer = null
let followersUser = ''
const followersState = { connected: false, username: '', followers: 0, likes: 0, videos: 0, error: '', at: 0 }

function emitFollowers () {
  followersState.at = Date.now()
  if (typeof onFollowersUpdate === 'function') onFollowersUpdate({ ...followersState })
}
let onFollowersUpdate = null

// Pull follower/like/video counts from the TikTok profile HTML.
async function fetchProfileStats (user) {
  const handle = String(user || '').trim().replace(/^@/, '')
  const res = await axios.get(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
    timeout: 12000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  })
  const html = res.data

  // TikTok embeds page data as JSON in a script tag. Parse the modern one first.
  const tryParse = re => {
    const m = typeof html === 'string' ? html.match(re) : null
    if (!m) return null
    try { return JSON.parse(m[1]) } catch (_) { return null }
  }

  // 1) __UNIVERSAL_DATA_FOR_REHYDRATION__
  const universal = tryParse(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
  let stats = universal?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.stats ||
    universal?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.statsV2

  // 2) Legacy SIGI_STATE fallback
  if (!stats) {
    const sigi = tryParse(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/)
    const userModule = sigi?.UserModule?.stats
    if (userModule) stats = userModule[Object.keys(userModule)[0]]
  }

  if (!stats) throw new Error('Could not read profile stats (TikTok layout changed or blocked)')

  const num = v => Number(v) || 0
  return {
    followers: num(stats.followerCount),
    likes: num(stats.heartCount ?? stats.heart),
    videos: num(stats.videoCount)
  }
}

async function tickFollowers () {
  try {
    const s = await fetchProfileStats(followersUser)
    followersState.followers = s.followers
    followersState.likes = s.likes
    followersState.videos = s.videos
    followersState.connected = true
    followersState.error = ''
    emitFollowers()
  } catch (err) {
    followersState.connected = false
    followersState.error = err?.response?.status === 404 ? 'User not found' : err.message
    emitFollowers()
  }
}

function startTikTokFollowers (user, listener, intervalMs = 120000) {
  onFollowersUpdate = listener
  followersUser = String(user || '').trim().replace(/^@/, '')
  followersState.username = followersUser
  stopTikTokFollowers()
  if (!followersUser) { followersState.error = 'Enter a TikTok username'; emitFollowers(); return }
  tickFollowers()
  followersTimer = setInterval(tickFollowers, Math.max(60000, intervalMs))
}

function stopTikTokFollowers () {
  if (followersTimer) { clearInterval(followersTimer); followersTimer = null }
}

let conn = null
let onUpdate = null
let roomInfoTimer = null
// Bumped on every connect/disconnect so a slow connect() that resolves after a
// newer connect (or a disconnect) doesn't start an orphaned room-info poll.
let connectGeneration = 0
let username = ''

const state = {
  connected: false,
  username: '',
  followers: 0, // streamer total followers (from room info)
  newFollows: 0, // followers gained this session (from follow events)
  viewers: 0,
  likes: 0,
  error: ''
}

function emit () {
  if (typeof onUpdate === 'function') onUpdate({ ...state, at: Date.now() })
}

function readFollowerCount (roomInfo) {
  // Field location shifts across TikTok payloads; try the known spots.
  return (
    roomInfo?.owner?.follow_info?.follower_count ??
    roomInfo?.owner?.followInfo?.followerCount ??
    roomInfo?.followers ??
    state.followers ??
    0
  )
}

async function pollRoomInfo () {
  if (!conn) return
  try {
    const info = await conn.fetchRoomInfo()
    const followers = readFollowerCount(info)
    if (Number.isFinite(followers) && followers > 0) state.followers = followers
    const viewers = info?.user_count ?? info?.viewerCount
    if (Number.isFinite(viewers)) state.viewers = viewers
    emit()
  } catch (err) {
    console.warn('TikTok room info error:', err.message)
  }
}

function wireEvents () {
  conn.on(ControlEvent.CONNECTED, () => { state.connected = true; emit() })
  conn.on(ControlEvent.DISCONNECTED, () => { state.connected = false; emit() })
  conn.on(ControlEvent.ERROR, err => { console.warn('TikTok error:', err?.message || err) })

  conn.on(WebcastEvent.FOLLOW, () => {
    state.newFollows += 1
    state.followers += 1
    emit()
  })
  conn.on(WebcastEvent.ROOM_USER, data => {
    if (Number.isFinite(data?.viewerCount)) { state.viewers = data.viewerCount; emit() }
  })
  conn.on(WebcastEvent.LIKE, data => {
    const total = data?.totalLikeCount ?? data?.likeCount
    if (Number.isFinite(total)) { state.likes = total; emit() }
  })
  conn.on(WebcastEvent.STREAM_END, () => {
    state.connected = false
    state.error = 'Stream ended'
    emit()
  })
}

async function connectTikTok (user, listener, signApiKey = '') {
  onUpdate = listener
  username = String(user || '').trim().replace(/^@/, '')

  if (!TikTokLiveConnection) {
    state.error = 'tiktok-live-connector not installed (run npm install)'
    emit(); return
  }
  if (!username) { state.error = 'Enter a TikTok username'; emit(); return }

  disconnectTikTok()
  const generation = ++connectGeneration

  // Apply the optional Euler Stream sign key globally (improves reliability).
  if (signApiKey && SignConfig) SignConfig.apiKey = String(signApiKey).trim()

  state.username = username
  state.newFollows = 0
  state.error = ''

  // preferConnectFromRoomData lets us read room/follower info over HTTP even when
  // the realtime WebSocket can't upgrade (the "Unexpected server response: 200"
  // you get on the free signing tier).
  conn = new TikTokLiveConnection(username, {
    ...(signApiKey ? { signApiKey } : {}),
    fetchRoomInfoOnConnect: true
  })
  wireEvents()

  try {
    const connectState = await conn.connect()
    if (generation !== connectGeneration) return // superseded
    state.connected = true
    state.followers = readFollowerCount(connectState?.roomInfo)
    state.viewers = connectState?.roomInfo?.user_count ?? state.viewers
    emit()

    await pollRoomInfo()
    if (generation !== connectGeneration) return
    roomInfoTimer = setInterval(pollRoomInfo, 30000)
  } catch (err) {
    if (generation !== connectGeneration) return
    state.connected = false
    const msg = err?.exception?.message || err?.message || String(err)
    state.error = /sign/i.test(msg)
      ? 'Signing failed - add a free Euler Stream API key (see Live tab)'
      : (/offline|not.*found|404.*room|LIVE/i.test(msg) ? 'User is not live right now' : msg)
    emit()
  }
}

function disconnectTikTok () {
  connectGeneration++
  if (roomInfoTimer) { clearInterval(roomInfoTimer); roomInfoTimer = null }
  if (conn) {
    try { conn.disconnect() } catch (_) { /* ignore */ }
    conn = null
  }
  state.connected = false
  emit()
}

function getTikTokState () { return { ...state } }

module.exports = {
  connectTikTok,
  disconnectTikTok,
  getTikTokState,
  startTikTokFollowers,
  stopTikTokFollowers
}

// modules/live/twitch/followers.js
// Twitch follower counter via the Helix API, with automatic OAuth token refresh.
//
// Uses the shared OAuth provider's access token plus an optional refresh token. When
// Helix returns 401 (expired), we silently
// refresh the access token and retry, and emit the renewed tokens so the renderer
// can persist them. Runs in the MAIN process.

const axios = require('axios')

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

let pollTimer = null
let active = false
let onUpdate = null
let clientId = ''
let clientSecret = ''
let token = ''
let refreshToken = ''
let login = ''
let broadcasterId = ''
let generation = 0

const state = {
  connected: false,
  login: '',
  followers: 0,
  error: '',
  // renewed credentials (renderer persists these when they change)
  token: '',
  refreshToken: '',
  at: 0
}

function emit () {
  state.at = Date.now()
  state.token = token
  state.refreshToken = refreshToken
  if (typeof onUpdate === 'function') onUpdate({ ...state })
}

function authHeaders () {
  return { 'Client-ID': clientId, Authorization: `Bearer ${token.replace(/^oauth:/i, '')}` }
}

async function refreshAccessToken (run) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Cannot refresh: missing client secret / refresh token')
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token', refresh_token: refreshToken
  }).toString()
  const res = await axios.post(TOKEN_URL, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000
  })
  if (run !== generation) return
  token = res.data.access_token
  refreshToken = res.data.refresh_token || refreshToken
}

// Run a Helix request; on 401 refresh the token once and retry.
async function helix (fn, run) {
  try {
    return await fn()
  } catch (err) {
    if (run === generation && err?.response?.status === 401 && refreshToken) {
      await refreshAccessToken(run)
      if (run !== generation) return null
      return await fn()
    }
    throw err
  }
}

async function resolveBroadcasterId (run) {
  const res = await helix(() => axios.get('https://api.twitch.tv/helix/users', {
    params: { login }, headers: authHeaders(), timeout: 8000
  }), run)
  if (run !== generation) return ''
  const user = res.data?.data?.[0]
  if (!user) throw new Error(`Twitch user "${login}" not found`)
  return user.id
}

async function fetchFollowerTotal (run) {
  const res = await helix(() => axios.get('https://api.twitch.tv/helix/channels/followers', {
    params: { broadcaster_id: broadcasterId, first: 1 }, headers: authHeaders(), timeout: 8000
  }), run)
  if (run !== generation) return null
  return res.data?.total ?? 0
}

async function tick (run) {
  try {
    if (!broadcasterId) {
      const resolved = await resolveBroadcasterId(run)
      if (run !== generation) return
      broadcasterId = resolved
    }
    const followers = await fetchFollowerTotal(run)
    if (run !== generation) return
    state.followers = followers
    state.connected = true
    state.error = ''
    emit()
  } catch (err) {
    if (run !== generation) return
    state.connected = false
    state.error = err?.response?.data?.message || err.message
    emit()
  }
}

async function startTwitch ({ clientId: cid, clientSecret: secret, token: tok, refreshToken: refresh, login: channel }, listener, intervalMs = 60000) {
  stopTwitch()
  onUpdate = listener
  clientId = String(cid || '').trim()
  clientSecret = String(secret || '').trim()
  token = String(tok || '').trim()
  refreshToken = String(refresh || '').trim()
  login = String(channel || '').trim().toLowerCase().replace(/^#/, '')
  broadcasterId = ''
  state.login = login

  const run = generation

  if (!clientId || !token || !login) {
    state.error = 'Configure the channel and authorize Twitch in OAuth Accounts first'
    state.connected = false
    emit()
    return
  }

  active = true
  await tick(run)
  if (run === generation) pollTimer = setInterval(() => tick(run), Math.max(30000, intervalMs))
}

function stopTwitch () {
  generation++
  active = false
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  state.connected = false
  state.token = ''
  state.refreshToken = ''
  token = ''
  refreshToken = ''
  clientSecret = ''
}

function getTwitchState () { return { ...state, running: active } }

module.exports = { startTwitch, stopTwitch, getTwitchState }

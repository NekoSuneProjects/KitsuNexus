// modules/favorites/cloudSync.js
// Optional, opt-in sync of Local Favorites (modules/favorites/localFavoritesDb.js) against a
// self-hosted kitsunexus-server instance. Nothing here runs unless the user pairs a device in
// Settings > Cloud Sync — local favorites work fully offline without this. Runs in MAIN.

const settings = require('../../settings')
const localFavoritesDb = require('./localFavoritesDb')
const gamelog = require('../history/gamelog')

function cfg () {
  return {
    baseUrl: (settings.get('cloudSync.baseUrl', '') || '').replace(/\/+$/, ''),
    token: settings.get('cloudSync.token', ''),
    deviceId: settings.get('cloudSync.deviceId', ''),
    enabled: !!settings.get('cloudSync.enabled', false),
    lastSyncAt: settings.get('cloudSync.lastSyncAt', 0),
    // World-visit history sync is a separate opt-in from Favorites sync — someone may want to
    // back up favorites without also uploading their whole play history, or vice versa.
    historyEnabled: !!settings.get('cloudSync.historyEnabled', false),
    historyLastSyncAt: settings.get('cloudSync.historyLastSyncAt', 0),
    overlayUrl: settings.get('cloudSync.overlayUrl', ''),
  }
}

function isPaired () { const c = cfg(); return !!(c.baseUrl && c.token) }
function status () {
  const c = cfg()
  return { paired: isPaired(), baseUrl: c.baseUrl, enabled: c.enabled, lastSyncAt: c.lastSyncAt, historyEnabled: c.historyEnabled, historyLastSyncAt: c.historyLastSyncAt, role: settings.get('cloudSync.role', ''), overlayUrl: c.overlayUrl }
}

// The KitsuNexus account role (owner/user) of whoever this device is paired to — cached from
// GET /api/me so app features that check "is this the project owner" (e.g. the VRC+ gate on
// avatar Local Favorites) work offline between syncs without re-hitting the server every time.
// This is a KitsuNexus-server account role, unrelated to the VRChat account's own VRC+ status.
async function refreshMe () {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  try {
    const r = await fetch(`${c.baseUrl}/api/me`, { headers: { Authorization: `Bearer ${c.token}` } })
    const data = await r.json()
    if (r.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!r.ok || !data.ok) return { ok: false, error: data.error || `Server returned ${r.status}` }
    settings.set('cloudSync.role', data.role || '')
    return { ok: true, role: data.role, displayName: data.displayName }
  } catch (err) { return { ok: false, error: 'Could not reach server: ' + err.message } }
}
function isOwner () { return isPaired() && settings.get('cloudSync.role', '') === 'owner' }

async function startPairing (baseUrl, deviceName) {
  const url = String(baseUrl || '').replace(/\/+$/, '')
  if (!url) return { ok: false, error: 'Enter your server URL first' }
  try {
    const r = await fetch(`${url}/api/pairing/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: deviceName || 'KitsuNexus Desktop' }) })
    const data = await r.json()
    if (!r.ok || !data.ok) return { ok: false, error: data.error || `Server returned ${r.status}` }
    settings.set('cloudSync.baseUrl', url)
    settings.set('cloudSync.deviceId', data.deviceId)
    return { ok: true, code: data.code, expiresAt: data.expiresAt }
  } catch (err) { return { ok: false, error: 'Could not reach server: ' + err.message } }
}

// Call repeatedly (e.g. every 3s) from the renderer while the pairing dialog is open.
async function pollPairing () {
  const c = cfg()
  if (!c.baseUrl || !c.deviceId) return { ok: false, error: 'No pairing in progress' }
  try {
    const r = await fetch(`${c.baseUrl}/api/pairing/poll/${encodeURIComponent(c.deviceId)}`)
    const data = await r.json()
    if (!r.ok || !data.ok) return { ok: false, error: data.error || `Server returned ${r.status}` }
    if (data.paired && data.token) {
      settings.set('cloudSync.token', data.token)
      settings.set('cloudSync.enabled', true)
      settings.set('cloudSync.lastSyncAt', 0)
      refreshMe().catch(() => {})
      return { ok: true, paired: true }
    }
    return { ok: true, paired: false, expired: !!data.expired }
  } catch (err) { return { ok: false, error: 'Could not reach server: ' + err.message } }
}

function disconnect () {
  settings.set('cloudSync.token', '')
  settings.set('cloudSync.deviceId', '')
  settings.set('cloudSync.enabled', false)
  settings.set('cloudSync.lastSyncAt', 0)
  settings.set('cloudSync.historyEnabled', false)
  settings.set('cloudSync.historyLastSyncAt', 0)
  settings.set('cloudSync.role', '')
  settings.set('cloudSync.overlayUrl', '')
  return { ok: true }
}

function setEnabled (enabled) { settings.set('cloudSync.enabled', !!enabled); return status() }
function setHistoryEnabled (enabled) { settings.set('cloudSync.historyEnabled', !!enabled); return status() }

const toRemote = f => ({ type: f.type, vrchatId: f.vrchat_id, displayName: f.display_name, imageUrl: f.image_url, note: f.note, collection: f.collection, updatedAt: f.updated_at, deletedAt: f.deleted_at || null })
const toLocal = f => ({ type: f.type, vrchat_id: f.vrchatId, display_name: f.displayName, image_url: f.imageUrl, note: f.note, collection: f.collection, updated_at: f.updatedAt, deleted_at: f.deletedAt || null })

let syncing = false
async function syncNow () {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  if (syncing) return { ok: false, error: 'Sync already in progress' }
  syncing = true
  try {
    const headers = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }
    const changed = localFavoritesDb.listChangedSince(c.lastSyncAt).map(toRemote)
    if (changed.length) {
      const pushRes = await fetch(`${c.baseUrl}/api/favorites/sync`, { method: 'POST', headers, body: JSON.stringify({ favorites: changed }) })
      if (pushRes.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
      if (!pushRes.ok) return { ok: false, error: `Push failed (${pushRes.status})` }
    }
    const pullRes = await fetch(`${c.baseUrl}/api/favorites/sync?since=${c.lastSyncAt}`, { headers })
    if (pullRes.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!pullRes.ok) return { ok: false, error: `Pull failed (${pullRes.status})` }
    const pulled = await pullRes.json()
    for (const item of pulled.favorites || []) localFavoritesDb.mergeRemote(toLocal(item))
    const newWatermark = pulled.serverTime || Date.now()
    settings.set('cloudSync.lastSyncAt', newWatermark)
    return { ok: true, pushed: changed.length, pulled: (pulled.favorites || []).length }
  } catch (err) {
    return { ok: false, error: 'Could not reach server: ' + err.message }
  } finally { syncing = false }
}

let syncingHistory = false
async function syncWorldHistory () {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  if (syncingHistory) return { ok: false, error: 'History sync already in progress' }
  syncingHistory = true
  try {
    const headers = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }
    const changed = gamelog.listWorldVisitsSince(c.historyLastSyncAt).map(e => ({ worldId: e.world_id, worldName: e.name, visitedAt: e.ts }))
    if (changed.length) {
      const pushRes = await fetch(`${c.baseUrl}/api/history/worlds/sync`, { method: 'POST', headers, body: JSON.stringify({ visits: changed }) })
      if (pushRes.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
      if (!pushRes.ok) return { ok: false, error: `Push failed (${pushRes.status})` }
    }
    const pullRes = await fetch(`${c.baseUrl}/api/history/worlds/sync?since=${c.historyLastSyncAt}`, { headers })
    if (pullRes.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!pullRes.ok) return { ok: false, error: `Pull failed (${pullRes.status})` }
    const pulled = await pullRes.json()
    for (const v of pulled.visits || []) gamelog.mergeWorldVisit(v.worldId, v.worldName, v.visitedAt)
    settings.set('cloudSync.historyLastSyncAt', pulled.serverTime || Date.now())
    return { ok: true, pushed: changed.length, pulled: (pulled.visits || []).length }
  } catch (err) {
    return { ok: false, error: 'Could not reach server: ' + err.message }
  } finally { syncingHistory = false }
}

// Push the current "now playing" snapshot to this account's overlay (kitsunexus-server's public
// /overlay/<id> page) — replaces the old local overlay HTTP server. `getContext` is the same
// media-provider function (modules/media/nowPlaying's getNowPlaying) the local overlay used to
// poll directly; last-write-wins server-side, so it's fine if multiple paired devices push.
async function pushOverlay (getContext) {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  try {
    const media = await getContext()
    const res = await fetch(`${c.baseUrl}/api/overlay/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(media || {}),
    })
    if (res.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!res.ok) return { ok: false, error: `Push failed (${res.status})` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'Could not reach server: ' + err.message }
  }
}

// Fetches (and caches) this account's public overlay URL — cached so the Settings ▸ Overlay
// page has something to show instantly, refreshed from the server whenever that page is opened.
async function getOverlayUrl () {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  try {
    const res = await fetch(`${c.baseUrl}/api/overlay/mine`, { headers: { Authorization: `Bearer ${c.token}` } })
    const data = await res.json()
    if (res.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `Server returned ${res.status}` }
    settings.set('cloudSync.overlayUrl', data.url)
    return { ok: true, url: data.url }
  } catch (err) { return { ok: false, error: 'Could not reach server: ' + err.message } }
}

// Pushes the locally-computed Community Rank up to the server, which is what actually backs a
// real cross-user leaderboard (a single install's own local rankDb.js sqlite file can only ever
// have one row — itself) and drives Discord role sync (kitsunexus-server's services/
// discordRankSync.js) if this account is linked to Discord there.
async function pushRank (rankKey, finalScore, tier) {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  try {
    const res = await fetch(`${c.baseUrl}/api/ranks/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rankKey, finalScore, tier }),
    })
    if (res.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!res.ok) return { ok: false, error: `Push failed (${res.status})` }
    return await res.json()
  } catch (err) {
    return { ok: false, error: 'Could not reach server: ' + err.message }
  }
}

// The real leaderboard — server-side across every user who's ever pushed a rank, unlike the
// old local-only one (modules/ranks/rankDb.js's leaderboard()) which could only ever list the
// single account on this one install.
async function getLeaderboard (limit) {
  const c = cfg()
  if (!c.baseUrl || !c.token) return { ok: false, error: 'Not connected to a server' }
  try {
    const res = await fetch(`${c.baseUrl}/api/ranks/leaderboard${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`, { headers: { Authorization: `Bearer ${c.token}` } })
    const data = await res.json()
    if (res.status === 401) { disconnect(); return { ok: false, error: 'Device was disconnected on the server — pair again.' } }
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `Server returned ${res.status}` }
    return data
  } catch (err) { return { ok: false, error: 'Could not reach server: ' + err.message } }
}

module.exports = { status, startPairing, pollPairing, disconnect, setEnabled, setHistoryEnabled, syncNow, syncWorldHistory, isPaired, refreshMe, isOwner, pushOverlay, getOverlayUrl, pushRank, getLeaderboard }

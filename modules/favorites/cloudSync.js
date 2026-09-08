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
  }
}

function isPaired () { const c = cfg(); return !!(c.baseUrl && c.token) }
function status () {
  const c = cfg()
  return { paired: isPaired(), baseUrl: c.baseUrl, enabled: c.enabled, lastSyncAt: c.lastSyncAt, historyEnabled: c.historyEnabled, historyLastSyncAt: c.historyLastSyncAt }
}

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

module.exports = { status, startPairing, pollPairing, disconnect, setEnabled, setHistoryEnabled, syncNow, syncWorldHistory, isPaired }

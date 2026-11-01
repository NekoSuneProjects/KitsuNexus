'use strict'
// SteamVR device monitor. Optional local native helper outputs one JSON object per invocation.
// No VRChat injection or remote telemetry. A missing helper is reported as unavailable.
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
let onUpdate = null
let pollTimer = null
let inFlight = false
let last = { available: false, devices: [], at: 0, reason: 'OpenVR helper not installed' }
const ROLES = new Set(['hmd', 'left', 'right', 'controller', 'tracker', 'base-station', 'other'])
function helperPath () {
  const configured = process.env.KITSUNEXUS_OPENVR_HELPER
  if (configured && path.isAbsolute(configured)) return configured
  return path.join(__dirname, 'native', process.platform === 'win32' ? 'kitsunexus-openvr.exe' : 'kitsunexus-openvr')
}
function sanitize (data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.devices)) throw new Error('Invalid OpenVR helper response')
  return {
    available: data.available === true,
    devices: data.devices.slice(0, 64).filter(d => d && typeof d === 'object').map(d => ({
      role: ROLES.has(d.role) ? d.role : 'other',
      name: String(d.name || '').slice(0, 100),
      battery: typeof d.battery === 'number' && Number.isFinite(d.battery) ? Math.max(0, Math.min(1, d.battery)) : null,
      charging: typeof d.charging === 'boolean' ? d.charging : null,
      connected: d.connected === true,
      tracked: typeof d.tracked === 'boolean' ? d.tracked : null,
      proximity: typeof d.proximity === 'boolean' ? d.proximity : null
    })),
    at: Date.now(),
    reason: data.available === true ? null : String(data.reason || 'SteamVR unavailable').slice(0, 160)
  }
}
function publish (value) {
  last = value
  if (typeof onUpdate === 'function') onUpdate(getVrBattery())
}
function tick () {
  if (inFlight) return
  const helper = helperPath()
  if (!fs.existsSync(helper)) {
    publish({ available: false, devices: [], at: Date.now(), reason: 'OpenVR helper not installed' })
    return
  }
  inFlight = true
  execFile(helper, ['--json'], { timeout: 4000, maxBuffer: 128 * 1024, windowsHide: true }, (err, stdout) => {
    inFlight = false
    if (err) {
      publish({ available: false, devices: [], at: Date.now(), reason: 'OpenVR helper failed or SteamVR disconnected' })
      return
    }
    try { publish(sanitize(JSON.parse(stdout))) } catch (_) {
      publish({ available: false, devices: [], at: Date.now(), reason: 'Invalid OpenVR helper response' })
    }
  })
}
function startVrBattery (listener, intervalMs = 15000) {
  stopVrBattery()
  onUpdate = typeof listener === 'function' ? listener : null
  tick()
  pollTimer = setInterval(tick, Math.max(5000, Number(intervalMs) || 15000))
}
function stopVrBattery () {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  onUpdate = null
}
function getVrBattery () {
  return { ...last, devices: last.devices.map(d => ({ ...d })) }
}
module.exports = { startVrBattery, stopVrBattery, getVrBattery, sanitize }

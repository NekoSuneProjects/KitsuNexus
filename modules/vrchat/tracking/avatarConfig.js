// modules/vrchat/tracking/avatarConfig.js
// Finds the current avatar's OSC config — the JSON VRChat writes to
//   %LOCALAPPDATA%Low\VRChat\VRChat\OSC\usr_…\Avatars\avtr_….json
// — and returns the parameters that can be set over OSC (those with an
// `input` address), like VRCFaceTracking's AvatarConfigFileParser. MAIN process.

const fs = require('fs')
const os = require('os')
const path = require('path')

const OSC_DIR = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat', 'OSC')

function parseConfig (text) {
  let cfg
  try { cfg = JSON.parse(String(text).replace(/^﻿/, '')) } catch (_) { return null }
  if (!cfg || typeof cfg.id !== 'string') return null
  const parameters = (Array.isArray(cfg.parameters) ? cfg.parameters : [])
    .filter(p => p && p.input && typeof p.input.address === 'string')
    .map(p => ({ name: String(p.name || ''), address: p.input.address, type: String(p.input.type || '') }))
  return { id: cfg.id, name: String(cfg.name || ''), fullFaceTracking: cfg.fullFaceTracking === true, parameters }
}

// Look the avatar up across every user folder; newest file wins if duplicated.
function findAvatarConfig (avatarId, dir = OSC_DIR) {
  if (!/^avtr_[\w-]+$/.test(String(avatarId || ''))) return null
  let users = []
  try { users = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) } catch (_) { return null }
  let best = null; let bestTime = -1
  for (const u of users) {
    const file = path.join(dir, u, 'Avatars', `${avatarId}.json`)
    let st; try { st = fs.statSync(file) } catch (_) { continue }
    if (st.mtimeMs > bestTime) { bestTime = st.mtimeMs; best = file }
  }
  if (!best) return null
  try { return parseConfig(fs.readFileSync(best, 'utf8')) } catch (_) { return null }
}

module.exports = { findAvatarConfig, parseConfig, OSC_DIR }

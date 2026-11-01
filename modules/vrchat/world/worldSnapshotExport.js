'use strict'

// Export only user-visible, locally observed world and player metadata.
// No credentials, cookies, session tokens or hidden VRChat data.
function safeCsv (value) {
  const raw = String(value == null ? '' : value)
  const guarded = /^[\s]*[=+@\-\t\r]/.test(raw) ? "'" + raw : raw
  return '"' + guarded.replace(/"/g, '""') + '"'
}
function snapshot (world = {}, now = new Date()) {
  const players = Array.isArray(world.players) ? world.players.filter(x => typeof x === 'string').slice(0, 200) : []
  return {
    schema: 'kitsunexus-world-snapshot-v1',
    recordedAt: now.toISOString(),
    worldName: String(world.worldName || '').slice(0, 256),
    worldId: String(world.worldId || '').slice(0, 120),
    instanceId: String(world.instanceId || '').slice(0, 160),
    players
  }
}
function toCsv (data) {
  const header = ['recordedAt', 'worldName', 'worldId', 'instanceId', 'player']
  const rows = (data.players.length ? data.players : ['']).map(name =>
    [data.recordedAt, data.worldName, data.worldId, data.instanceId, name].map(safeCsv).join(','))
  return [header.join(','), ...rows].join('\r\n') + '\r\n'
}
module.exports = { snapshot, toCsv, safeCsv }

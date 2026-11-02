'use strict'
const clean = value => String(value || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 160)
function parsePortalEvent (line) {
  if (/\[PortalManager\] Received portal destroy event\.\s*$/.test(line)) return { name: 'Portal', detail: 'Portal removed or expired', confirmedPlacement: false }
  if (/\[PortalManager\] Pending portal request fulfilled\.\s*$/.test(line)) return { name: 'Portal', detail: 'Portal request completed', confirmedPlacement: false }
  const named = line.match(/\[Behaviour\] (.+?) (?:has )?dropped a portal[.!]?\s*$/i)
  return named ? { name: clean(named[1]), detail: 'Created a portal', confirmedPlacement: true } : null
}
class ActivityEvents {
  constructor () { this.sequence = 0; this.events = []; this.players = new Set(); this.avatars = new Map() }
  add (kind, name, detail = '') {
    this.events.push({ id: ++this.sequence, at: Date.now(), kind, name: clean(name), detail: clean(detail) })
    this.events = this.events.slice(-50)
  }
  process (line) {
    let m
    if (/\[Behaviour\] Joining wrld_/.test(line)) { this.players.clear(); this.avatars.clear() }
    if ((m = line.match(/\[Behaviour\] OnPlayerJoined\s+(.+?)(?:\s+\(usr_[^)]+\))?\s*$/))) {
      const name = clean(m[1]); if (!this.players.has(name)) this.add('join', name)
      this.players.add(name)
    } else if ((m = line.match(/\[Behaviour\] OnPlayerLeft\s+(.+?)(?:\s+\(usr_[^)]+\))?\s*$/))) {
      const name = clean(m[1]); if (this.players.has(name)) this.add('leave', name)
      this.players.delete(name); this.avatars.delete(name)
    } else if ((m = line.match(/\[Behaviour\] Switching (.+?) to avatar (.+)\s*$/))) {
      const name = clean(m[1]); const avatar = clean(m[2]); const old = this.avatars.get(name)
      if (old !== avatar) this.add('avatar', name, old ? 'Changed avatar to ' + avatar : 'Loaded avatar: ' + avatar)
      this.avatars.set(name, avatar)
    } else if ((m = parsePortalEvent(line))) {
      this.add('portal', m.name, m.detail)
    } else if ((m = line.match(/\[Behaviour\] Joining or Creating Room:\s*(.+)\s*$/))) {
      this.add('world', m[1], 'Entering world')
    } else if (/\[Behaviour\] OnLeftRoom\b/.test(line)) {
      this.add('world', 'Left world', 'Disconnected from instance'); this.players.clear(); this.avatars.clear()
    }
  }
  snapshot () { return this.events.map(event => ({ ...event })) }
}
module.exports = { ActivityEvents, parsePortalEvent }

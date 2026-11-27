'use strict'

// modules/vrchat/friends/friendAlerts.js
// Optional desktop / VR (HUD) alerts when chosen friends come online or move
// into the instance you're in. Fed by the Friend Feed's events (friendFeed.js
// onFeed). Pure logic: the caller supplies the current location and the
// notify function. MAIN process.
//
// Friends are matched by usr_ id or display name (case-insensitive), so a list
// typed by name still works, and ids survive display-name changes.

const COOLDOWN_MS = 60 * 1000 // same friend + same kind of alert at most once a minute

const DEFAULTS = { enabled: false, friends: [], online: true, joinInstance: true, desktop: true, hud: true }

function normalizeConfig (cfg = {}) {
  const raw = Array.isArray(cfg.friends) ? cfg.friends : String(cfg.friends || '').split(/[\n,]/)
  const friends = [...new Set(raw.map(s => String(s).trim()).filter(Boolean))].slice(0, 200)
  return {
    enabled: !!cfg.enabled,
    friends,
    online: cfg.online !== false,
    joinInstance: cfg.joinInstance !== false,
    desktop: cfg.desktop !== false,
    hud: cfg.hud !== false
  }
}

// Instance identity without the volatile bits: "wrld_x:12345~region(eu)~nonce(..)"
// vs the same instance reported with tags in another order must still match.
function instanceKey (location) {
  const s = String(location || '')
  const m = s.match(/^(wrld_[^:]+):([^~]+)/)
  return m ? `${m[1]}:${m[2]}` : ''
}

function createFriendAlerts ({ getConfig, getMyLocation, notify, now = () => Date.now() } = {}) {
  const last = new Map() // `${who}|${kind}` -> ts

  function watched (cfg, e) {
    const id = String(e.userId || '')
    const name = String(e.name || '').toLowerCase()
    return cfg.friends.some(f => (f.startsWith('usr_') ? f === id : f.toLowerCase() === name))
  }

  function fire (cfg, e, kind, title, body) {
    const key = `${e.userId || e.name}|${kind}`
    const t = now()
    if (t - (last.get(key) || 0) < COOLDOWN_MS) return null
    last.set(key, t)
    const alert = { id: t * 1000 + (last.size % 1000), at: t, kind, userId: e.userId || '', name: e.name || '', title, body, desktop: cfg.desktop, hud: cfg.hud }
    if (typeof notify === 'function') notify(alert)
    return alert
  }

  // Returns the alert that was sent (or null).
  function handleFeed (e) {
    if (!e || !e.type) return null
    const cfg = normalizeConfig(typeof getConfig === 'function' ? getConfig() : {})
    if (!cfg.enabled || !cfg.friends.length || !watched(cfg, e)) return null
    if (e.type === 'online' && cfg.online) {
      return fire(cfg, e, 'online', `${e.name} is online`, e.platform ? `on ${e.platform === 'standalonewindows' ? 'PC' : e.platform}` : 'Came online')
    }
    if (e.type === 'gps' && cfg.joinInstance) {
      const mine = instanceKey(typeof getMyLocation === 'function' ? getMyLocation() : '')
      if (mine && instanceKey(e.location) === mine) {
        return fire(cfg, e, 'join', `${e.name} is joining you`, e.worldName ? `Heading into ${e.worldName}` : 'Heading into your instance')
      }
    }
    return null
  }

  return { handleFeed }
}

module.exports = { createFriendAlerts, normalizeConfig, instanceKey, DEFAULTS, COOLDOWN_MS }

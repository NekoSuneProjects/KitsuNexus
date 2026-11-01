'use strict'
const fs = require('node:fs')
const path = require('node:path')
const MAX_EVENTS = 5000
const MAX_AGE_DAYS = 365
function clean (s, max = 160) { return typeof s === 'string' ? s.replace(/[\x00-\x1f]/g, ' ').slice(0, max).trim() : '' }
function safeCsv (value) {
  const text = String(value == null ? '' : value)
  const escaped = /^[\s]*[=+@\-]/.test(text) ? "'" + text : text
  return '"' + escaped.replace(/"/g, '""') + '"'
}
function normalizeEvent (raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Invalid history event')
  const kind = clean(raw.kind, 32)
  if (!['world', 'instance', 'encounter', 'portal'].includes(kind)) throw new TypeError('Unsupported history event')
  const at = Number(raw.at) || now
  if (!Number.isFinite(at) || at > now + 60000 || at < 0) throw new TypeError('Invalid timestamp')
  return { kind, at, worldId: clean(raw.worldId, 100), instanceId: clean(raw.instanceId, 150), playerId: clean(raw.playerId, 100), name: clean(raw.name), note: clean(raw.note, 500) }
}
function prune (items, { retentionDays = 30, limit = 1000 } = {}, now = Date.now()) {
  const days = Math.max(1, Math.min(MAX_AGE_DAYS, Number(retentionDays) || 30))
  const count = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || 1000))
  const cutoff = now - days * 86400000
  return items.filter(x => x.at >= cutoff && x.at <= now + 60000).sort((a, b) => b.at - a.at).slice(0, count)
}
class LocalHistory {
  constructor (file, options = {}) {
    if (!path.isAbsolute(file)) throw new TypeError('History file must be absolute')
    this.file = file
    this.options = options
    this.items = []
  }
  load () {
    try {
      const bytes = fs.readFileSync(this.file)
      if (bytes.length > 4 * 1024 * 1024) throw new Error('History exceeds maximum size')
      const parsed = JSON.parse(bytes.toString('utf8'))
      if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) throw new Error('Unsupported history schema')
      this.items = prune(parsed.events.map(x => normalizeEvent(x)).filter(Boolean), this.options)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.items = []
    }
    return this.list()
  }
  add (event) {
    const normalized = normalizeEvent(event)
    this.items = prune([normalized, ...this.items], this.options)
    this.save()
    return normalized
  }
  list () { return this.items.map(x => ({ ...x })) }
  clear () { this.items = []; this.save() }
  save () {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ schemaVersion: 1, events: this.items }), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }
  exportCsv () {
    const fields = ['kind', 'at', 'worldId', 'instanceId', 'playerId', 'name', 'note']
    return fields.join(',') + '\r\n' + this.items.map(row => fields.map(k => safeCsv(row[k])).join(',')).join('\r\n')
  }
}
module.exports = { LocalHistory, normalizeEvent, prune, safeCsv }

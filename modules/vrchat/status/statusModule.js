// modules/status/statusModule.js
// Personal status presets + dynamic tokens (clock, etc). Renderer-side helper.
// A "preset" is just a template string that can contain {tokens} resolved at
// build time by the chatbox composer.

const DEFAULT_PRESETS = [
  'Hewwo from VRChat! :3',
  '{time} | vibing~',
  'AFK - back soon!',
  'Listening to {song}',
  '{hr} bpm | {cpu}% CPU'
]

const clockSync = require('../../time/clockSync')

// Uses clockSync so {time} matches Windows even with outdated bundled tzdata.
function formatClock (date = new Date()) {
  return clockSync.formatTime(date, { hour: '2-digit', minute: '2-digit' })
}

// Replace {tokens} in a template using a values map.
function resolveTokens (template, values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    const v = values[key]
    return v === undefined || v === null || v === '' ? '' : String(v)
  }).replace(/\s{2,}/g, ' ').trim()
}

module.exports = { DEFAULT_PRESETS, formatClock, resolveTokens }

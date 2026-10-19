'use strict'

function easterDate (y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mo = Math.floor((h + l - 7 * m + 114) / 31); const da = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(y, mo - 1, da)
}

// Uses the user's local calendar: Halloween lasts from October 1 at 00:00
// through October 31 at 23:59, regardless of their saved colour preference.
function seasonalTheme (now) {
  const mo = now.getMonth() + 1
  if (mo === 10) return { theme: 'halloween', label: '🎃 Halloween · October 1–31', isEvent: true }
  if (mo === 12) return { theme: 'xmas', label: '🎄 Christmas', isEvent: true }
  if (mo === 6) return { theme: 'rainbow', label: '🏳️‍🌈 Pride', isEvent: true }
  const diff = (now - easterDate(now.getFullYear())) / 86400000
  if (diff >= -7 && diff <= 1) return { theme: 'easter', label: '🐰 Easter', isEvent: true }
  return { theme: 'blackgreen', label: '', isEvent: false }
}

module.exports = { seasonalTheme }

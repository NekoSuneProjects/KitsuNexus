'use strict'

// modules/time/clockSync.js
// One place every KitsuNexus clock reads "what time is it here" from
// (OSC avatar clocks, chatbox {time}, HUD/rail clocks, AFK, Jarvis).
//
// Why this exists: Electron/Node ship their own copy of the IANA tz database
// inside ICU (tzdata 2025c as of Electron 42). In 2026 BC, Alberta, the NWT
// and Manitoba all stopped changing their clocks, and Cuba skipped a
// fall-back. None of that is in 2025c, so on 2026-11-01 the app "fell
// back" an hour while the real clocks in those places didn't. Windows
// itself gets these updates through Windows Update, but Chromium uses its
// own ICU data instead.
//
// How times are worked out, in this order:
//   1. A manual timezone override (Settings → Clock & timezone), if set.
//   2. The offset Windows itself reports right now (osClock.js in the main
//      process asks it every few minutes, and again after sleep/resume and
//      system time changes), so the app matches the taskbar clock.
//   3. ICU's zone rules, with TZ_CORRECTIONS applied on top for zones whose
//      rules changed after the bundled tzdata was released.
// Named-zone lookups (Jarvis "what time is it in Vancouver") use step 3.

// Rule changes from IANA tzdb releases 2026a-2026f
// (https://data.iana.org/time-zones/tzdb/NEWS). Each one applies only when
// the runtime's bundled tzdata is older than `release`, so a future Electron
// with fresh tzdata automatically stops using it. fromUtc/toUtc are the
// instants tzdb itself models the change at (Canada: 2026-11-01 02:00 local
// daylight time; Morocco: 2026-09-20 02:00 local).
const TZ_CORRECTIONS = [
  { release: '2026b', zones: ['America/Vancouver', 'Canada/Pacific'], fromUtc: Date.UTC(2026, 10, 1, 9), offset: -420, abbr: 'MST', note: 'British Columbia permanent UTC-7' },
  { release: '2026c', zones: ['America/Edmonton', 'Canada/Mountain', 'America/Yellowknife'], fromUtc: Date.UTC(2026, 10, 1, 8), offset: -360, abbr: 'CST', note: 'Alberta permanent UTC-6' },
  { release: '2026c', zones: ['Africa/Casablanca', 'Africa/El_Aaiun'], fromUtc: Date.UTC(2026, 8, 20, 1), offset: 0, abbr: '+00', note: 'Morocco permanent UTC+0' },
  { release: '2026d', zones: ['America/Inuvik'], fromUtc: Date.UTC(2026, 10, 1, 8), offset: -360, abbr: 'CST', note: 'Northwest Territories permanent UTC-6' },
  { release: '2026e', zones: ['America/Winnipeg', 'Canada/Central', 'America/Rainy_River'], fromUtc: Date.UTC(2026, 10, 1, 7), offset: -300, abbr: 'EST', note: 'Manitoba + NW Ontario permanent UTC-5' },
  { release: '2026f', zones: ['America/Havana', 'Cuba'], fromUtc: Date.UTC(2026, 10, 1, 5), toUtc: Date.UTC(2027, 10, 7, 5), offset: -240, abbr: 'CDT', note: 'Cuba skips the 2026 fall-back' }
]

// The OS offset is refreshed every few minutes. If it hasn't been for a long
// time (PowerShell blocked, main process busy), stop trusting it.
const OS_OFFSET_MAX_AGE_MS = 30 * 60 * 1000

const state = {
  overrideTz: '',
  os: null // { offsetMinutes, windowsId, at }
}

function runtimeTzdata () {
  try { return (typeof process !== 'undefined' && process.versions && process.versions.tz) || '' } catch (_) { return '' }
}

function isValidIana (tz) {
  if (!tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch (_) { return false }
}

function systemTimeZone () {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (_) { return '' }
}

function correctionFor (tz, ms, tzdata = runtimeTzdata()) {
  if (!tz) return null
  for (const c of TZ_CORRECTIONS) {
    if (tzdata && tzdata >= c.release) continue // runtime already knows about it
    if (!c.zones.includes(tz)) continue
    if (ms < c.fromUtc) continue
    if (c.toUtc && ms >= c.toUtc) continue
    return c
  }
  return null
}

// What ICU's (possibly outdated) rules say the UTC offset of `tz` is at `date`.
function icuOffsetMinutes (date, tz) {
  const ms = date.getTime()
  if (!tz) return -new Date(ms).getTimezoneOffset()
  const parts = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  }).formatToParts(new Date(ms))) parts[p.type] = p.value
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second)
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000)
}

// UTC offset (minutes east of UTC) of an IANA zone, with 2026 corrections.
function zoneOffsetMinutes (date, tz) {
  const c = correctionFor(tz, date.getTime())
  return c ? c.offset : icuOffsetMinutes(date, tz)
}

function osOffsetUsable (ms, now = Date.now()) {
  const os = state.os
  if (!os || !Number.isFinite(os.offsetMinutes)) return false
  if (now - os.at > OS_OFFSET_MAX_AGE_MS) return false
  // The OS figure is only "the offset right now"; don't project it onto
  // timestamps far from now, where a DST change may sit in between.
  return Math.abs(ms - now) < 6 * 60 * 60 * 1000
}

// UTC offset to use for "local time" at `date`, plus where it came from.
function localOffset (date = new Date()) {
  const ms = date.getTime()
  if (state.overrideTz) return { offsetMinutes: zoneOffsetMinutes(date, state.overrideTz), source: 'override', timeZone: state.overrideTz }
  if (osOffsetUsable(ms)) return { offsetMinutes: state.os.offsetMinutes, source: 'windows', timeZone: systemTimeZone() }
  const tz = systemTimeZone()
  const corrected = !!correctionFor(tz, ms)
  return { offsetMinutes: tz ? zoneOffsetMinutes(date, tz) : -date.getTimezoneOffset(), source: corrected ? 'corrected' : 'system', timeZone: tz }
}

// A Date whose getUTC*() fields are the wall-clock fields we want to show.
function shifted (date, offsetMinutes) {
  return new Date(date.getTime() + offsetMinutes * 60000)
}

function offsetFor (date, tz) {
  return tz ? zoneOffsetMinutes(date, tz) : localOffset(date).offsetMinutes
}

// { year, month (1-12), day, hour (0-23), minute, second, dow (0=Sun) }
function wallParts (date = new Date(), tz = '') {
  const d = shifted(date, offsetFor(date, tz))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    dow: d.getUTCDay()
  }
}

// Intl formatting (keeps the user's locale: 12/24h, month names, etc.)
// against the corrected wall clock. `opts` are normal Intl options; any
// timeZone in them is used as the zone to show.
// Intl.DateTimeFormat is costly to build; history lists format hundreds of rows.
const formatterCache = new Map()
function formatter (locale, opts) {
  const key = `${locale || ''}|${JSON.stringify(opts)}`
  let f = formatterCache.get(key)
  if (!f) {
    if (formatterCache.size > 64) formatterCache.clear()
    f = new Intl.DateTimeFormat(locale, opts)
    formatterCache.set(key, f)
  }
  return f
}

function format (date = new Date(), opts = {}, locale = undefined) {
  const { timeZone, timeZoneName, ...rest } = opts || {}
  const d = date instanceof Date ? date : new Date(date)
  if (!Number.isFinite(d.getTime())) return ''
  return formatter(locale, { ...rest, timeZone: 'UTC' }).format(shifted(d, offsetFor(d, timeZone || '')))
}

function formatTime (date = new Date(), opts = { hour: '2-digit', minute: '2-digit' }, locale) { return format(date, opts, locale) }
function formatDate (date = new Date(), opts = {}, locale) { return format(date, { year: 'numeric', month: 'numeric', day: 'numeric', ...opts }, locale) }
function formatDateTime (date = new Date(), opts = {}, locale) {
  return format(date, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', ...opts }, locale)
}

function setOverrideTimeZone (tz) {
  const value = String(tz || '').trim()
  state.overrideTz = value && isValidIana(value) ? value : ''
  return state.overrideTz
}

// Fed by the main process (osClock.js). Ignored if it doesn't look sane.
function setOsClock (info) {
  if (!info || !Number.isFinite(Number(info.offsetMinutes))) { state.os = null; return }
  const offsetMinutes = Math.round(Number(info.offsetMinutes))
  if (offsetMinutes < -14 * 60 || offsetMinutes > 14 * 60) { state.os = null; return }
  state.os = { offsetMinutes, windowsId: String(info.windowsId || ''), at: Number(info.at) || Date.now() }
}

function fmtOffset (m) {
  const sign = m < 0 ? '-' : '+'
  const a = Math.abs(m)
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

// Human-readable status for the settings panel.
function describe (date = new Date()) {
  const local = localOffset(date)
  const tz = systemTimeZone()
  const effectiveTz = local.source === 'override' ? state.overrideTz : tz
  const icu = icuOffsetMinutes(date, effectiveTz)
  const c = correctionFor(effectiveTz, date.getTime())
  return {
    ...local,
    offset: fmtOffset(local.offsetMinutes),
    systemTimeZone: tz,
    windowsId: state.os ? state.os.windowsId : '',
    windowsOffset: state.os ? fmtOffset(state.os.offsetMinutes) : '',
    bundledOffset: fmtOffset(icu),
    mismatch: local.offsetMinutes !== icu,
    correction: c ? c.note : '',
    tzdata: runtimeTzdata(),
    now: formatTime(date, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
}

module.exports = {
  TZ_CORRECTIONS,
  correctionFor,
  icuOffsetMinutes,
  zoneOffsetMinutes,
  localOffset,
  wallParts,
  format,
  formatTime,
  formatDate,
  formatDateTime,
  setOverrideTimeZone,
  setOsClock,
  describe,
  isValidIana,
  systemTimeZone,
  _state: state
}

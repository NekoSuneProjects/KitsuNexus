'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const clockSync = require('../modules/time/clockSync')
const { clockValues } = require('../modules/integrations/osc/clock/oscDigitalClock')
const { parse } = require('../modules/time/osClock')

const reset = () => { clockSync.setOverrideTimeZone(''); clockSync.setOsClock(null) }

// 2026-11-27 18:30 UTC, after every Canadian 2026 change took effect.
const AFTER = new Date(Date.UTC(2026, 10, 27, 18, 30))
// 2026-07-01 18:30 UTC, summer: old and new rules agree.
const SUMMER = new Date(Date.UTC(2026, 6, 1, 18, 30))

test('2026 Canadian permanent-time zones get the new offsets', () => {
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Vancouver'), -420)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Edmonton'), -360)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Inuvik'), -360)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Winnipeg'), -300)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Havana'), -240)
})

test('zones that still change clocks are untouched', () => {
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Toronto'), -300)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Los_Angeles'), -480)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'America/Regina'), -360)
  assert.equal(clockSync.zoneOffsetMinutes(AFTER, 'Europe/London'), 0)
})

test('summer 2026 and the moment before the switch use the normal rules', () => {
  assert.equal(clockSync.zoneOffsetMinutes(SUMMER, 'America/Vancouver'), -420)
  assert.equal(clockSync.zoneOffsetMinutes(SUMMER, 'America/Winnipeg'), -300)
  const justBefore = new Date(Date.UTC(2026, 10, 1, 8, 59))
  assert.equal(clockSync.zoneOffsetMinutes(justBefore, 'America/Vancouver'), -420)
})

test('Cuba correction ends at the 2027 fall-back', () => {
  assert.equal(clockSync.correctionFor('America/Havana', Date.UTC(2027, 10, 8)), null)
})

test('corrections are skipped once the runtime tzdata is new enough', () => {
  assert.equal(clockSync.correctionFor('America/Vancouver', AFTER.getTime(), '2026f'), null)
  assert.ok(clockSync.correctionFor('America/Vancouver', AFTER.getTime(), '2025c'))
})

test('named-zone formatting shows the corrected wall time', () => {
  const s = clockSync.format(AFTER, { timeZone: 'America/Vancouver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB')
  assert.equal(s, '11:30')
})

test('local time follows the Windows offset when present', () => {
  reset()
  const now = new Date()
  clockSync.setOsClock({ offsetMinutes: -420, windowsId: 'Pacific Standard Time', at: Date.now() })
  const p = clockSync.wallParts(now)
  assert.equal(p.hour, new Date(now.getTime() - 420 * 60000).getUTCHours())
  assert.equal(clockSync.localOffset(now).source, 'windows')
  reset()
})

test('a stale Windows offset is ignored', () => {
  reset()
  clockSync.setOsClock({ offsetMinutes: 300, at: Date.now() - 60 * 60 * 1000 })
  assert.notEqual(clockSync.localOffset(new Date()).source, 'windows')
  reset()
})

test('manual override wins and rejects junk', () => {
  reset()
  clockSync.setOsClock({ offsetMinutes: 0, at: Date.now() })
  assert.equal(clockSync.setOverrideTimeZone('America/Winnipeg'), 'America/Winnipeg')
  assert.equal(clockSync.localOffset(AFTER).source, 'override')
  assert.equal(clockSync.localOffset(AFTER).offsetMinutes, -300)
  assert.equal(clockSync.setOverrideTimeZone('Not/AZone'), '')
  reset()
})

test('OSC avatar clock values use the corrected wall clock', () => {
  reset()
  clockSync.setOverrideTimeZone('America/Vancouver')
  const { raw } = clockValues(AFTER)
  assert.deepEqual(raw, { MonthF: 11, DayF: 27, HourF: 11, MinuteF: 30, DOWF: 5 })
  reset()
})

test('osClock parses PowerShell output', () => {
  assert.deepEqual({ ...parse('Pacific Standard Time|-420\r\n'), at: 0 }, { windowsId: 'Pacific Standard Time', offsetMinutes: -420, at: 0 })
  assert.equal(parse('garbage'), null)
  assert.equal(parse(''), null)
})

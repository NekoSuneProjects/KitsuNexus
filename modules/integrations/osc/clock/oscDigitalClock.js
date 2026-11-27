'use strict'

// Compatibility sender for Bekosantux/OSCClockSenderAPP avatar parameters.
// The original app encodes each calendar unit as ceil(value / 127, 5 decimals).

const { wallParts } = require('../../../time/clockSync')

const CLOCK_ROOT = '/avatar/parameters/OSCClock/'

function encodeClockFloat (value) {
  const number = Math.max(0, Math.min(127, Math.trunc(Number(value) || 0)))
  return Math.ceil((number / 127) * 100000) / 100000
}

function clockValues (date = new Date()) {
  // Wall-clock fields come from clockSync, not date.getHours(), so the avatar
  // clock follows Windows / the 2026 tz rule fixes instead of Electron's
  // bundled (outdated) tzdata.
  const p = wallParts(date)
  const raw = {
    MonthF: p.month,
    DayF: p.day,
    HourF: p.hour,
    MinuteF: p.minute,
    DOWF: p.dow
  }
  return {
    raw,
    encoded: Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, encodeClockFloat(value)]))
  }
}

class OscDigitalClock {
  constructor ({ sendParam, onUpdate = () => {}, now = () => new Date() } = {}) {
    if (typeof sendParam !== 'function') throw new TypeError('OSC Digital Clock requires sendParam(address, value, type)')
    this.sendParam = sendParam
    this.onUpdate = onUpdate
    this.now = now
    this.enabled = false
    this.timer = null
    this.lastSentAt = null
    this.lastError = ''
    this.values = clockValues(this.now())
    this.config = { intervalSeconds: 10, legacyDoW: true, vrcoscClock: true, clock24Hour: false, dateTimeInts: true }
  }

  configure (config = {}) {
    const previousInterval = this.config.intervalSeconds
    this.config = {
      intervalSeconds: Math.max(1, Math.min(300, Math.trunc(Number(config.intervalSeconds) || 10))),
      legacyDoW: config.legacyDoW !== false,
      vrcoscClock: config.vrcoscClock !== false,
      clock24Hour: !!config.clock24Hour,
      dateTimeInts: config.dateTimeInts !== false
    }
    if (this.enabled && previousInterval !== this.config.intervalSeconds) this.startTimer()
    return this.getState()
  }

  setEnabled (enabled) {
    this.enabled = !!enabled
    if (this.enabled) {
      this.syncNow()
      this.startTimer()
    } else {
      this.stopTimer()
      this.emit('disabled')
    }
    return this.getState()
  }

  syncNow () {
    this.values = clockValues(this.now())
    try {
      for (const [name, value] of Object.entries(this.values.encoded)) {
        this.sendParam(`${CLOCK_ROOT}${name}`, value, 'float')
      }
      // The upstream sender spells this DoWF, while some avatar packages expose
      // DOWF. Send the legacy spelling too when compatibility mode is enabled.
      if (this.config.legacyDoW) this.sendParam(`${CLOCK_ROOT}DoWF`, this.values.encoded.DOWF, 'float')
      if (this.config.vrcoscClock) {
        const raw = this.values.raw
        const hours = this.config.clock24Hour ? raw.HourF / 24 : (raw.HourF % 12) / 12
        this.sendParam('/avatar/parameters/VRCOSC/Clock/Hours', hours, 'float')
        this.sendParam('/avatar/parameters/VRCOSC/Clock/Minutes', raw.MinuteF / 60, 'float')
      }
      if (this.config.dateTimeInts) {
        const raw = this.values.raw
        this.sendParam('/avatar/parameters/DateTimeHour', raw.HourF, 'int')
        this.sendParam('/avatar/parameters/DateTimeMinute', raw.MinuteF, 'int')
        this.sendParam('/avatar/parameters/DateTimeDay', raw.DayF, 'int')
        this.sendParam('/avatar/parameters/DateTimeMonth', raw.MonthF, 'int')
      }
      this.lastSentAt = Date.now()
      this.lastError = ''
      this.emit('sent')
    } catch (err) {
      this.lastError = err.message
      this.emit('error')
    }
    return this.getState()
  }

  startTimer () {
    this.stopTimer()
    this.timer = setInterval(() => this.syncNow(), this.config.intervalSeconds * 1000)
  }

  stopTimer () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  emit (event) { this.onUpdate(this.getState(event)) }

  getState (event = '') {
    return {
      enabled: this.enabled,
      event,
      config: { ...this.config },
      values: { raw: { ...this.values.raw }, encoded: { ...this.values.encoded } },
      lastSentAt: this.lastSentAt,
      lastError: this.lastError
    }
  }

  destroy () {
    this.enabled = false
    this.stopTimer()
  }
}

module.exports = { OscDigitalClock, encodeClockFloat, clockValues, CLOCK_ROOT }

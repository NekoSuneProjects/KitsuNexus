'use strict'

// modules/time/osClock.js  (main process)
// Asks Windows for its current local UTC offset, which comes from Windows' own
// timezone database (kept current by Windows Update), and shares it with every
// window, so KitsuNexus clocks match the taskbar clock even when the tzdata
// bundled in Electron is out of date. See clockSync.js.

const { execFile } = require('child_process')
const clockSync = require('./clockSync')

const POLL_MS = 5 * 60 * 1000
// A fresh PowerShell process each time, so .NET's cached zone data is never stale.
const PS_COMMAND = '$tz=[System.TimeZoneInfo]::Local; $o=$tz.GetUtcOffset([DateTime]::UtcNow).TotalMinutes; Write-Output ($tz.Id + "|" + $o)'

let timer = null
let last = null
let broadcast = () => {}

function parse (stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).pop() || ''
  const i = line.lastIndexOf('|')
  if (i < 0) return null
  const offsetMinutes = Number(line.slice(i + 1))
  if (!Number.isFinite(offsetMinutes)) return null
  return { windowsId: line.slice(0, i).trim(), offsetMinutes: Math.round(offsetMinutes), at: Date.now() }
}

function refresh () {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_COMMAND],
      { windowsHide: true, timeout: 15000 }, (err, stdout) => {
        const info = err ? null : parse(stdout)
        if (info) {
          last = info
          clockSync.setOsClock(info)
          try { broadcast(info) } catch (_) {}
        }
        resolve(info)
      })
  })
}

// onUpdate(info) is called after each successful read (send it to the windows).
function start ({ onUpdate, powerMonitor } = {}) {
  if (typeof onUpdate === 'function') broadcast = onUpdate
  stop()
  refresh()
  timer = setInterval(refresh, POLL_MS)
  if (timer.unref) timer.unref()
  if (powerMonitor) {
    // Waking from sleep is the usual moment a DST change has happened unseen.
    for (const ev of ['resume', 'unlock-screen']) {
      try { powerMonitor.on(ev, () => refresh()) } catch (_) {}
    }
  }
}

function stop () {
  if (timer) clearInterval(timer)
  timer = null
}

function current () { return last }

module.exports = { start, stop, refresh, current, parse }

'use strict'

// modules/stats/hwSources.js
// Faster / more accurate hardware readings than systeminformation alone on
// Windows. Used by componentStats.js. MAIN process.
//
//  - NVIDIA: nvidia-smi (~0.3 s, exact load/temp/VRAM, every GPU). si.graphics()
//    goes through WMI + PowerShell and was so slow it only ran every 6th tick,
//    so GPU load stayed frozen for ~30 s at a time.
//  - AMD / Intel / anything else: Windows' own "GPU Engine" 3D utilization
//    counters (what Task Manager shows), summed per adapter. Slow (~3-4 s),
//    so it's read in the background and the last value is used.
//  - CPU temperature: Windows doesn't expose it to normal apps. When
//    LibreHardwareMonitor or OpenHardwareMonitor is running, read it from
//    their WMI namespace; otherwise it's unknown (null), never a fake 0.

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const isWin = process.platform === 'win32'
const run = (file, args, timeout = 8000) => new Promise(resolve => {
  execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')))
})

// ---- NVIDIA ---------------------------------------------------------------
let smiPath // undefined = not probed yet, '' = not available
async function findNvidiaSmi () {
  if (smiPath !== undefined) return smiPath
  smiPath = ''
  if (!isWin && process.platform !== 'linux') return smiPath
  const candidates = ['nvidia-smi']
  if (isWin) {
    candidates.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'))
    candidates.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'))
  }
  for (const c of candidates) {
    if (c !== 'nvidia-smi' && !fs.existsSync(c)) continue
    const out = await run(c, ['--query-gpu=name', '--format=csv,noheader'], 5000)
    if (out && out.trim()) { smiPath = c; break }
  }
  return smiPath
}

function parseNvidiaCsv (out) {
  const num = v => { const n = Number(String(v).trim()); return Number.isFinite(n) ? n : null }
  return String(out || '').trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [name, util, temp, memUsed, memTotal] = line.split(',').map(s => s.trim())
    return { name, load: num(util), temp: num(temp), vramUsedMb: num(memUsed), vramTotalMb: num(memTotal) }
  }).filter(g => g.name)
}

// [{ name, load, temp, vramUsedMb, vramTotalMb }] or null when there's no NVIDIA GPU.
async function readNvidia () {
  const exe = await findNvidiaSmi()
  if (!exe) return null
  const out = await run(exe, ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], 6000)
  if (out === null) return null
  const gpus = parseNvidiaCsv(out)
  return gpus.length ? gpus : null
}

// ---- Windows GPU engine counters (any vendor) ---------------------------------
// typeperf CSV: header row of counter paths, then one row of values. Counters
// look like "GPU Engine(pid_1048_luid_0x0_0x12070_phys_0_eng_0_engtype_3D)".
function parseGpuEngineCsv (out) {
  const lines = String(out || '').split(/\r?\n/).filter(l => l.startsWith('"'))
  if (lines.length < 2) return null
  const cells = l => l.split('","').map(c => c.replace(/^"|"$/g, ''))
  const head = cells(lines[0])
  const vals = cells(lines[1])
  const perAdapter = new Map()
  for (let i = 1; i < head.length; i++) {
    const luid = (head[i].match(/luid_(0x[0-9a-f]+_0x[0-9a-f]+)/i) || [])[1]
    const v = Number(vals[i])
    if (!luid || !Number.isFinite(v)) continue
    perAdapter.set(luid, (perAdapter.get(luid) || 0) + v)
  }
  if (!perAdapter.size) return null
  return Math.min(100, Math.max(...perAdapter.values()))
}

async function readGpuEngineLoad () {
  if (!isWin) return null
  const out = await run('typeperf', ['\\GPU Engine(*engtype_3D)\\Utilization Percentage', '-sc', '1'], 12000)
  return out === null ? null : parseGpuEngineCsv(out)
}

// ---- CPU temperature via LibreHardwareMonitor / OpenHardwareMonitor -----------
let hmNamespace // undefined = not probed, '' = none
let hmProbedAt = 0
const HM_REPROBE_MS = 5 * 60 * 1000 // notice LHM being started later
const PS_HM = ns => `$s = Get-CimInstance -Namespace ${ns} -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -match 'cpu' }; $s | ForEach-Object { $_.Name + '|' + $_.Value }`

function pickCpuTemp (out) {
  const rows = String(out || '').split(/\r?\n/).map(l => l.split('|')).filter(r => r.length === 2 && Number.isFinite(Number(r[1])))
  if (!rows.length) return null
  const pref = [/package/i, /tctl|tdie/i, /core.*average|average/i, /core max/i, /cpu/i]
  for (const re of pref) { const r = rows.find(x => re.test(x[0])); if (r) return Number(r[1]) }
  return Math.max(...rows.map(r => Number(r[1])))
}

async function readHardwareMonitorCpuTemp () {
  if (!isWin) return null
  const now = Date.now()
  if (hmNamespace === undefined || (hmNamespace === '' && now - hmProbedAt > HM_REPROBE_MS)) {
    hmProbedAt = now
    hmNamespace = ''
    for (const ns of ['root/LibreHardwareMonitor', 'root/OpenHardwareMonitor']) {
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_HM(ns)], 10000)
      if (out !== null && pickCpuTemp(out) !== null) { hmNamespace = ns; return pickCpuTemp(out) }
    }
    return null
  }
  if (!hmNamespace) return null
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_HM(hmNamespace)], 10000)
  const t = out === null ? null : pickCpuTemp(out)
  if (t === null) hmNamespace = '' // monitor closed: re-probe later
  return t
}

function cpuTempSource () { return hmNamespace ? hmNamespace.split('/')[1] : '' }

module.exports = { readNvidia, readGpuEngineLoad, readHardwareMonitorCpuTemp, cpuTempSource, parseNvidiaCsv, parseGpuEngineCsv, pickCpuTemp }

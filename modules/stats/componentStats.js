// modules/stats/componentStats.js
// Polls system component stats (CPU / GPU / RAM / VRAM / FPS-ish) using `systeminformation`.
// Runs in the MAIN process and pushes snapshots to a listener; the renderer turns
// the snapshot into a chatbox line.

const os = require('os')
const si = require('systeminformation')
const { acquireSiShell, releaseSiShell } = require('./siShell')
const hwSources = require('./hwSources')

let pollTimer = null
let onUpdate = null
let lastSnapshot = null

const DEFAULT_INTERVAL_MS = 5000

function round (value, digits = 0) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// Native CPU load from os.cpus() deltas — works on every Windows PC with no WMI /
// PowerShell / perf-counter dependency (systeminformation's currentLoad returns 0
// on some locked-down / VM / broken-perf-counter machines). Returns null until it
// has a baseline to diff against.
let prevCpu = null
function nativeCpuLoad () {
  const cpus = os.cpus() || []
  let idle = 0
  let total = 0
  for (const c of cpus) {
    for (const k in c.times) total += c.times[k]
    idle += c.times.idle
  }
  const prev = prevCpu
  prevCpu = { idle, total }
  if (!prev) return null
  const idleDiff = idle - prev.idle
  const totalDiff = total - prev.total
  if (totalDiff <= 0) return null
  return Math.max(0, Math.min(100, 100 - (idleDiff / totalDiff) * 100))
}

// GPU + CPU temperature.
//  - NVIDIA: nvidia-smi every tick (fast, exact) - see hwSources.js. Before, all
//    GPU data came from si.graphics() every 6th tick only (~30 s at the default
//    5 s interval), so GPU load looked frozen.
//  - Other GPUs: si.graphics() for name/VRAM (slow, occasionally) + Windows'
//    GPU engine counters for load, read in the background.
//  - CPU temp: si.cpuTemperature() if the board exposes it, else a running
//    LibreHardwareMonitor/OpenHardwareMonitor, else null ("unknown" - not 0).
const SLOW_EVERY = 6 // si.graphics() / temperature probes every 6th tick
let tickCount = 0
const hw = {
  cpuName: '', cpuTemp: null, cpuTempSource: '',
  gpuName: '', gpuLoad: null, gpuTemp: null, vramUsedMb: null, vramTotalMb: null, gpuSource: ''
}
let nvidiaOk = null // null = unknown yet
let engineBusy = false
let slowBusy = false

async function refreshCpuName () {
  if (hw.cpuName) return
  const c = await si.cpu().catch(() => null)
  const brand = c ? `${c.manufacturer || ''} ${c.brand || ''}`.replace(/\(R\)|\(TM\)|™|®/g, '').replace(/\s+/g, ' ').trim() : ''
  hw.cpuName = brand || (os.cpus()[0] && os.cpus()[0].model.trim()) || ''
}

async function refreshNvidia () {
  const gpus = await hwSources.readNvidia().catch(() => null)
  nvidiaOk = !!gpus
  if (!gpus) return false
  const g = gpus.reduce((a, b) => ((b.load ?? -1) > (a.load ?? -1) ? b : a), gpus[0]) // busiest GPU
  Object.assign(hw, { gpuName: g.name, gpuLoad: g.load, gpuTemp: g.temp, vramUsedMb: g.vramUsedMb, vramTotalMb: g.vramTotalMb, gpuSource: 'nvidia-smi' })
  return true
}

async function refreshSlow () {
  if (slowBusy) return
  slowBusy = true
  try {
    const wantGraphics = nvidiaOk === false
    const [cpuTemp, graphics] = await Promise.all([
      si.cpuTemperature().catch(() => null),
      wantGraphics ? si.graphics().catch(() => null) : null
    ])
    const t = Number(cpuTemp && cpuTemp.main)
    if (Number.isFinite(t) && t > 0) { hw.cpuTemp = round(t); hw.cpuTempSource = 'system' } else {
      const lhm = await hwSources.readHardwareMonitorCpuTemp().catch(() => null)
      hw.cpuTemp = Number.isFinite(lhm) && lhm > 0 ? round(lhm) : null
      hw.cpuTempSource = hw.cpuTemp === null ? '' : hwSources.cpuTempSource()
    }
    if (graphics) {
      const list = (graphics.controllers || []).filter(c => c && c.model)
      // Prefer a GPU with real VRAM (discrete) over a tiny iGPU / virtual display adapter.
      const g = list.find(c => Number.isFinite(c.utilizationGpu)) || list.sort((a, b) => (b.vram || 0) - (a.vram || 0))[0]
      if (g) {
        hw.gpuName = g.model
        if (Number.isFinite(g.utilizationGpu)) { hw.gpuLoad = round(g.utilizationGpu); hw.gpuSource = 'driver' }
        hw.gpuTemp = Number.isFinite(g.temperatureGpu) ? round(g.temperatureGpu) : null
        hw.vramUsedMb = Number.isFinite(g.memoryUsed) ? round(g.memoryUsed) : null
        hw.vramTotalMb = Number.isFinite(g.memoryTotal) ? round(g.memoryTotal) : (g.vram ? round(g.vram) : null)
      }
    }
  } finally { slowBusy = false }
}

// Background (never awaited): Windows GPU engine counters for non-NVIDIA load.
function refreshEngineLoad () {
  if (engineBusy || nvidiaOk !== false || hw.gpuSource === 'driver') return
  engineBusy = true
  hwSources.readGpuEngineLoad().then(v => {
    if (Number.isFinite(v)) { hw.gpuLoad = round(v); hw.gpuSource = 'windows' }
  }).catch(() => {}).finally(() => { engineBusy = false })
}

async function readSnapshot () {
  const osLoad = nativeCpuLoad() // native baseline-diff load (null on first tick)
  const [load, mem] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    refreshCpuName(),
    nvidiaOk !== false ? refreshNvidia() : null
  ])
  // Slow probes run in the background so a slow WMI query never delays the tick.
  if (tickCount % SLOW_EVERY === 0) refreshSlow().catch(() => {})
  if (tickCount % 2 === 0) refreshEngineLoad()
  tickCount++

  // CPU: the native delta over the poll interval (what Task Manager averages);
  // si's value when the native one isn't ready yet (first tick).
  const siLoad = Number(load && load.currentLoad)
  const cpuLoad = osLoad ?? (Number.isFinite(siLoad) ? siLoad : 0)

  // RAM: compute natively from os (always available); only use si if it looks valid.
  const osTotal = os.totalmem()
  const osUsed = osTotal - os.freemem()
  let ramUsedBytes = osUsed
  let ramTotalBytes = osTotal
  if (mem && Number(mem.total) > 0) {
    ramTotalBytes = mem.total
    const active = Number(mem.active) || (mem.total - (Number(mem.available) || 0))
    if (active > 0) ramUsedBytes = active
  }

  const snapshot = {
    cpuName: hw.cpuName,
    cpuLoad: round(cpuLoad),
    cpuTemp: hw.cpuTemp, // null = unknown
    cpuTempSource: hw.cpuTempSource,
    ramUsedGb: round(ramUsedBytes / 1024 ** 3, 1),
    ramTotalGb: round(ramTotalBytes / 1024 ** 3, 1),
    ramPct: round((ramUsedBytes / ramTotalBytes) * 100),
    gpuName: hw.gpuName,
    gpuLoad: hw.gpuLoad === null ? 0 : round(hw.gpuLoad),
    gpuLoadKnown: hw.gpuLoad !== null,
    gpuTemp: hw.gpuTemp, // null = unknown
    gpuSource: hw.gpuSource,
    vramUsedMb: hw.vramUsedMb,
    vramTotalMb: hw.vramTotalMb,
    at: Date.now()
  }

  lastSnapshot = snapshot
  return snapshot
}

let ticking = false
async function tick () {
  if (ticking) return // never let a slow query stack up
  ticking = true
  try {
    const snapshot = await readSnapshot()
    if (typeof onUpdate === 'function') onUpdate(snapshot)
  } catch (err) {
    console.error('Component stats error:', err)
  } finally {
    ticking = false
  }
}

function startComponentStats (listener, intervalMs = DEFAULT_INTERVAL_MS) {
  onUpdate = listener
  stopComponentStats()
  prevCpu = null; nativeCpuLoad() // prime the native CPU baseline for the fallback
  acquireSiShell() // reuse one PowerShell for all WMI queries instead of spawning per call
  tick()
  pollTimer = setInterval(tick, Math.max(2000, intervalMs))
}

function stopComponentStats () {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    releaseSiShell()
  }
}

function getLastSnapshot () {
  return lastSnapshot
}

module.exports = {
  startComponentStats,
  stopComponentStats,
  readSnapshot,
  getLastSnapshot
}

// modules/stats/networkStats.js
// Network up/down throughput + ping, using systeminformation. Runs in MAIN process.

const si = require('systeminformation')
const { acquireSiShell, releaseSiShell } = require('./siShell')

let pollTimer = null
let onUpdate = null
let last = { downMbps: 0, upMbps: 0, pingMs: 0, iface: '', at: 0 }

function mbps (bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return 0
  return Math.round((bytesPerSec * 8) / 1e6 * 10) / 10
}

// Which adapter to measure. si.networkStats() with no argument uses the
// "default" interface, which on many gaming PCs is a VPN / virtual adapter
// (Radmin VPN, Tailscale, ZeroTier, Hamachi, VMware, Hyper-V vEthernet...)
// that carries no traffic, so up/down stayed at 0 Mbps forever. Measure every
// real adapter instead and report the busiest one.
const VIRTUAL_RE = /vpn|radmin|tailscale|zerotier|hamachi|wireguard|openvpn|\btap\b|tun\d*|vmware|virtualbox|vbox|vethernet|hyper-v|loopback|npcap|bluetooth|teredo|isatap|wan miniport|docker|wsl/i
function isRealAdapter (i) {
  if (!i || i.internal || i.virtual) return false
  if (VIRTUAL_RE.test(`${i.iface || ''} ${i.ifaceName || ''}`)) return false
  return i.operstate === 'up' || !i.operstate
}
let adapters = null // iface names of real adapters
let adaptersAt = 0
async function realAdapters () {
  if (adapters && Date.now() - adaptersAt < 60000) return adapters
  const list = await si.networkInterfaces().catch(() => [])
  adapters = (Array.isArray(list) ? list : [list]).filter(isRealAdapter).map(i => i.iface)
  adaptersAt = Date.now()
  return adapters
}
// si keys its rx/tx deltas by iface; strip spaces like it does to compare.
const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase()

let tickCount = 0
let ticking = false
async function tick (pingHost) {
  if (ticking) return
  ticking = true
  try {
    const real = (await realAdapters()).map(norm)
    const stats = await si.networkStats(real.length ? (await realAdapters()).join(',') : '*').catch(() => [])
    const list = (Array.isArray(stats) ? stats : []).filter(s => s && (!real.length || real.includes(norm(s.iface))))
    const primary = list.reduce((best, s) => (((s.rx_sec || 0) + (s.tx_sec || 0)) > ((best?.rx_sec || 0) + (best?.tx_sec || 0)) ? s : best), list[0])
    if (primary) {
      last.downMbps = mbps(primary.rx_sec)
      last.upMbps = mbps(primary.tx_sec)
      last.iface = primary.iface || ''
    }
    // inetLatency spawns a ping process, so only check it every 5th tick.
    if (pingHost && tickCount % 5 === 0) {
      const latency = await si.inetLatency(pingHost).catch(() => 0)
      last.pingMs = Math.round(latency) || 0
    }
    tickCount++
    last.at = Date.now()
    if (typeof onUpdate === 'function') onUpdate({ ...last })
  } catch (err) {
    console.error('Network stats error:', err.message)
  } finally {
    ticking = false
  }
}

function startNetworkStats (listener, { intervalMs = 5000, pingHost = '1.1.1.1' } = {}) {
  onUpdate = listener
  stopNetworkStats()
  acquireSiShell() // reuse one PowerShell for all WMI queries instead of spawning per call
  tick(pingHost)
  pollTimer = setInterval(() => tick(pingHost), Math.max(2000, intervalMs))
}

function stopNetworkStats () {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    releaseSiShell()
  }
}

function getNetworkStats () {
  return { ...last }
}

module.exports = { startNetworkStats, stopNetworkStats, getNetworkStats, isRealAdapter }

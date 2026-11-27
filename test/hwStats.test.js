'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseNvidiaCsv, parseGpuEngineCsv, pickCpuTemp } = require('../modules/stats/hwSources')
const { ChatboxComposer } = require('../modules/vrchat/chatbox/chatboxComposer')
const { resolveTokens } = require('../modules/vrchat/status/statusModule')

test('nvidia-smi CSV: every GPU, numbers parsed, [N/A] becomes null', () => {
  const g = parseNvidiaCsv('NVIDIA GeForce GTX 980 Ti, 38, 63, 3663, 6144\r\nNVIDIA GeForce RTX 4090, [N/A], 41, 1200, 24564\r\n')
  assert.equal(g.length, 2)
  assert.deepEqual(g[0], { name: 'NVIDIA GeForce GTX 980 Ti', load: 38, temp: 63, vramUsedMb: 3663, vramTotalMb: 6144 })
  assert.equal(g[1].load, null)
})

test('Windows GPU engine counters: summed per adapter, busiest adapter wins, capped at 100', () => {
  const csv = [
    '"(PDH-CSV 4.0)","\\\\PC\\GPU Engine(pid_1_luid_0x00000000_0x00012070_phys_0_eng_0_engtype_3D)\\Utilization Percentage","\\\\PC\\GPU Engine(pid_2_luid_0x00000000_0x00012070_phys_0_eng_0_engtype_3D)\\Utilization Percentage","\\\\PC\\GPU Engine(pid_3_luid_0x00000000_0x0000abcd_phys_0_eng_0_engtype_3D)\\Utilization Percentage"',
    '"11/27/2026 12:12:16.748","20.5","9.5","4.0"'
  ].join('\r\n')
  assert.equal(parseGpuEngineCsv(csv), 30)
  assert.equal(parseGpuEngineCsv('nothing useful'), null)
})

test('LibreHardwareMonitor CPU temperature prefers the package sensor', () => {
  assert.equal(pickCpuTemp('CPU Core #1|61\r\nCPU Package|67.5\r\nCore Max|70'), 67.5)
  assert.equal(pickCpuTemp('Core (Tctl/Tdie)|72'), 72)
  assert.equal(pickCpuTemp(''), null)
})

test('unknown temperatures drop out of the chatbox instead of showing 0', () => {
  const c = new ChatboxComposer({ sendChatboxMessage: () => {} })
  c.update({ cpu: 70, cpuTemp: 0, gpu: 30, gpuTemp: 0, ramPct: 75, cpuName: 'Intel Core i7-6700K', gpuName: 'NVIDIA GeForce GTX 980 Ti', vramUsed: 3.6, vramTotal: 6 })
  const t = c.tokenMap()
  assert.equal(t.cputemp, '')
  assert.equal(t.gputemp, '')
  assert.equal(t.gpuname, 'NVIDIA GeForce GTX 980 Ti')
  assert.equal(resolveTokens('{gpuname} {vram}/{vramtotal}GB', t), 'NVIDIA GeForce GTX 980 Ti 3.6/6GB')
  assert.equal(c.lineFor('stats'), '🖥 CPU 70% | GPU 30% | RAM 75%')
  c.update({ cpuTemp: 55, gpuTemp: 62 })
  assert.equal(c.lineFor('stats'), '🖥 CPU 70% 55°C | GPU 30% 62°C | RAM 75%')
})

test('network stats skip VPN / virtual adapters (default iface was an idle VPN → 0 Mbps)', () => {
  const { isRealAdapter } = require('../modules/stats/networkStats')
  for (const n of ['Ethernet', 'Wi-Fi', 'Ethernet 2']) assert.equal(isRealAdapter({ iface: n, operstate: 'up' }), true, n)
  for (const n of ['Radmin VPN', 'Tailscale', 'ZeroTier One [abc]', 'VMware Network Adapter VMnet8', 'vEthernet (Default Switch)', 'TAP-Windows Adapter V9', 'Hamachi']) assert.equal(isRealAdapter({ iface: n, operstate: 'up' }), false, n)
  assert.equal(isRealAdapter({ iface: 'Ethernet', operstate: 'down' }), false)
  assert.equal(isRealAdapter({ iface: 'Ethernet', virtual: true }), false)
})

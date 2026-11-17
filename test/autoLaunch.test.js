'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createAutoLauncher } = require('../modules/vrchat/launcher/autoLaunch')

function harness (apps, { mode = 'vr', alreadyRunning = [] } = {}) {
  let vrc = false; let pid = 100
  const spawned = []; const killed = []
  const hooks = {
    isVrchatRunning: cb => cb(vrc),
    isExeRunning: (exe, cb) => cb(alreadyRunning.includes(exe)),
    spawnApp: app => { spawned.push(app.path); return /\.exe$/i.test(app.path) ? ++pid : 0 },
    killTree: p => killed.push(p)
  }
  const al = createAutoLauncher({ getApps: () => apps, detectMode: cb => cb(mode), hooks })
  return { al, spawned, killed, setVrc: v => { vrc = v } }
}
const apps = [
  { id: '1', path: 'C:\\Tools\\OVRToolkit.exe', mode: 'vr', closeWithVRChat: true, enabled: true },
  { id: '2', path: 'C:\\Tools\\Desk.exe', mode: 'desktop', closeWithVRChat: true, enabled: true },
  { id: '3', path: 'C:\\Tools\\VRCX.exe', mode: 'always', closeWithVRChat: false, enabled: true },
  { id: '4', path: 'C:\\Tools\\Off.exe', mode: 'always', enabled: false },
  { id: '5', path: 'C:\\Links\\Thing.lnk', mode: 'always', closeWithVRChat: true, enabled: true }
]

test('starts matching apps when VRChat starts, closes the chosen ones when it exits', () => {
  const h = harness(apps, { mode: 'vr' })
  h.al.tick() // first tick: VRChat not running -> baseline
  h.setVrc(true); h.al.tick()
  assert.deepEqual(h.spawned, ['C:\\Tools\\OVRToolkit.exe', 'C:\\Tools\\VRCX.exe', 'C:\\Links\\Thing.lnk'])
  h.setVrc(false); h.al.tick()
  assert.deepEqual(h.killed, [101]) // OVRToolkit only: VRCX has close off, the shortcut has no pid
})

test('desktop mode, already-running apps and an already-running VRChat', () => {
  const h = harness(apps, { mode: 'desktop', alreadyRunning: ['VRCX.exe'] })
  h.al.tick(); h.setVrc(true); h.al.tick()
  assert.deepEqual(h.spawned, ['C:\\Tools\\Desk.exe', 'C:\\Links\\Thing.lnk'])
  const h2 = harness(apps)
  h2.setVrc(true); h2.al.tick() // VRChat was already running when KitsuNexus started
  assert.deepEqual(h2.spawned, [])
})

test('unknown mode only starts "always" apps', () => {
  const h = harness(apps, { mode: '' })
  h.al.tick(); h.setVrc(true); h.al.tick()
  assert.deepEqual(h.spawned, ['C:\\Tools\\VRCX.exe', 'C:\\Links\\Thing.lnk'])
})

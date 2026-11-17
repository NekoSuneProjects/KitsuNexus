'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { sanitize, getVrBattery, startVrBattery, stopVrBattery } = require('../modules/vrchat/vr/vrBattery')

test('SteamVR helper response requires a devices array', () => {
  assert.throws(() => sanitize(null), /Invalid/)
  assert.throws(() => sanitize({ available: true }), /Invalid/)
})

test('SteamVR helper sanitizes roles, battery bounds and names', () => {
  const data = sanitize({ available: true, devices: [
    { role: 'tracker', name: 'A'.repeat(200), battery: 1.5, connected: true, charging: true },
    { role: 'malicious', battery: -2, connected: 'yes' },
    { role: 'hmd', battery: null, tracked: false }
  ] })
  assert.equal(data.available, true)
  assert.equal(data.devices.length, 3)
  assert.equal(data.devices[0].battery, 1)
  assert.equal(data.devices[0].name.length, 100)
  assert.equal(data.devices[1].role, 'other')
  assert.equal(data.devices[1].battery, 0)
  assert.equal(data.devices[1].connected, false)
  assert.equal(data.devices[2].battery, null)
  assert.equal(data.devices[2].tracked, false)
})

test('SteamVR helper limits output and provides safe unavailable reason', () => {
  const data = sanitize({ available: false, reason: 'x'.repeat(300), devices: Array(100).fill({ role: 'tracker', battery: 0.4 }) })
  assert.equal(data.devices.length, 64)
  assert.equal(data.reason.length, 160)
})

test('SteamVR monitor can stop and returns a defensive copy', () => {
  startVrBattery(() => {}, 5000)
  stopVrBattery()
  const first = getVrBattery()
  first.devices.push({ role: 'fake' })
  assert.equal(getVrBattery().devices.some(d => d.role === 'fake'), false)
})

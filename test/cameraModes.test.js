'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const M = require('../modules/vrchat/tracking/cameraModes')
const res = caps => M.resolutionsFor(caps).map(r => `${r.width}x${r.height}`)

test('4K camera: offers 4K down to 240p, Auto stays 720p@30', () => {
  const caps = { width: { min: 160, max: 3840 }, height: { min: 120, max: 2160 }, frameRate: { min: 1, max: 30 } }
  const r = res(caps)
  assert.equal(r[0], '3840x2160'); assert.ok(r.includes('1920x1080') && r.includes('1280x720') && r.includes('320x240'))
  assert.deepEqual(M.fpsFor(caps), [30, 25, 24, 20, 15, 10, 5])
  assert.deepEqual(M.autoMode(caps), { width: 1280, height: 720, fps: 30 })
})

test('720p-only camera with 60 fps: nothing above 720p, 60 offered', () => {
  const caps = { width: { min: 320, max: 1280 }, height: { min: 240, max: 720 }, frameRate: { min: 5, max: 60 } }
  const r = res(caps)
  assert.equal(r[0], '1280x720'); assert.ok(!r.includes('1920x1080'))
  assert.equal(M.fpsFor(caps)[0], 60)
})

test('odd sensor size and odd max fps are offered as "camera max"', () => {
  const caps = { width: { min: 1, max: 2592 }, height: { min: 1, max: 1944 }, frameRate: { min: 1, max: 29.97 } }
  const list = M.resolutionsFor(caps)
  assert.deepEqual([list[0].width, list[0].height, list[0].label], [2592, 1944, 'max'])
  assert.match(M.label(list[0]), /camera max/)
  assert.equal(M.fpsFor(caps)[0], 30)
})

test('low-end 480p@15 camera: Auto falls back to what it has', () => {
  const caps = { width: { min: 160, max: 640 }, height: { min: 120, max: 480 }, frameRate: { min: 5, max: 15 } }
  assert.deepEqual(M.autoMode(caps), { width: 640, height: 480, fps: 15 })
})

test('unknown camera: safe list up to 1080p; constraints for Auto and manual', () => {
  const r = res(null)
  assert.equal(r[0], '1920x1080'); assert.ok(!r.includes('3840x2160'))
  assert.deepEqual(M.constraintsFor({ width: 0, height: 0, fps: 0 }, null), { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } })
  assert.deepEqual(M.constraintsFor({ width: 3840, height: 2160, fps: 60 }, null), { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } })
  assert.deepEqual(M.constraintsFor({ width: 1920, height: 1080, fps: 0 }, null).frameRate, { ideal: 30 })
})

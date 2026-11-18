'use strict'
// Kinect v1 skeleton -> the 33-point pose layout bodyTracking.js uses.
const test = require('node:test')
const assert = require('node:assert/strict')
const { kinectToPose, KJ } = require('../modules/vrchat/tracking/kinect')
const BT = require('../modules/vrchat/tracking/bodyTracking')
const { createTrackingEngine } = require('../modules/vrchat/tracking/trackingEngine')

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b} (±${e})`)

// A person standing 2 m in front of the Kinect, facing it. Kinect skeleton space:
// +x = the user's right, +y up, +z away from the sensor. [x, y, z, state(2 = tracked), u, v]
function standing (tweak = {}) {
  const J = new Array(20)
  const set = (k, x, y, state = 2) => { J[KJ[k]] = [x, y, 2.0, state, 0.5 + x * 0.3, 0.5 - y * 0.3] }
  set('HipCenter', 0, 0); set('Spine', 0, 0.2); set('ShoulderCenter', 0, 0.5); set('Head', 0, 0.7)
  set('ShoulderLeft', -0.2, 0.5); set('ElbowLeft', -0.22, 0.25); set('WristLeft', -0.22, 0); set('HandLeft', -0.22, -0.05)
  set('ShoulderRight', 0.2, 0.5); set('ElbowRight', 0.22, 0.25); set('WristRight', 0.22, 0); set('HandRight', 0.22, -0.05)
  set('HipLeft', -0.1, 0); set('KneeLeft', -0.1, -0.45); set('AnkleLeft', -0.1, -0.85); set('FootLeft', -0.1, -0.9)
  set('HipRight', 0.1, 0); set('KneeRight', 0.1, -0.45); set('AnkleRight', 0.1, -0.85); set('FootRight', 0.1, -0.9)
  for (const [k, v] of Object.entries(tweak)) J[KJ[k]] = v
  return J
}

test('kinect: standing skeleton reads as upright, neutral, detected', () => {
  const pose = kinectToPose(standing())
  assert.equal(pose.world.length, 33); assert.equal(pose.image.length, 33)
  const body = BT.readPose(pose)
  const bp = BT.computeBodyParams(body, {})
  assert.equal(bp['BT/Detected'], true); assert.equal(bp['BT/Lying'], 0)
  for (const k of ['BT/LeftUpperLegX', 'BT/LeftKnee', 'BT/SpineBend', 'BT/SpineSide']) near(bp[k], 0, 1e-6)
  assert.equal(bp['BT/LegsVisible'], true)
})

test('kinect: left/right and forward/back map like the webcam pose', () => {
  // right arm straight out to the user's right (+x in Kinect space)
  const armOut = BT.computeBodyParams(BT.readPose(kinectToPose(standing({ ElbowRight: [0.45, 0.5, 2, 2, 0.6, 0.35], WristRight: [0.7, 0.5, 2, 2, 0.7, 0.35] }))), {})
  near(armOut['BT/RightUpperArmZ'], 0.5, 1e-6)
  near(armOut['BT/LeftUpperArmZ'], Math.atan2(0.02, 0.25) / Math.PI, 1e-6)
  // left knee raised towards the sensor (smaller z = towards the Kinect = the user's forward)
  const kneeUp = BT.computeBodyParams(BT.readPose(kinectToPose(standing({ KneeLeft: [-0.1, 0, 1.55, 2, 0.47, 0.5], AnkleLeft: [-0.1, -0.4, 1.55, 2, 0.47, 0.62] }))), {})
  near(kneeUp['BT/LeftUpperLegX'], 1, 1e-6); near(kneeUp['BT/LeftKnee'], 90 / 150, 1e-6)
  // lean forward: shoulders towards the sensor
  const s30 = Math.sin(Math.PI / 6); const c30 = Math.cos(Math.PI / 6)
  const lean = BT.computeBodyParams(BT.readPose(kinectToPose(standing({ ShoulderLeft: [-0.2, 0.5 * c30, 2 - 0.5 * s30, 2, 0.44, 0.37], ShoulderRight: [0.2, 0.5 * c30, 2 - 0.5 * s30, 2, 0.56, 0.37] }))), {})
  near(lean['BT/SpineBend'], 0.5, 1e-6)
})

test('kinect: inferred joints (e.g. legs behind a desk) count as not seen', () => {
  const t = {}
  for (const k of ['KneeLeft', 'KneeRight', 'AnkleLeft', 'AnkleRight', 'FootLeft', 'FootRight']) { const s = standing()[KJ[k]]; t[k] = [s[0], s[1], s[2], 1, s[4], s[5]] }
  const bp = BT.computeBodyParams(BT.readPose(kinectToPose(standing(t))), {})
  assert.equal(bp['BT/LegsVisible'], false)
  for (const k of ['BT/LeftUpperLegX', 'BT/LeftKnee', 'BT/Crouch']) assert.equal(bp[k], 0, k)
  assert.equal(kinectToPose(null), null)
})

test('kinect: engine takes Kinect body frames only when the Kinect is the body source', () => {
  const sent = []
  const eng = createTrackingEngine({ send: m => sent.push(...m) })
  eng.setConfig({ body: true, bodyTrackers: true, bodySource: 'camera' })
  eng.onKinectFrame({ t: 1000, pose: kinectToPose(standing()) })
  assert.equal(sent.filter(m => m.address.startsWith('/tracking/trackers')).length, 0, 'ignored while the webcam is the source')
  eng.setConfig({ bodySource: 'kinect' })
  eng.onKinectFrame({ t: 1033, pose: kinectToPose(standing()) })
  assert.ok(sent.some(m => m.address === '/tracking/trackers/1/position'), 'VR OSC trackers (FBT) from the Kinect')
  assert.equal(eng.status().body.detected, true)
  // webcam frames no longer drive the body
  const before = sent.length
  eng.onFrame({ t: 1066, pose: null })
  assert.equal(sent.length, before)
})

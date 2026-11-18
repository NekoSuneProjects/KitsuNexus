'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const UE = require('../modules/vrchat/tracking/unifiedExpressions')
const FT = require('../modules/vrchat/tracking/ftParams')
const HT = require('../modules/vrchat/tracking/handParams')
const { createTrackingEngine } = require('../modules/vrchat/tracking/trackingEngine')
const { findAvatarConfig } = require('../modules/vrchat/tracking/avatarConfig')
const { createOscBundles, decodeOscMessage } = require('../modules/vrchat/osc/oscEncode')

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -45, 1] // identity rotation, z = -45 (column-major)
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`)

test('MediaPipe blendshapes -> raw values (FoxyFace mapping incl. eye swap) and head pose', () => {
  const raw = UE.rawFromMediaPipe({
    blendshapes: [{ categoryName: '_neutral', score: 1 }, { categoryName: 'jawOpen', score: 0.7 }, { categoryName: 'eyeLookInLeft', score: 0.4 }, { categoryName: 'eyeLookUpRight', score: 0.2 }, { categoryName: 'eyeBlinkLeft', score: 0.9 }],
    matrix: I4, chin: { x: 0.5, y: 0.6 }
  })
  near(raw.jawOpen, 0.7); near(raw.EyeXRight, 0.4); near(raw.EyeYRight, 0.2); near(raw.EyeXLeft, 0)
  near(raw.HeadX, 0.5); near(raw.HeadY, 0.4); near(raw.HeadZ, -45)
  near(raw.HeadPitch, 0); near(raw.HeadYaw, 0); near(raw.HeadRoll, 0)
  // 45° yaw about Y
  const c = Math.cos(Math.PI / 4); const s = Math.sin(Math.PI / 4)
  const yaw = UE.headRotation([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
  near(Math.abs(yaw.yaw), 0.5, 1e-6); near(yaw.pitch, 0); near(yaw.roll, 0)
})

test('calibration and Unified Expressions', () => {
  const cal = UE.calibrate({ jawOpen: 0.55, HeadX: 0.6, HeadPitch: 0.3 }, { jawOpen: { neutral: 0.1, max: 1 }, HeadX: { neg: 0.4, neutral: 0.6, pos: 0.8 } })
  near(cal.jawOpen, 0.5); near(cal.HeadX, 0); near(cal.HeadPitch, 0.3)
  const d = UE.toUnified({ jawOpen: 0.5, mouthSmileLeft: 0.8, mouthFunnel: 0.3, eyeBlinkLeft: 0.25, eyeBlinkRight: 1 }, { intensity: 1.5 })
  near(d.shapes.JawOpen, 0.75); near(d.shapes.MouthCornerPullLeft, 1); near(d.shapes.LipFunnelLowerRight, 0.45)
  near(d.eye.left.openness, 0.75); near(d.eye.right.openness, 0)
  const m = UE.toUnified({ mouthSmileLeft: 0.8 }, { mirror: true })
  near(m.shapes.MouthCornerPullRight, 0.8); near(m.shapes.MouthCornerPullLeft, 0)
})

// A VRCFT-style avatar: float, bool, binary (+Negative) params and status bools.
const AVATAR = [
  { address: '/avatar/parameters/FT/v2/JawOpen', type: 'Float' },
  { address: '/avatar/parameters/FT/v2/EyeLidLeft', type: 'Float' },
  { address: '/avatar/parameters/FT/v2/EyeLeftX', type: 'Float' },
  { address: '/avatar/parameters/FT/v2/SmileFrownLeft1', type: 'Bool' },
  { address: '/avatar/parameters/FT/v2/SmileFrownLeft2', type: 'Bool' },
  { address: '/avatar/parameters/FT/v2/SmileFrownLeft4', type: 'Bool' },
  { address: '/avatar/parameters/FT/v2/SmileFrownLeftNegative', type: 'Bool' },
  { address: '/avatar/parameters/FT/v2/SmileFrownLeft3', type: 'Bool' }, // not a power of two -> ignored
  { address: '/avatar/parameters/FT/v1/JawOpen', type: 'Float' }, // old version prefix -> ignored
  { address: '/avatar/parameters/ExpressionTrackingActive', type: 'Bool' },
  { address: '/avatar/parameters/HT/LeftIndexCurl', type: 'Float' },
  { address: '/avatar/parameters/HT/LeftGesture', type: 'Int' },
  { address: '/avatar/parameters/HT/RightDetected', type: 'Bool' }
]

test('avatar plan matches VRCFT rules; binary encoding', () => {
  const plan = FT.planForAvatar(AVATAR)
  assert.deepEqual(plan.floats.map(f => f.address).sort(), ['/avatar/parameters/FT/v2/EyeLeftX', '/avatar/parameters/FT/v2/EyeLidLeft', '/avatar/parameters/FT/v2/JawOpen'])
  assert.equal(plan.binaries.length, 1); assert.equal(plan.binaries[0].bits.length, 3); assert.equal(plan.binaries[0].max, 8)
  assert.equal(plan.status.length, 1)
  assert.deepEqual(plan.native, { gaze: false, lid: false }) // avatar has FT eye params
  assert.deepEqual(FT.planForAvatar([]).native, { gaze: true, lid: true })
  assert.equal(FT.planForAvatar(AVATAR, { fullFaceTracking: true }).floats.length, 0)

  const d = UE.toUnified({ mouthSmileLeft: 0, mouthFrownLeft: 0.5 })
  const out = FT.evaluate(plan, d)
  const v = a => out.find(o => o.address.endsWith(a)).value
  // SmileFrownLeft = -0.5 -> Negative true, |0.5|*8 = 4 -> bits 1:0 2:0 4:1
  assert.equal(v('SmileFrownLeftNegative'), true); assert.equal(v('SmileFrownLeft1'), false); assert.equal(v('SmileFrownLeft2'), false); assert.equal(v('SmileFrownLeft4'), true)
  assert.equal(v('ExpressionTrackingActive'), true)
  assert.equal(FT.binaryStep(8), 3); assert.equal(FT.binaryStep(6), null)

  const native = FT.evaluate(FT.planForAvatar([]), UE.toUnified({ EyeXLeft: 1, EyeXRight: 1, eyeBlinkLeft: 0, eyeBlinkRight: 0 }))
  const lr = native.find(o => o.address === '/tracking/eye/LeftRightPitchYaw')
  near(lr.value[1], 45, 1e-9); near(lr.value[3], 45, 1e-9)
  near(native.find(o => o.address === '/tracking/eye/EyesClosedAmount').value, 0)
})

// Synthetic hand: wrist at origin, fingers along +y. curl=0 -> straight, curl=1 -> folded.
function hand (curl = 0, thumbOut = true) {
  const pts = [[0, 0, 0]]
  const finger = (x, bendRad) => { let p = [x, 0.3, 0]; const out = [p]; let ang = 0; for (let i = 0; i < 3; i++) { ang += bendRad; p = [p[0], p[1] + 0.1 * Math.cos(ang), p[2] + 0.1 * Math.sin(ang)]; out.push(p) } return out }
  const thumb = finger(-0.3, thumbOut ? 0 : 1.2)
  pts.push(...thumb)
  for (const x of [-0.15, 0, 0.15, 0.3]) pts.push(...finger(x, curl * 1.4))
  return pts
}

test('hand tracking: curls, gestures, handedness swap, params', () => {
  const open = HT.fingerCurls(hand(0)); const fist = HT.fingerCurls(hand(1, false))
  assert.ok(open.Index < 0.25, 'open index straight'); assert.ok(fist.Index > 0.6, 'fist index curled')
  assert.equal(HT.classifyGesture(open), HT.GESTURES.HandOpen)
  assert.equal(HT.classifyGesture(fist), HT.GESTURES.Fist)
  assert.equal(HT.classifyGesture({ Thumb: 0.1, Index: 0.1, Middle: 0.9, Ring: 0.9, Pinky: 0.9 }), HT.GESTURES.HandGun)
  assert.equal(HT.classifyGesture({ Thumb: 0.9, Index: 0.1, Middle: 0.1, Ring: 0.9, Pinky: 0.9 }), HT.GESTURES.Victory)
  assert.equal(HT.classifyGesture({ Thumb: 0.1, Index: 0.9, Middle: 0.9, Ring: 0.9, Pinky: 0.9 }), HT.GESTURES.ThumbsUp)

  const hands = HT.handsFromMediaPipe([{ handedness: 'Left', score: 0.9, world: hand(1, false), image: hand(1, false).map(p => [0.2, 0.5, 0]) }])
  assert.ok(hands.Right && !hands.Left, 'MediaPipe "Left" on a raw webcam frame is the user\'s right hand')
  assert.equal(HT.handsFromMediaPipe([{ handedness: 'Left', score: 0.9, world: hand(0) }], { mirrored: true }).Left.gesture, HT.GESTURES.HandOpen)

  const plan = HT.planHands(AVATAR)
  assert.deepEqual(plan.map(p => p.name).sort(), ['HT/LeftGesture', 'HT/LeftIndexCurl', 'HT/RightDetected'])
  const vals = HT.evaluateHands(plan, hands)
  assert.equal(vals.find(v => v.address.endsWith('RightDetected')).value, true)
  assert.equal(vals.find(v => v.address.endsWith('LeftGesture')).type, 'int')
})

test('engine: avatar from OSC config, only changed values sent, face-lost, calibration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-osc-'))
  fs.mkdirSync(path.join(dir, 'usr_x', 'Avatars'), { recursive: true })
  const cfg = { id: 'avtr_test', name: 'Test', parameters: AVATAR.map(p => ({ name: p.address.replace('/avatar/parameters/', ''), input: { address: p.address, type: p.type }, output: { address: p.address, type: p.type } })) }
  fs.writeFileSync(path.join(dir, 'usr_x', 'Avatars', 'avtr_test.json'), '﻿' + JSON.stringify(cfg))
  assert.equal(findAvatarConfig('avtr_test', dir).parameters.length, AVATAR.length)
  assert.equal(findAvatarConfig('../etc', dir), null)

  let clock = 1000
  const sent = []
  const store = {}
  const eng = createTrackingEngine({ send: m => sent.push(...m), now: () => clock, loadSettings: k => store[k], saveSettings: (k, v) => { store[k] = v } })
  eng.setConfig({ minCutoff: 10, beta: 0 })
  eng.loadNewestAvatar(dir)
  assert.equal(eng.status().avatar.id, 'avtr_test')
  const face = jaw => ({ blendshapes: [{ categoryName: 'jawOpen', score: jaw }, { categoryName: 'eyeBlinkLeft', score: 0 }], matrix: I4, chin: { x: 0.5, y: 0.5 } })
  eng.onFrame({ t: clock, face: face(0.5), hands: [] })
  const first = sent.length
  assert.ok(sent.some(m => m.address.endsWith('/FT/v2/JawOpen')))
  assert.ok(sent.some(m => m.address.endsWith('/HT/RightDetected') && m.value === false))
  clock += 33; eng.onFrame({ t: clock, face: face(0.5), hands: [] })
  assert.equal(sent.length, first, 'nothing changed -> nothing sent')
  clock += 1000; eng.onFrame({ t: clock, face: null, hands: null })
  assert.ok(sent.some(m => m.address.endsWith('ExpressionTrackingActive') && m.value === false), 'face lost -> tracking inactive')

  eng.startCalibration(0.05)
  for (let i = 0; i < 5; i++) { clock += 20; eng.onFrame({ t: clock, face: face(0.2), hands: null }) }
  assert.ok(store.calibration && Math.abs(store.calibration.jawOpen.neutral - 0.2) < 0.05)
  assert.equal(eng.status().calibrated, true)
})

test('OSC bundles stay under 4096 bytes and decode', () => {
  const msgs = Array.from({ length: 300 }, (_, i) => ({ address: `/avatar/parameters/FT/v2/Param${i}`, args: [{ type: 'float', value: i / 300 }] }))
  const bundles = createOscBundles(msgs)
  assert.ok(bundles.length > 1)
  assert.ok(bundles.every(b => b.length <= 4096 && b.toString('utf8', 0, 7) === '#bundle'))
  // first element decodes back
  const firstLen = bundles[0].readInt32BE(16)
  const first = decodeOscMessage(bundles[0].subarray(20, 20 + firstLen))
  assert.equal(first.address, '/avatar/parameters/FT/v2/Param0')
})

test('"Send every parameter (testing)" still drives the avatar\'s real (prefixed / binary) parameters', () => {
  const FT = require('../modules/vrchat/tracking/ftParams')
  const HT = require('../modules/vrchat/tracking/handParams')
  const P = '/avatar/parameters/'
  const avatar = [
    { address: P + 'EchoFT/v2/JawOpen', type: 'Float' },
    ...[1, 2, 4, 8].map(n => ({ address: P + `OSCm/Binary/EchoFT/v2/JawOpen${n}`, type: 'Bool' })),
    { address: P + 'Tracking/HT/LeftIndexCurl', type: 'Float' }
  ]
  const plan = FT.planForAvatar(avatar, { sendAll: true })
  const jaw = plan.floats.find(f => f.def.name === 'v2/JawOpen')
  assert.equal(jaw.address, P + 'EchoFT/v2/JawOpen', 'uses the avatar\'s own address, not /avatar/parameters/v2/JawOpen')
  assert.equal(plan.binaries.find(b => b.def.name === 'v2/JawOpen').bits.length, 4, 'binary bits still sent')
  assert.ok(plan.floats.some(f => f.generic && f.address === P + 'v2/MouthClosed'), 'params the avatar lacks still go out generically')
  const hands = HT.planHands(avatar, { sendAll: true })
  assert.equal(hands.find(h => h.name === 'HT/LeftIndexCurl').address, P + 'Tracking/HT/LeftIndexCurl')
})

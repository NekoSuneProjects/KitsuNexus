'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const BT = require('../modules/vrchat/tracking/bodyTracking')
const { createTrackingEngine } = require('../modules/vrchat/tracking/trackingEngine')

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b} (±${e})`)

// Standing skeleton in VRChat space (X = wearer's right, Y up, Z = wearer's forward,
// metres, hips at origin), facing the camera.
function skeletonVrc (tweak = {}) {
  const p = Array.from({ length: 33 }, () => [0, 0, 0])
  const set = (i, x, y, z) => { p[i] = [x, y, z] }
  set(0, 0, 0.7, 0.1) // nose (level with the ears)
  set(7, -0.08, 0.7, 0); set(8, 0.08, 0.7, 0) // ears (left = −X)
  set(11, -0.2, 0.5, 0); set(12, 0.2, 0.5, 0) // shoulders
  set(13, -0.22, 0.25, 0); set(14, 0.22, 0.25, 0) // elbows (arms down)
  set(15, -0.22, 0, 0); set(16, 0.22, 0, 0) // wrists
  set(23, -0.1, 0, 0); set(24, 0.1, 0, 0) // hips
  set(25, -0.1, -0.45, 0); set(26, 0.1, -0.45, 0) // knees
  set(27, -0.1, -0.85, 0); set(28, 0.1, -0.85, 0) // ankles
  set(29, -0.1, -0.9, -0.05); set(30, 0.1, -0.9, -0.05) // heels (behind)
  set(31, -0.1, -0.9, 0.12); set(32, 0.1, -0.9, 0.12) // toes (forward)
  for (const [i, xyz] of Object.entries(tweak)) p[i] = xyz
  return p
}
// VRChat space -> MediaPipe world (all axes flipped), visibility 1.
const toMp = pts => pts.map(([x, y, z]) => [-x, -y, -z, 1])
const yaw = (pts, deg) => { const t = deg * Math.PI / 180; return pts.map(([x, y, z]) => [x * Math.cos(t) + z * Math.sin(t), y, -x * Math.sin(t) + z * Math.cos(t)]) }
const pose = vrcPts => ({ world: toMp(vrcPts), image: toMp(vrcPts).map(p => [0.5, 0.5, 0, 1]) })

test('axis conversion: MediaPipe -> VRChat, left/right preserved', () => {
  const body = BT.readPose(pose(skeletonVrc()))
  near(body.pts[BT.P.leftHip][0], -0.1); near(body.pts[BT.P.rightHip][0], 0.1)
  near(body.pts[BT.P.leftShoulder][1], 0.5)
  near(body.pts[BT.P.leftFootIndex][2], 0.12)
  // mirrored camera: MediaPipe's "left" is the wearer's right, x is not flipped
  const mpMirrored = toMp(skeletonVrc()).map(([x, y, z, v]) => [-x, y, z, v])
  // in a mirrored image the wearer's right hip shows up labelled as MediaPipe "left"
  ;[[23, 24], [11, 12], [25, 26], [27, 28]].forEach(([a, b]) => { [mpMirrored[a], mpMirrored[b]] = [mpMirrored[b], mpMirrored[a]] })
  const m = BT.readPose({ world: mpMirrored }, { mirrored: true })
  near(m.pts[BT.P.leftHip][0], -0.1); near(m.pts[BT.P.rightHip][0], 0.1)
})

test('OSC trackers: positions on the floor, neutral and yawed rotations', () => {
  const r = BT.computeTrackers(BT.readPose(pose(skeletonVrc())), { height: 1.75 })
  const T = r.trackers
  assert.deepEqual(Object.keys(T).sort(), ['chest', 'head', 'hip', 'leftFoot', 'leftKnee', 'rightFoot', 'rightKnee'])
  near(r.hipHeight, 0.9, 1e-9) // heels + toes on the floor
  near(T.hip.pos[1], 0.9); near(T.leftFoot.pos[1], 0.05, 1e-9); near(T.leftFoot.pos[0], -0.1)
  for (const k of ['hip', 'chest', 'leftFoot', 'leftKnee', 'head']) T[k].rot.forEach(a => near(a, 0, 1e-6))
  // turn 30° to the wearer's right: Unity yaw +30 on every tracker
  const Y = BT.computeTrackers(BT.readPose(pose(yaw(skeletonVrc(), 30)))).trackers
  for (const k of ['hip', 'chest', 'rightFoot']) { near(Y[k].rot[1], 30, 1e-6); near(Y[k].rot[0], 0, 1e-6); near(Y[k].rot[2], 0, 1e-6) }
  // messages
  const msgs = BT.trackerMessages(T)
  assert.ok(msgs.some(m => m.address === '/tracking/trackers/1/position' && m.value.length === 3))
  assert.ok(msgs.some(m => m.address === '/tracking/trackers/head/rotation'))
  // feet hidden -> no foot trackers, hip height from body height
  const hidden = toMp(skeletonVrc()); for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) hidden[i][3] = 0.1
  const h = BT.computeTrackers(BT.readPose({ world: hidden }), { height: 1.7 })
  assert.equal(h.trackers.leftFoot, undefined); near(h.hipHeight, 1.7 * 0.53, 1e-9)
  // elbows only when asked
  assert.equal(T.leftElbow, undefined)
  assert.ok(BT.computeTrackers(BT.readPose(pose(skeletonVrc())), { enabled: { elbows: true } }).trackers.leftElbow)
})

test('desktop BT params: standing, knee raised, arm out, leaning', () => {
  const st = {}
  const stand = BT.computeBodyParams(BT.readPose(pose(skeletonVrc())), st)
  for (const k of ['BT/LeftUpperLegX', 'BT/LeftUpperLegZ', 'BT/LeftKnee', 'BT/SpineBend', 'BT/SpineSide', 'BT/SpineTwist', 'BT/Crouch']) near(stand[k], 0, 1e-6)
  assert.equal(stand['BT/LegsVisible'], true); assert.equal(stand['BT/Detected'], true)
  near(stand['BT/LeftUpperArmZ'], Math.atan2(0.02, 0.25) / Math.PI, 1e-6) // arms hang down (tiny outward angle)

  // left thigh straight forward, shin straight down: leg X = +1 (90°), knee bent 90°
  const kneeUp = BT.computeBodyParams(BT.readPose(pose(skeletonVrc({ 25: [-0.1, 0, 0.45], 27: [-0.1, -0.4, 0.45] }))), {})
  near(kneeUp['BT/LeftUpperLegX'], 1, 1e-6); near(kneeUp['BT/LeftKnee'], 90 / 150, 1e-6); near(kneeUp['BT/RightUpperLegX'], 0, 1e-6)

  // right arm straight out to the side: arm Z = 0.5 (90° of 180°), elbow straight
  const armOut = BT.computeBodyParams(BT.readPose(pose(skeletonVrc({ 14: [0.45, 0.5, 0], 16: [0.7, 0.5, 0] }))), {})
  near(armOut['BT/RightUpperArmZ'], 0.5, 1e-6); near(armOut['BT/RightElbow'], 0, 1e-6)

  // lean forward 30°: shoulders/head move forward (+Z)
  const s30 = Math.sin(Math.PI / 6); const c30 = Math.cos(Math.PI / 6)
  const lean = skeletonVrc({ 11: [-0.2, 0.5 * c30, 0.5 * s30], 12: [0.2, 0.5 * c30, 0.5 * s30] })
  near(BT.computeBodyParams(BT.readPose(pose(lean)), {})['BT/SpineBend'], 0.5, 1e-6)

  // crouch: hips drop 0.3 m relative to the feet (feet move up in hip-centred coords)
  const crouch = skeletonVrc({ 25: [-0.1, -0.3, 0.2], 26: [0.1, -0.3, 0.2], 27: [-0.1, -0.55, 0], 28: [0.1, -0.55, 0] })
  assert.ok(BT.computeBodyParams(BT.readPose(pose(crouch)), st)['BT/Crouch'] > 0.4)
})

test('engine: body trackers stream every frame, BT params only on change and only if on the avatar', () => {
  const sent = []
  let clock = 1000
  const eng = createTrackingEngine({ send: m => sent.push(...m), now: () => clock, loadSettings: () => undefined, saveSettings: () => {} })
  eng.setConfig({ body: true, minCutoff: 10, beta: 0 })
  eng.setAvatar({ id: 'avtr_x', name: 'x', parameters: [{ address: '/avatar/parameters/BT/LeftKnee', type: 'Float' }, { address: '/avatar/parameters/BT/Detected', type: 'Bool' }] })
  const frame = () => ({ t: clock, face: null, hands: null, pose: pose(skeletonVrc()) })
  eng.onFrame(frame())
  const trackerCount = sent.filter(m => m.address.startsWith('/tracking/trackers/')).length
  assert.ok(trackerCount >= 10)
  assert.ok(sent.some(m => m.address === '/avatar/parameters/BT/LeftKnee'))
  assert.ok(!sent.some(m => m.address.includes('BT/SpineBend')), 'not on the avatar')
  const before = sent.length
  clock += 33; eng.onFrame(frame())
  const added = sent.slice(before)
  assert.equal(added.filter(m => m.address.startsWith('/tracking/')).length, trackerCount, 'trackers resent every frame')
  assert.equal(added.filter(m => m.address.includes('/BT/')).length, 0, 'unchanged params not resent')
  assert.equal(eng.status().body.detected, true)
  // nobody in view
  clock += 33; eng.onFrame({ t: clock, face: null, hands: null, pose: null })
  assert.ok(sent.some(m => m.address.endsWith('BT/Detected') && m.value === false))
})

test('knee tracker keeps a valid orientation when the thigh points straight forward', () => {
  const T = BT.computeTrackers(BT.readPose(pose(skeletonVrc({ 25: [-0.1, 0, 0.45], 27: [-0.1, -0.4, 0.45], 29: [-0.1, -0.45, 0.4], 31: [-0.1, -0.45, 0.57] })))).trackers
  // thigh points forward (+Z): knee "up" is backwards -> pitch ±90°
  near(Math.abs(T.leftKnee.rot[0]), 90, 1e-3)
  assert.ok(T.leftKnee.rot.every(Number.isFinite))
})

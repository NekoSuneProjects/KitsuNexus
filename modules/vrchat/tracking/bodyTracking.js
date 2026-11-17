// modules/vrchat/tracking/bodyTracking.js
// Webcam body tracking (MediaPipe Pose: 33 landmarks, "world" coordinates in
// metres centred between the hips) -> VRChat. Two outputs:
//
// 1. VRChat OSC trackers (real full-body IK) — /tracking/trackers/1..8 and
//    /tracking/trackers/head. Per docs.vrchat.com/docs/osc-trackers: Vector3
//    floats, metres, Unity space (left-handed, Y up), rotations as Euler
//    degrees applied Z, X, Y. VRChat only turns full-body on in VR mode
//    (PC VR, or Quest over the network); on desktop it ignores them.
//
// 2. Desktop body parameters — "BT/…" avatar parameters (joint angles), so
//    an avatar animator can pose legs/spine/arms on desktop, OSC only:
//      BT/Left|RightUpperLegX  float −1..1  hip flex (+ = leg forward), ±90°
//      BT/Left|RightUpperLegZ  float −1..1  hip out to the side (+ = out), ±90°
//      BT/Left|RightKnee       float 0..1   knee bend, 0..150°
//      BT/Left|RightUpperArmX  float −1..1  arm forward (+) / back, ±90°
//      BT/Left|RightUpperArmZ  float −1..1  arm raised out to the side (+), 0..±180° -> ±1
//      BT/Left|RightElbow      float 0..1   elbow bend, 0..150°
//      BT/SpineBend            float −1..1  lean forward (+) / back, ±60°
//      BT/SpineSide            float −1..1  lean to own right (+) / left, ±45°
//      BT/SpineTwist           float −1..1  shoulders turned to own left (+) vs hips, ±60°
//      BT/Crouch               float 0..1   how far the hips dropped (needs feet in view)
//      BT/Detected, BT/LegsVisible  bool
// Pure functions; MAIN process.

// MediaPipe Pose landmark indices
const P = {
  nose: 0, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32
}

/* ---------- small vector maths ---------- */
const v = (x, y, z) => [x, y, z]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const mid = (a, b) => mul(add(a, b), 0.5)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = a => Math.sqrt(dot(a, a))
const norm = a => { const l = len(a) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l] }
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b)))))
const DEG = 180 / Math.PI
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// MediaPipe world (x right in the image, y down, z away from the camera; the
// person faces the camera) -> VRChat/Unity (X = wearer's right, Y up, Z =
// wearer's forward = towards the camera). All three axes flip, which also turns
// MediaPipe's right-handed space into Unity's left-handed one. `mirrored`: the
// camera image is already mirrored, so x is flipped back.
function toVrc (p, mirrored = false) { return [mirrored ? p[0] : -p[0], -p[1], -p[2]] }

// Rotation matrix with columns right/up/forward -> Unity Euler degrees
// (applied Z, X, Y: R = Ry · Rx · Rz).
function eulerFromBasis (right, up, forward) {
  const R = [[right[0], up[0], forward[0]], [right[1], up[1], forward[1]], [right[2], up[2], forward[2]]]
  const x = Math.asin(clamp(-R[1][2], -1, 1))
  const y = Math.atan2(R[0][2], R[2][2])
  const z = Math.atan2(R[1][0], R[1][1])
  return [x * DEG, y * DEG, z * DEG]
}
// Orthonormal basis from an "up" and a rough "forward". If the hint is (nearly)
// parallel to up (e.g. a thigh pointing straight forward), fall back to the
// next hint so the orientation never collapses.
function basisUpForward (up, ...forwardHints) {
  const u = norm(up)
  let r = null
  for (const h of [...forwardHints, [0, -1, 0], [0, 0, 1], [1, 0, 0]]) {
    const c = cross(u, h) // left-handed: right = up × forward
    if (len(c) > 0.2 * len(h)) { r = norm(c); break }
  }
  const f = cross(r, u)
  return { right: r, up: u, forward: f }
}
// Orthonormal basis from a "right" and a rough "up".
function basisRightUp (right, upHint) {
  const r = norm(right)
  const f = norm(cross(r, upHint)) // forward = right × up
  const u = cross(f, r)
  return { right: r, up: u, forward: f }
}
const rot = b => eulerFromBasis(b.right, b.up, b.forward)

/* ---------- input ---------- */
// pose: { world: [[x,y,z,visibility] × 33], image: [[x,y,z,visibility] × 33] }
// Returns points in VRChat space (metres, hips at origin) + visibility.
function readPose (pose, { mirrored = false } = {}) {
  if (!pose || !Array.isArray(pose.world) || pose.world.length < 33) return null
  const pts = pose.world.map(p => toVrc(p, mirrored))
  const vis = pose.world.map((p, i) => {
    const w = Number.isFinite(p[3]) ? p[3] : 1
    const im = pose.image && pose.image[i] && Number.isFinite(pose.image[i][3]) ? pose.image[i][3] : w
    return Math.min(w, im)
  })
  // When the image is mirrored, MediaPipe's "left" landmarks are the wearer's right.
  if (mirrored) {
    const swap = (a, b) => { [pts[a], pts[b]] = [pts[b], pts[a]];[vis[a], vis[b]] = [vis[b], vis[a]] }
    for (const [a, b] of [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]) swap(a, b)
  }
  return { pts, vis }
}

const MIN_VIS = 0.5
const seen = (body, ...idx) => idx.every(i => body.vis[i] >= MIN_VIS)

/* ---------- 1. OSC trackers ---------- */
// Slots: VRChat assigns roles at calibration by where each tracker is, so the
// numbers only need to stay stable.
const TRACKER_SLOTS = { hip: 1, chest: 2, leftFoot: 3, rightFoot: 4, leftKnee: 5, rightKnee: 6, leftElbow: 7, rightElbow: 8 }

// opts: { height (m), enabled: { hip, chest, feet, knees, elbows, head }, floorLock }
// Returns { trackers: { name: { pos, rot } }, hipHeight }.
function computeTrackers (body, opts = {}, state = {}) {
  if (!body) return { trackers: {}, hipHeight: state.hipHeight }
  const { pts } = body
  const en = { hip: true, chest: true, feet: true, knees: true, elbows: false, head: true, ...(opts.enabled || {}) }
  const height = clamp(Number(opts.height) || 1.7, 1, 2.5)
  const hipC = mid(pts[P.leftHip], pts[P.rightHip])
  const shC = mid(pts[P.leftShoulder], pts[P.rightShoulder])
  const torsoUp = sub(shC, hipC)
  const hipRight = sub(pts[P.rightHip], pts[P.leftHip])
  const pelvis = basisRightUp(hipRight, torsoUp)
  const legsSeen = seen(body, P.leftAnkle, P.rightAnkle, P.leftKnee, P.rightKnee)

  // Height of the hips above the floor: from the feet when they're visible
  // (lowest heel/ankle on the floor), otherwise ~53% of body height.
  let hipHeight = height * 0.53
  if (legsSeen && opts.floorLock !== false) {
    // heels/toes touch the floor; ankles sit ~6 cm above it
    const feet = [P.leftHeel, P.rightHeel, P.leftFootIndex, P.rightFootIndex].filter(i => body.vis[i] >= MIN_VIS).map(i => pts[i][1])
    const lowest = feet.length ? Math.min(...feet) : Math.min(pts[P.leftAnkle][1], pts[P.rightAnkle][1]) - 0.06
    hipHeight = clamp(-lowest, 0.15, height * 0.7)
  }
  const place = p => [p[0], p[1] + hipHeight, p[2]]
  const T = {}
  if (en.hip && seen(body, P.leftHip, P.rightHip)) T.hip = { pos: place(hipC), rot: rot(pelvis) }
  if (en.chest && seen(body, P.leftShoulder, P.rightShoulder)) {
    const b = basisRightUp(sub(pts[P.rightShoulder], pts[P.leftShoulder]), torsoUp)
    T.chest = { pos: place(add(hipC, mul(torsoUp, 0.7))), rot: rot(b) }
  }
  for (const side of ['left', 'right']) {
    const S = s => P[side + s]
    if (en.feet && seen(body, S('Ankle'), S('Heel'), S('FootIndex'), S('Knee'))) {
      const b = basisUpForward(sub(pts[S('Knee')], pts[S('Ankle')]), sub(pts[S('FootIndex')], pts[S('Heel')]))
      T[side + 'Foot'] = { pos: place(pts[S('Ankle')]), rot: rot(b) }
    }
    if (en.knees && seen(body, S('Knee'), S('Hip'), S('Ankle'))) {
      // thigh raised forward: its 'forward' is then downwards (the knee faces the floor)
      const b = basisUpForward(sub(pts[S('Hip')], pts[S('Knee')]), pelvis.forward, [0, -1, 0])
      T[side + 'Knee'] = { pos: place(pts[S('Knee')]), rot: rot(b) }
    }
    if (en.elbows && seen(body, S('Elbow'), S('Shoulder'))) {
      const b = basisUpForward(sub(pts[S('Shoulder')], pts[S('Elbow')]), pelvis.forward)
      T[side + 'Elbow'] = { pos: place(pts[S('Elbow')]), rot: rot(b) }
    }
  }
  if (en.head && seen(body, P.leftEar, P.rightEar, P.nose)) {
    const earC = mid(pts[P.leftEar], pts[P.rightEar])
    const b = basisRightUp(sub(pts[P.rightEar], pts[P.leftEar]), torsoUp)
    // tilt the head basis towards where the nose points
    const fwd = norm(add(b.forward, mul(norm(sub(pts[P.nose], earC)), 0.5)))
    const hb = basisRightUp(b.right, cross(fwd, b.right))
    T.head = { pos: place(earC), rot: rot(hb) }
  }
  return { trackers: T, hipHeight }
}

// -> OSC messages ({ address, type: 'floats', value: [x,y,z] }).
function trackerMessages (trackers) {
  const out = []
  for (const [name, t] of Object.entries(trackers || {})) {
    const base = name === 'head' ? '/tracking/trackers/head' : `/tracking/trackers/${TRACKER_SLOTS[name]}`
    if (!base.endsWith('undefined')) {
      out.push({ address: base + '/position', type: 'floats', value: t.pos.map(n => +n.toFixed(4)) })
      out.push({ address: base + '/rotation', type: 'floats', value: t.rot.map(n => +n.toFixed(2)) })
    }
  }
  return out
}

/* ---------- 2. Desktop body parameters (BT/…) ---------- */
function computeBodyParams (body, state = {}) {
  const out = { 'BT/Detected': !!body }
  if (!body) return out
  const { pts } = body
  const hipC = mid(pts[P.leftHip], pts[P.rightHip])
  const shC = mid(pts[P.leftShoulder], pts[P.rightShoulder])
  const torsoUp = sub(shC, hipC)
  // Level pelvis (gravity up, facing from the hips) so leaning the torso shows
  // up as spine bend instead of tilting the reference frame with it.
  const pelvis = basisRightUp(sub(pts[P.rightHip], pts[P.leftHip]), [0, 1, 0])
  const chest = basisRightUp(sub(pts[P.rightShoulder], pts[P.leftShoulder]), torsoUp)
  // components of a direction in a basis
  // `+ 0` turns −0 into 0 so atan2(0, −0) can't flip to ±π
  const local = (d, b) => [dot(d, b.right) + 0, dot(d, b.up) + 0, dot(d, b.forward) + 0]
  const legsSeen = seen(body, P.leftKnee, P.rightKnee, P.leftAnkle, P.rightAnkle)
  out['BT/LegsVisible'] = legsSeen

  for (const side of ['Left', 'Right']) {
    const s = side.toLowerCase()
    const outward = side === 'Right' ? 1 : -1 // +right component means "out" for the right limb
    if (seen(body, P[s + 'Hip'], P[s + 'Knee'])) {
      const thigh = local(sub(pts[P[s + 'Knee']], pts[P[s + 'Hip']]), pelvis) // [right, up, forward]
      out[`BT/${side}UpperLegX`] = clamp(Math.atan2(thigh[2], -thigh[1] + 0) / (Math.PI / 2), -1, 1)
      out[`BT/${side}UpperLegZ`] = clamp(Math.atan2(thigh[0] * outward, -thigh[1] + 0) / (Math.PI / 2), -1, 1)
      if (seen(body, P[s + 'Ankle'])) {
        const bend = angleBetween(sub(pts[P[s + 'Knee']], pts[P[s + 'Hip']]), sub(pts[P[s + 'Ankle']], pts[P[s + 'Knee']]))
        out[`BT/${side}Knee`] = clamp(bend / (150 / DEG), 0, 1)
      }
    }
    if (seen(body, P[s + 'Shoulder'], P[s + 'Elbow'])) {
      const arm = local(sub(pts[P[s + 'Elbow']], pts[P[s + 'Shoulder']]), chest)
      // forward elevation measured against the side plane, so an arm held out to the side reads X = 0
      out[`BT/${side}UpperArmX`] = clamp(Math.atan2(arm[2], Math.hypot(arm[1], arm[0])) / (Math.PI / 2), -1, 1)
      out[`BT/${side}UpperArmZ`] = clamp(Math.atan2(arm[0] * outward, -arm[1] + 0) / Math.PI, -1, 1)
      if (seen(body, P[s + 'Wrist'])) {
        const bend = angleBetween(sub(pts[P[s + 'Elbow']], pts[P[s + 'Shoulder']]), sub(pts[P[s + 'Wrist']], pts[P[s + 'Elbow']]))
        out[`BT/${side}Elbow`] = clamp(bend / (150 / DEG), 0, 1)
      }
    }
  }
  // Spine relative to world vertical / to the hips.
  if (seen(body, P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip)) {
    const up = norm(torsoUp)
    out['BT/SpineBend'] = clamp(Math.atan2(dot(up, pelvis.forward), up[1]) / (60 / DEG), -1, 1)
    out['BT/SpineSide'] = clamp(Math.atan2(dot(up, pelvis.right), up[1]) / (45 / DEG), -1, 1)
    const twist = Math.atan2(dot(chest.right, pelvis.forward), dot(chest.right, pelvis.right)) // + = shoulders turned to own left
    out['BT/SpineTwist'] = clamp(twist / (60 / DEG), -1, 1)
  }
  // Crouch: hips lower than the standing hip height (learned as the max seen).
  if (legsSeen) {
    const hipH = -Math.min(pts[P.leftAnkle][1], pts[P.rightAnkle][1])
    state.standingHip = Math.max(state.standingHip || 0, hipH)
    out['BT/Crouch'] = state.standingHip > 0.2 ? clamp(1 - hipH / state.standingHip, 0, 1) / 0.6 : 0
    out['BT/Crouch'] = clamp(out['BT/Crouch'], 0, 1)
  }
  return out
}

const BODY_PARAMS = (() => {
  const list = [{ name: 'BT/Detected', type: 'Bool' }, { name: 'BT/LegsVisible', type: 'Bool' }]
  for (const side of ['Left', 'Right']) for (const n of ['UpperLegX', 'UpperLegZ', 'Knee', 'UpperArmX', 'UpperArmZ', 'Elbow']) list.push({ name: `BT/${side}${n}`, type: 'Float' })
  for (const n of ['SpineBend', 'SpineSide', 'SpineTwist', 'Crouch']) list.push({ name: `BT/${n}`, type: 'Float' })
  return list
})()

function planBody (avatarParams, { sendAll = false } = {}) {
  const params = Array.isArray(avatarParams) ? avatarParams : []
  const plan = []
  for (const p of BODY_PARAMS) {
    if (sendAll) { plan.push({ ...p, address: '/avatar/parameters/' + p.name }); continue }
    const hit = params.find(a => a.type === p.type && (a.address.endsWith('/' + p.name) || a.address === p.name))
    if (hit) plan.push({ ...p, address: hit.address })
  }
  return plan
}
function evaluateBody (plan, values) {
  const out = []
  for (const p of plan) {
    if (!(p.name in values)) continue // not computed this frame (limb out of view): leave as is
    out.push({ address: p.address, type: p.type === 'Bool' ? 'bool' : 'float', value: p.type === 'Bool' ? !!values[p.name] : values[p.name] })
  }
  return out
}

module.exports = { P, TRACKER_SLOTS, BODY_PARAMS, toVrc, eulerFromBasis, readPose, computeTrackers, trackerMessages, computeBodyParams, planBody, evaluateBody }

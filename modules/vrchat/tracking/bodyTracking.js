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
    const ip = pose.image && pose.image[i]
    const im = ip && Number.isFinite(ip[3]) ? ip[3] : w
    // Outside the camera picture = MediaPipe is guessing (e.g. legs under the desk, hips
    // below the frame). Treat as not seen, whatever visibility it reports.
    const OUT = 0.03
    if (ip && Number.isFinite(ip[0]) && Number.isFinite(ip[1]) && (ip[0] < -OUT || ip[0] > 1 + OUT || ip[1] < -OUT || ip[1] > 1 + OUT)) return 0
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
// How the body lies, from the torso basis (right/up/forward), as the pitch then roll that
// tilt an upright body into it (Unity: AngleAxis(pitch, right) * AngleAxis(roll, forward)).
// Which way it faces around the vertical is free, so only gravity in body space matters:
// g = (worldUp·right, worldUp·up, worldUp·forward) = (cosθ sinφ, cosθ cosφ, −sinθ).
// pitch −1 = on the back, +1 = face down; roll ±1 = ±180° (±0.5 = on a side).
function lyingAngles (b) {
  const gx = b.right[1]; const gy = b.up[1]; const gz = b.forward[1]
  const pitch = Math.asin(clamp(-gz, -1, 1))
  // near ±90° pitch the roll is undefined (any roll = a turn around the vertical): use 0
  const roll = Math.abs(pitch) > 70 / DEG ? 0 : Math.atan2(gx, gy)
  return { pitch: clamp(pitch / (Math.PI / 2), -1, 1), roll: clamp(roll / Math.PI, -1, 1) }
}
// Upper-arm twist from where the bent forearm points around the upper arm:
// 0 = forearm forward, +1 = forearm up (hand raised, arm rolled out), −1 = forearm down.
// Without it a raised hand bends the elbow forward instead of up. A straight arm has no
// visible twist (and no reliable bend plane), so it reads 0.
function armTwist (upper, fore, chestForward, outward, bend) {
  if (!(bend > 25 / DEG)) return 0
  const a = norm(upper)
  let f0 = sub(chestForward, mul(a, dot(chestForward, a)))
  if (len(f0) < 0.3) return 0 // upper arm points (nearly) straight forward: no reference
  f0 = norm(f0)
  const upRef = mul(cross(a, f0), -outward) // "up" side of the arm, same meaning for both arms
  const fp = sub(fore, mul(a, dot(fore, a)))
  return clamp(Math.atan2(dot(fp, upRef), dot(fp, f0)) / (Math.PI / 2), -1, 1)
}
// Torso more than 62° from vertical = lying down; back below 50° = upright again.
const LYING_ENTER = Math.cos(62 / DEG)
const LYING_EXIT = Math.cos(50 / DEG)
function computeBodyParams (body, state = {}) {
  const out = { 'BT/Detected': !!body }
  if (!body) return out
  const { pts } = body
  const hipC = mid(pts[P.leftHip], pts[P.rightHip])
  const shC = mid(pts[P.leftShoulder], pts[P.rightShoulder])
  const torsoUp = sub(shC, hipC)
  // Lying down (e.g. in bed). The upright maths below (legs against a level pelvis, crouch
  // against standing hip height) break on your side, so lying gets its own output: how the
  // body lies (BT/LiePitch, BT/LieRoll) with straight limbs, and the avatar's Body Pose lays
  // it on the floor. Torso direction from hips->shoulders, or from shoulders->ears when the
  // hips are out of view (under a blanket). Hysteresis (62° in / 50° out) stops flicker.
  const hipsSeen = seen(body, P.leftHip, P.rightHip, P.leftShoulder, P.rightShoulder)
  const headSeen = seen(body, P.leftShoulder, P.rightShoulder, P.leftEar, P.rightEar)
  const shoulderLine = sub(pts[P.rightShoulder], pts[P.leftShoulder])
  let upVec = null
  if (hipsSeen) upVec = torsoUp
  else if (headSeen) upVec = sub(mid(pts[P.leftEar], pts[P.rightEar]), shC)
  if (upVec) { const upY = norm(upVec)[1]; state.lying = state.lying ? upY < LYING_EXIT : upY < LYING_ENTER }
  out['BT/Lying'] = state.lying ? 1 : 0
  if (state.lying) {
    const b = basisRightUp(shoulderLine, upVec || torsoUp)
    const lie = lyingAngles(b)
    out['BT/LiePitch'] = lie.pitch; out['BT/LieRoll'] = lie.roll
    for (const side of ['Left', 'Right']) for (const n of ['UpperLegX', 'UpperLegZ', 'Knee', 'UpperArmX', 'UpperArmZ', 'Elbow', 'UpperArmTwist']) out[`BT/${side}${n}`] = 0
    for (const n of ['SpineBend', 'SpineSide', 'SpineTwist', 'Crouch']) out[`BT/${n}`] = 0
    out['BT/LegsVisible'] = false
    return out
  }
  out['BT/LiePitch'] = 0; out['BT/LieRoll'] = 0
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
    if (!seen(body, P[s + 'Hip'], P[s + 'Knee'])) {
      // leg out of view: stand it straight rather than keep a guessed / old pose
      out[`BT/${side}UpperLegX`] = 0; out[`BT/${side}UpperLegZ`] = 0; out[`BT/${side}Knee`] = 0
    } else {
      const thigh = local(sub(pts[P[s + 'Knee']], pts[P[s + 'Hip']]), pelvis) // [right, up, forward]
      out[`BT/${side}UpperLegX`] = clamp(Math.atan2(thigh[2], -thigh[1] + 0) / (Math.PI / 2), -1, 1)
      out[`BT/${side}UpperLegZ`] = clamp(Math.atan2(thigh[0] * outward, -thigh[1] + 0) / (Math.PI / 2), -1, 1)
      if (seen(body, P[s + 'Ankle'])) {
        const bend = angleBetween(sub(pts[P[s + 'Knee']], pts[P[s + 'Hip']]), sub(pts[P[s + 'Ankle']], pts[P[s + 'Knee']]))
        out[`BT/${side}Knee`] = clamp(bend / (150 / DEG), 0, 1)
      } else out[`BT/${side}Knee`] = 0
    }
    if (seen(body, P[s + 'Shoulder'], P[s + 'Elbow'])) {
      const arm = local(sub(pts[P[s + 'Elbow']], pts[P[s + 'Shoulder']]), chest)
      // forward elevation measured against the side plane, so an arm held out to the side reads X = 0
      out[`BT/${side}UpperArmX`] = clamp(Math.atan2(arm[2], Math.hypot(arm[1], arm[0])) / (Math.PI / 2), -1, 1)
      out[`BT/${side}UpperArmZ`] = clamp(Math.atan2(arm[0] * outward, -arm[1] + 0) / Math.PI, -1, 1)
      if (seen(body, P[s + 'Wrist'])) {
        const bend = angleBetween(sub(pts[P[s + 'Elbow']], pts[P[s + 'Shoulder']]), sub(pts[P[s + 'Wrist']], pts[P[s + 'Elbow']]))
        out[`BT/${side}Elbow`] = clamp(bend / (150 / DEG), 0, 1)
        out[`BT/${side}UpperArmTwist`] = armTwist(sub(pts[P[s + 'Elbow']], pts[P[s + 'Shoulder']]), sub(pts[P[s + 'Wrist']], pts[P[s + 'Elbow']]), chest.forward, outward, bend)
      } else { out[`BT/${side}Elbow`] = 0; out[`BT/${side}UpperArmTwist`] = 0 }
    } else {
      // arm out of view (hands down below the camera): back to the default hanging pose
      // instead of keeping the last raised pose
      out[`BT/${side}UpperArmX`] = 0; out[`BT/${side}UpperArmZ`] = 0; out[`BT/${side}Elbow`] = 0; out[`BT/${side}UpperArmTwist`] = 0
    }
  }
  // Spine relative to world vertical / to the hips.
  if (seen(body, P.leftShoulder, P.rightShoulder, P.leftHip, P.rightHip)) {
    const up = norm(torsoUp)
    out['BT/SpineBend'] = clamp(Math.atan2(dot(up, pelvis.forward), up[1]) / (60 / DEG), -1, 1)
    out['BT/SpineSide'] = clamp(Math.atan2(dot(up, pelvis.right), up[1]) / (45 / DEG), -1, 1)
    const twist = Math.atan2(dot(chest.right, pelvis.forward), dot(chest.right, pelvis.right)) // + = shoulders turned to own left
    out['BT/SpineTwist'] = clamp(twist / (60 / DEG), -1, 1)
  } else if (seen(body, P.leftShoulder, P.rightShoulder)) {
    // Hips out of view (sitting at a desk): side lean from the shoulder line's roll and
    // twist from its depth, assuming the hips face the camera. Forward bend needs the hips.
    const r = sub(pts[P.rightShoulder], pts[P.leftShoulder])
    // Forward bend from the shoulders->ears line (the ears barely move when you only nod),
    // measured against the most upright posture seen recently, so a natural forward neck
    // angle isn't read as a bend.
    if (headSeen) {
      const u = norm(sub(mid(pts[P.leftEar], pts[P.rightEar]), shC))
      const a = Math.atan2(u[2], u[1])
      state.neckRef = state.neckRef == null ? a : Math.min(state.neckRef + 0.0005, a)
      out['BT/SpineBend'] = clamp((a - state.neckRef) / (60 / DEG), 0, 1)
    } else out['BT/SpineBend'] = 0
    out['BT/SpineSide'] = clamp(Math.atan2(-r[1], Math.hypot(r[0], r[2])) / (45 / DEG), -1, 1) // right shoulder lower = lean right
    out['BT/SpineTwist'] = clamp(Math.atan2(r[2], r[0]) / (60 / DEG), -1, 1)
  }
  // Crouch: hips lower than the standing hip height (learned as the max seen).
  if (legsSeen) {
    const hipH = -Math.min(pts[P.leftAnkle][1], pts[P.rightAnkle][1])
    state.standingHip = Math.max(state.standingHip || 0, hipH)
    out['BT/Crouch'] = state.standingHip > 0.2 ? clamp(1 - hipH / state.standingHip, 0, 1) / 0.6 : 0
    out['BT/Crouch'] = clamp(out['BT/Crouch'], 0, 1)
  } else out['BT/Crouch'] = 0 // feet out of view: no crouch from guessed feet
  return out
}

const BODY_PARAMS = (() => {
  const list = [{ name: 'BT/Detected', type: 'Bool' }, { name: 'BT/LegsVisible', type: 'Bool' }]
  for (const side of ['Left', 'Right']) for (const n of ['UpperLegX', 'UpperLegZ', 'Knee', 'UpperArmX', 'UpperArmZ', 'Elbow', 'UpperArmTwist']) list.push({ name: `BT/${side}${n}`, type: 'Float' })
  for (const n of ['SpineBend', 'SpineSide', 'SpineTwist', 'Crouch', 'Lying', 'LiePitch', 'LieRoll']) list.push({ name: `BT/${n}`, type: 'Float' })
  return list
})()

function planBody (avatarParams, { sendAll = false } = {}) {
  const params = Array.isArray(avatarParams) ? avatarParams : []
  const plan = []
  for (const p of BODY_PARAMS) {
    const hit = params.find(a => a.type === p.type && (a.address.endsWith('/' + p.name) || a.address === p.name))
    if (hit) plan.push({ ...p, address: hit.address })
    else if (sendAll) plan.push({ ...p, address: '/avatar/parameters/' + p.name }) // testing: only for params the avatar lacks
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

/* ---------- 3. Jump detection -> VRChat's /input/Jump ---------- */
// MediaPipe's world landmarks are centred on the hips, so they can't show you leaving the
// ground. This uses the IMAGE landmarks (0..1, y down) instead, measured in units of your
// own torso length (shoulders to hips in the image) so distance to the camera doesn't
// matter. A jump = hips AND both feet rise together by `sensitivity` torso lengths above
// your learned standing position, while the torso stays the same size (it shrinks when you
// step back from the camera instead). Fires once per jump, re-arms after landing.
const JUMP_SENS = { low: 0.35, medium: 0.25, high: 0.18 }
function detectJump (image, state, t, sensitivity = 'medium') {
  if (!Array.isArray(image) || image.length < 33) return false
  const ok = i => image[i] && (image[i][3] == null || image[i][3] >= MIN_VIS)
  if (![11, 12, 23, 24, 27, 28].every(ok)) { state.jumpBase = null; return false }
  const y = i => image[i][1]
  const shY = (y(11) + y(12)) / 2; const hipY = (y(23) + y(24)) / 2; const ankY = (y(27) + y(28)) / 2
  const torso = hipY - shY
  if (!(torso > 0.04) || !(ankY > hipY)) { state.jumpBase = null; return false } // not upright in the image
  const sens = typeof sensitivity === 'number' ? sensitivity : (JUMP_SENS[sensitivity] || JUMP_SENS.medium)
  const b = state.jumpBase
  if (!b) { state.jumpBase = { hip: hipY, ank: ankY, torso }; state.inAir = false; return false }
  const up = (base, cur) => (base - cur) / b.torso // + = moved up, in torso lengths
  const dh = up(b.hip, hipY); const da = up(b.ank, ankY)
  const sameSize = Math.abs(torso - b.torso) / b.torso < 0.15
  let fired = false
  if (!state.inAir) {
    if (dh > sens && da > sens * 0.7 && sameSize && !(t - (state.lastJump || -1e9) < 700)) {
      state.inAir = true; state.lastJump = t; fired = true
    } else if (Math.abs(dh) < 0.1 && Math.abs(da) < 0.1) {
      // standing still: slowly follow small drifts (posture, camera shake)
      b.hip += (hipY - b.hip) * 0.1; b.ank += (ankY - b.ank) * 0.1; b.torso += (torso - b.torso) * 0.1
    } else if (!sameSize || Math.abs(da) > 0.6) {
      // walked nearer / further or changed stance: start again from here
      state.jumpBase = { hip: hipY, ank: ankY, torso }
    }
  } else if (dh < sens * 0.4 && da < sens * 0.4) {
    state.inAir = false // landed
  }
  return fired
}

module.exports = { JUMP_SENS, detectJump, P, TRACKER_SLOTS, BODY_PARAMS, toVrc, eulerFromBasis, readPose, computeTrackers, trackerMessages, computeBodyParams, planBody, evaluateBody }

// modules/vrchat/tracking/unifiedExpressions.js
// Webcam face data -> VRCFaceTracking "Unified Expressions".
//
// Ported from two Apache-2.0 projects:
//   - FoxyFace (Jeka8833/FoxyFace): MediaPipe blendshape -> Unified Expression
//     mapping, eye gaze from eyeLook* shapes, head pose from the facial
//     transformation matrix (stream/vrcft/VrcftPacketEncoderStream.py,
//     stream/mediapipe/face/MediaPipeProcessing.py)
//   - VRCFaceTracking (benaclejames/VRCFaceTracking): the Unified Expressions
//     list and the "simple" shapes (Params/Expressions/UnifiedExpressions.cs,
//     UnifiedSimpleExpressions.cs)
// Pure functions; MAIN process.

// Same order as VRCFT's UnifiedExpressions enum.
const UNIFIED_EXPRESSIONS = [
  'EyeSquintRight', 'EyeSquintLeft', 'EyeWideRight', 'EyeWideLeft',
  'BrowPinchRight', 'BrowPinchLeft', 'BrowLowererRight', 'BrowLowererLeft',
  'BrowInnerUpRight', 'BrowInnerUpLeft', 'BrowOuterUpRight', 'BrowOuterUpLeft',
  'NasalDilationRight', 'NasalDilationLeft', 'NasalConstrictRight', 'NasalConstrictLeft',
  'CheekSquintRight', 'CheekSquintLeft', 'CheekPuffRight', 'CheekPuffLeft', 'CheekSuckRight', 'CheekSuckLeft',
  'JawOpen', 'JawRight', 'JawLeft', 'JawForward', 'JawBackward', 'JawClench', 'JawMandibleRaise', 'MouthClosed',
  'LipSuckUpperRight', 'LipSuckUpperLeft', 'LipSuckLowerRight', 'LipSuckLowerLeft', 'LipSuckCornerRight', 'LipSuckCornerLeft',
  'LipFunnelUpperRight', 'LipFunnelUpperLeft', 'LipFunnelLowerRight', 'LipFunnelLowerLeft',
  'LipPuckerUpperRight', 'LipPuckerUpperLeft', 'LipPuckerLowerRight', 'LipPuckerLowerLeft',
  'MouthUpperUpRight', 'MouthUpperUpLeft', 'MouthUpperDeepenRight', 'MouthUpperDeepenLeft',
  'NoseSneerRight', 'NoseSneerLeft', 'MouthLowerDownRight', 'MouthLowerDownLeft',
  'MouthUpperRight', 'MouthUpperLeft', 'MouthLowerRight', 'MouthLowerLeft',
  'MouthCornerPullRight', 'MouthCornerPullLeft', 'MouthCornerSlantRight', 'MouthCornerSlantLeft',
  'MouthFrownRight', 'MouthFrownLeft', 'MouthStretchRight', 'MouthStretchLeft',
  'MouthDimpleRight', 'MouthDimpleLeft', 'MouthRaiserUpper', 'MouthRaiserLower',
  'MouthPressRight', 'MouthPressLeft', 'MouthTightenerRight', 'MouthTightenerLeft',
  'TongueOut', 'TongueUp', 'TongueDown', 'TongueRight', 'TongueLeft', 'TongueRoll', 'TongueBendDown', 'TongueCurlUp',
  'TongueSquish', 'TongueFlat', 'TongueTwistRight', 'TongueTwistLeft',
  'SoftPalateClose', 'ThroatSwallow', 'NeckFlexRight', 'NeckFlexLeft'
]

// MediaPipe (ARKit-style) blendshape -> Unified Expressions it drives (FoxyFace).
const MEDIAPIPE_TO_UNIFIED = {
  browDownLeft: ['BrowLowererLeft', 'BrowPinchLeft'],
  browDownRight: ['BrowLowererRight', 'BrowPinchRight'],
  browInnerUp: ['BrowInnerUpRight', 'BrowInnerUpLeft'],
  browOuterUpLeft: ['BrowOuterUpLeft'],
  browOuterUpRight: ['BrowOuterUpRight'],
  cheekPuff: ['CheekPuffLeft', 'CheekPuffRight'],
  cheekSquintLeft: ['CheekSquintLeft'],
  cheekSquintRight: ['CheekSquintRight'],
  eyeSquintLeft: ['EyeSquintLeft'],
  eyeSquintRight: ['EyeSquintRight'],
  eyeWideLeft: ['EyeWideLeft'],
  eyeWideRight: ['EyeWideRight'],
  jawForward: ['JawForward'],
  jawLeft: ['JawLeft'],
  jawOpen: ['JawOpen'],
  jawRight: ['JawRight'],
  mouthClose: ['MouthClosed'],
  mouthDimpleLeft: ['MouthDimpleLeft'],
  mouthDimpleRight: ['MouthDimpleRight'],
  mouthFrownLeft: ['MouthFrownLeft'],
  mouthFrownRight: ['MouthFrownRight'],
  mouthFunnel: ['LipFunnelUpperRight', 'LipFunnelUpperLeft', 'LipFunnelLowerRight', 'LipFunnelLowerLeft'],
  mouthLeft: ['MouthUpperLeft', 'MouthLowerLeft'],
  mouthRight: ['MouthUpperRight', 'MouthLowerRight'],
  mouthLowerDownLeft: ['MouthLowerDownLeft'],
  mouthLowerDownRight: ['MouthLowerDownRight'],
  mouthPressLeft: ['MouthPressLeft'],
  mouthPressRight: ['MouthPressRight'],
  mouthPucker: ['LipPuckerUpperRight', 'LipPuckerUpperLeft', 'LipPuckerLowerRight', 'LipPuckerLowerLeft'],
  mouthRollLower: ['LipSuckLowerRight', 'LipSuckLowerLeft'],
  mouthRollUpper: ['LipSuckUpperRight', 'LipSuckUpperLeft'],
  mouthShrugLower: ['MouthRaiserLower'],
  mouthShrugUpper: ['MouthRaiserUpper'],
  mouthSmileLeft: ['MouthCornerPullLeft', 'MouthCornerSlantLeft'],
  mouthSmileRight: ['MouthCornerPullRight', 'MouthCornerSlantRight'],
  mouthStretchLeft: ['MouthStretchLeft'],
  mouthStretchRight: ['MouthStretchRight'],
  mouthUpperUpLeft: ['MouthUpperUpLeft'],
  mouthUpperUpRight: ['MouthUpperUpRight'],
  noseSneerLeft: ['NoseSneerLeft'],
  noseSneerRight: ['NoseSneerRight']
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const clamp01 = v => clamp(Number(v) || 0, 0, 1)

// Swap Left<->Right in a shape name (for mirrored cameras).
const mirrorName = n => n.replace(/Left|Right/g, s => (s === 'Left' ? 'Right' : 'Left'))

// 4x4 matrix element (row i, col j). MediaPipe's JS Matrix data is column-major.
const m4 = (data, i, j) => data[j * 4 + i]

// Head rotation like FoxyFace: mirror (diag(-1,1,1)) the 3x3 rotation, then
// Euler angles in scipy's extrinsic 'zxy' order (= Unity's Z,X,Y), normalised
// so ±90° = ±1. Returns { pitch, yaw, roll } or null.
function headRotation (matrixData) {
  if (!matrixData || matrixData.length < 16) return null
  // R' = M R M with M = diag(-1,1,1): flip signs where exactly one index is 0.
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i][j] = m4(matrixData, i, j) * (((i === 0) !== (j === 0)) ? -1 : 1)
  // extrinsic z,x,y  ->  R = Ry(yaw) · Rx(pitch) · Rz(roll)
  const pitch = Math.asin(clamp(-R[1][2], -1, 1))
  const yaw = Math.atan2(R[0][2], R[2][2])
  const roll = Math.atan2(R[1][0], R[1][1])
  if (![pitch, yaw, roll].every(Number.isFinite)) return null
  const n = Math.PI / 2
  return { pitch: pitch / n, yaw: yaw / n, roll: roll / n }
}

// One MediaPipe face result -> raw "general" values (FoxyFace's stage before
// calibration): MediaPipe shapes by name plus EyeX/Y, EyeOpenness, Head*.
//   blendshapes: [{ categoryName, score }] | { name: score }
//   matrix: 16 numbers (column-major), chin: { x, y } (landmark 152)
function rawFromMediaPipe ({ blendshapes, matrix, chin } = {}) {
  const raw = { EyeXLeft: 0, EyeXRight: 0, EyeYLeft: 0, EyeYRight: 0 }
  const list = Array.isArray(blendshapes) ? blendshapes.map(b => [b.categoryName, b.score]) : Object.entries(blendshapes || {})
  for (const [name, scoreRaw] of list) {
    const score = Number(scoreRaw) || 0
    switch (name) {
      case '_neutral': break
      // Eye gaze (note the left/right swap — same as FoxyFace)
      case 'eyeLookInLeft': raw.EyeXRight += score; break
      case 'eyeLookOutLeft': raw.EyeXRight -= score; break
      case 'eyeLookInRight': raw.EyeXLeft -= score; break
      case 'eyeLookOutRight': raw.EyeXLeft += score; break
      case 'eyeLookDownLeft': raw.EyeYLeft -= score; break
      case 'eyeLookUpLeft': raw.EyeYLeft += score; break
      case 'eyeLookDownRight': raw.EyeYRight -= score; break
      case 'eyeLookUpRight': raw.EyeYRight += score; break
      default: raw[name] = score
    }
  }
  if (chin && Number.isFinite(chin.x) && Number.isFinite(chin.y)) { raw.HeadX = chin.x; raw.HeadY = 1 - chin.y }
  if (matrix && matrix.length >= 16) raw.HeadZ = m4(matrix, 2, 3)
  const rot = headRotation(matrix)
  if (rot) { raw.HeadPitch = rot.pitch; raw.HeadYaw = rot.yaw; raw.HeadRoll = rot.roll }
  return raw
}

// Shapes with a centre (−1..1) vs plain 0..1 shapes, and default calibration
// ranges for the centred ones (camera-space values).
const CENTERED = {
  EyeXLeft: { neg: -1, neutral: 0, pos: 1 }, EyeXRight: { neg: -1, neutral: 0, pos: 1 },
  EyeYLeft: { neg: -1, neutral: 0, pos: 1 }, EyeYRight: { neg: -1, neutral: 0, pos: 1 },
  HeadX: { neg: 0.25, neutral: 0.5, pos: 0.75 }, HeadY: { neg: 0.25, neutral: 0.5, pos: 0.75 },
  HeadZ: { neg: -70, neutral: -45, pos: -20 },
  HeadPitch: { neg: -1, neutral: 0, pos: 1, noCalibration: true },
  HeadYaw: { neg: -1, neutral: 0, pos: 1, noCalibration: true },
  HeadRoll: { neg: -1, neutral: 0, pos: 1, noCalibration: true }
}

// Calibration like FoxyFace's CalibrateProcessing: piecewise-linear map of
// (neg, neutral, pos) -> (−1, 0, 1) for centred shapes, (neutral, max) -> (0, 1)
// for the rest. `cal` = { [name]: { neutral, max } | { neg, neutral, pos } }.
function interp (v, xs, ys) {
  if (v <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) {
    if (v <= xs[i]) { const t = (v - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + t * (ys[i] - ys[i - 1]) }
  }
  return ys[ys.length - 1]
}
function calibrate (raw, cal = {}) {
  const out = {}
  for (const [name, v] of Object.entries(raw)) {
    const c = CENTERED[name]
    if (c) {
      if (c.noCalibration && !cal[name]) { out[name] = clamp(v, -1, 1); continue }
      const o = { ...c, ...(cal[name] || {}) }
      out[name] = interp(v, [Math.min(o.neg, o.neutral - 1e-6), o.neutral, Math.max(o.pos, o.neutral + 1e-6)], [-1, 0, 1])
    } else {
      const o = cal[name] || {}
      const neutral = Number.isFinite(o.neutral) ? o.neutral : 0
      const max = Number.isFinite(o.max) ? o.max : 1
      out[name] = interp(v, [neutral, Math.max(max, neutral + 1e-6)], [0, 1])
    }
  }
  return out
}

// Calibrated values -> UnifiedTrackingData-like object:
//   { shapes: { [UnifiedExpression]: 0..1 }, eye: { left/right: { x, y, openness } }, head: {...} }
// opts: { intensity (expressions gain), mirror, face, eyes, head }
function toUnified (vals, opts = {}) {
  const gain = Number.isFinite(opts.intensity) ? opts.intensity : 1
  const shapes = {}
  for (const n of UNIFIED_EXPRESSIONS) shapes[n] = 0
  if (opts.face !== false) {
    for (const [mp, targets] of Object.entries(MEDIAPIPE_TO_UNIFIED)) {
      if (vals[mp] == null) continue
      const v = clamp01(vals[mp] * gain)
      for (const t of targets) shapes[t] = v
    }
  }
  const eyesOn = opts.eyes !== false
  const eye = {
    left: { x: eyesOn ? clamp(vals.EyeXLeft || 0, -1, 1) : 0, y: eyesOn ? clamp(vals.EyeYLeft || 0, -1, 1) : 0, openness: eyesOn && vals.eyeBlinkLeft != null ? clamp01(1 - vals.eyeBlinkLeft) : 1 },
    right: { x: eyesOn ? clamp(vals.EyeXRight || 0, -1, 1) : 0, y: eyesOn ? clamp(vals.EyeYRight || 0, -1, 1) : 0, openness: eyesOn && vals.eyeBlinkRight != null ? clamp01(1 - vals.eyeBlinkRight) : 1 }
  }
  const headOn = opts.head !== false
  const head = {
    yaw: headOn ? clamp(vals.HeadYaw || 0, -1, 1) : 0,
    pitch: headOn ? clamp(vals.HeadPitch || 0, -1, 1) : 0,
    roll: headOn ? clamp(vals.HeadRoll || 0, -1, 1) : 0,
    posX: headOn ? clamp(vals.HeadX || 0, -1, 1) : 0,
    posY: headOn ? clamp(vals.HeadY || 0, -1, 1) : 0,
    posZ: headOn ? clamp(vals.HeadZ || 0, -1, 1) : 0
  }
  const data = { shapes, eye, head }
  return opts.mirror ? mirrorUnified(data) : data
}

function mirrorUnified (d) {
  const shapes = {}
  for (const [k, v] of Object.entries(d.shapes)) shapes[mirrorName(k)] = v
  const flipX = e => ({ ...e, x: -e.x })
  return { shapes, eye: { left: flipX(d.eye.right), right: flipX(d.eye.left) }, head: { ...d.head, yaw: -d.head.yaw, roll: -d.head.roll, posX: -d.head.posX } }
}

// VRCFT's UnifiedSimplifier.
function simple (d, name) {
  const s = d.shapes
  switch (name) {
    case 'BrowUpRight': return s.BrowOuterUpRight * 0.6 + s.BrowInnerUpRight * 0.4
    case 'BrowUpLeft': return s.BrowOuterUpLeft * 0.6 + s.BrowInnerUpLeft * 0.4
    case 'BrowDownRight': return s.BrowLowererRight * 0.75 + s.BrowPinchRight * 0.25
    case 'BrowDownLeft': return s.BrowLowererLeft * 0.75 + s.BrowPinchLeft * 0.25
    case 'MouthSmileRight': return s.MouthCornerPullRight * 0.8 + s.MouthCornerSlantRight * 0.2
    case 'MouthSmileLeft': return s.MouthCornerPullLeft * 0.8 + s.MouthCornerSlantLeft * 0.2
    case 'MouthSadRight': return Math.max(s.MouthFrownRight, s.MouthStretchRight)
    case 'MouthSadLeft': return Math.max(s.MouthFrownLeft, s.MouthStretchLeft)
  }
  return 0
}
const SIMPLE_EXPRESSIONS = ['BrowUpRight', 'BrowUpLeft', 'BrowDownRight', 'BrowDownLeft', 'MouthSmileRight', 'MouthSmileLeft', 'MouthSadRight', 'MouthSadLeft']

module.exports = {
  UNIFIED_EXPRESSIONS, SIMPLE_EXPRESSIONS, MEDIAPIPE_TO_UNIFIED, CENTERED,
  rawFromMediaPipe, calibrate, toUnified, simple, headRotation, mirrorName
}

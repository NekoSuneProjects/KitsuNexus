// modules/vrchat/tracking/ftParams.js
// VRCFaceTracking-compatible avatar parameters ("v2" standard), so avatars
// made for VRCFT work unchanged. Ported from VRCFaceTracking (Apache-2.0):
//   Params/Expressions/UnifiedExpressionsParameters.cs, UnifiedHeadParameters.cs,
//   NativeParameters.cs, Params/DataTypes/ParamContainers.cs (EParam),
//   OSC/DataTypes/BaseParameter.cs + BinaryBaseParameter.cs (address matching).
//
// Every logical parameter ("v2/JawOpen") can exist on an avatar as:
//   - a Float  ".../v2/JawOpen"
//   - a Bool   ".../v2/JawOpen"            (true when value < 0.5, as VRCFT)
//   - binary   ".../v2/JawOpen1, 2, 4, 8…" bools (+ ".../v2/JawOpenNegative")
// Only parameters the current avatar actually has are sent. MAIN process.

const { UNIFIED_EXPRESSIONS, SIMPLE_EXPRESSIONS, simple } = require('./unifiedExpressions')

const PREFIX = '/avatar/parameters/'

/* ---------- parameter definitions: name -> (data) => number ---------- */
function buildDefinitions () {
  const defs = [] // { name, fn, bool: threshold|null, binary: bool }
  const add = (name, fn, opts = {}) => defs.push({ name, fn, boolThreshold: opts.bool === undefined ? 0.5 : opts.bool, binary: opts.binary !== false })
  const vec = (name, fx, fy) => { add(name + 'X', fx); add(name + 'Y', fy) }
  const S = (d, n) => d.shapes[n] || 0
  const avg = (...xs) => xs.reduce((a, b) => a + b, 0) / xs.length

  // Base Unified Expressions + simple expressions (bool threshold 0.0 like VRCFT).
  for (const n of UNIFIED_EXPRESSIONS) add('v2/' + n, d => S(d, n), { bool: 0 })
  for (const n of SIMPLE_EXPRESSIONS) add('v2/' + n, d => simple(d, n), { bool: 0 })

  // Eye gaze (combined = average of both eyes)
  vec('v2/Eye', d => avg(d.eye.left.x, d.eye.right.x), d => avg(d.eye.left.y, d.eye.right.y))
  vec('v2/EyeLeft', d => d.eye.left.x, d => d.eye.left.y)
  vec('v2/EyeRight', d => d.eye.right.x, d => d.eye.right.y)
  // Openness / lids
  add('v2/EyeOpenLeft', d => d.eye.left.openness)
  add('v2/EyeOpenRight', d => d.eye.right.openness)
  add('v2/EyeOpen', d => avg(d.eye.left.openness, d.eye.right.openness))
  add('v2/EyeClosedLeft', d => 1 - d.eye.left.openness)
  add('v2/EyeClosedRight', d => 1 - d.eye.right.openness)
  add('v2/EyeClosed', d => 1 - avg(d.eye.left.openness, d.eye.right.openness))
  add('v2/EyeWide', d => Math.max(S(d, 'EyeWideLeft'), S(d, 'EyeWideRight')))
  add('v2/EyeLidLeft', d => d.eye.left.openness * 0.75 + S(d, 'EyeWideLeft') * 0.25)
  add('v2/EyeLidRight', d => d.eye.right.openness * 0.75 + S(d, 'EyeWideRight') * 0.25)
  add('v2/EyeLid', d => avg(d.eye.left.openness, d.eye.right.openness) * 0.75 + avg(S(d, 'EyeWideRight'), S(d, 'EyeWideLeft')) * 0.25)
  add('v2/EyeSquint', d => Math.max(S(d, 'EyeSquintLeft'), S(d, 'EyeSquintRight')))
  add('v2/EyesSquint', d => Math.max(S(d, 'EyeSquintLeft'), S(d, 'EyeSquintRight')))
  // Brows
  add('v2/BrowUp', d => (simple(d, 'BrowUpRight') + simple(d, 'BrowUpLeft')) * 0.5)
  add('v2/BrowDown', d => (simple(d, 'BrowDownRight') + simple(d, 'BrowDownLeft')) * 0.5)
  add('v2/BrowInnerUp', d => avg(S(d, 'BrowInnerUpLeft'), S(d, 'BrowInnerUpRight')))
  add('v2/BrowOuterUp', d => avg(S(d, 'BrowOuterUpLeft'), S(d, 'BrowOuterUpRight')))
  add('v2/BrowExpressionRight', d => Math.min(1, S(d, 'BrowInnerUpRight') * 0.5 + S(d, 'BrowOuterUpRight') * 0.5) - simple(d, 'BrowDownRight'))
  add('v2/BrowExpressionLeft', d => Math.min(1, S(d, 'BrowInnerUpLeft') * 0.5 + S(d, 'BrowOuterUpLeft') * 0.5) - simple(d, 'BrowDownLeft'))
  add('v2/BrowExpression', d => (Math.min(1, (S(d, 'BrowInnerUpRight') + S(d, 'BrowOuterUpRight')) * 0.5) - simple(d, 'BrowDownRight') +
    Math.min(1, (S(d, 'BrowInnerUpLeft') + S(d, 'BrowOuterUpLeft')) * 0.5) - simple(d, 'BrowDownLeft')) * 0.5)
  // Jaw / cheeks
  add('v2/JawX', d => S(d, 'JawRight') - S(d, 'JawLeft'))
  add('v2/JawZ', d => S(d, 'JawForward') - S(d, 'JawBackward'))
  add('v2/CheekSquint', d => avg(S(d, 'CheekSquintLeft'), S(d, 'CheekSquintRight')))
  add('v2/CheekPuffSuckLeft', d => S(d, 'CheekPuffLeft') - S(d, 'CheekSuckLeft'))
  add('v2/CheekPuffSuckRight', d => S(d, 'CheekPuffRight') - S(d, 'CheekSuckRight'))
  add('v2/CheekPuffSuck', d => avg(S(d, 'CheekPuffRight'), S(d, 'CheekPuffLeft')) - avg(S(d, 'CheekSuckRight'), S(d, 'CheekSuckLeft')))
  add('v2/CheekSuck', d => avg(S(d, 'CheekSuckLeft'), S(d, 'CheekSuckRight')))
  // Mouth direction
  add('v2/MouthUpperX', d => S(d, 'MouthUpperRight') - S(d, 'MouthUpperLeft'))
  add('v2/MouthLowerX', d => S(d, 'MouthLowerRight') - S(d, 'MouthLowerLeft'))
  add('v2/MouthX', d => avg(S(d, 'MouthUpperRight'), S(d, 'MouthLowerRight')) - avg(S(d, 'MouthUpperLeft'), S(d, 'MouthLowerLeft')))
  // Lips
  const four = (d, a, b, c, e) => (S(d, a) + S(d, b) + S(d, c) + S(d, e)) / 4
  add('v2/LipSuckUpper', d => avg(S(d, 'LipSuckUpperRight'), S(d, 'LipSuckUpperLeft')))
  add('v2/LipSuckLower', d => avg(S(d, 'LipSuckLowerRight'), S(d, 'LipSuckLowerLeft')))
  add('v2/LipSuck', d => four(d, 'LipSuckUpperRight', 'LipSuckUpperLeft', 'LipSuckLowerRight', 'LipSuckLowerLeft'))
  add('v2/LipFunnelUpper', d => avg(S(d, 'LipFunnelUpperRight'), S(d, 'LipFunnelUpperLeft')))
  add('v2/LipFunnelLower', d => avg(S(d, 'LipFunnelLowerRight'), S(d, 'LipFunnelLowerLeft')))
  add('v2/LipFunnel', d => four(d, 'LipFunnelUpperRight', 'LipFunnelUpperLeft', 'LipFunnelLowerRight', 'LipFunnelLowerLeft'))
  add('v2/LipPuckerUpper', d => avg(S(d, 'LipPuckerUpperRight'), S(d, 'LipPuckerUpperLeft')))
  add('v2/LipPuckerLower', d => avg(S(d, 'LipPuckerLowerRight'), S(d, 'LipPuckerLowerLeft')))
  add('v2/LipPuckerRight', d => avg(S(d, 'LipPuckerUpperRight'), S(d, 'LipPuckerLowerRight')))
  add('v2/LipPuckerLeft', d => avg(S(d, 'LipPuckerUpperLeft'), S(d, 'LipPuckerLowerLeft')))
  add('v2/LipPucker', d => four(d, 'LipPuckerUpperRight', 'LipPuckerUpperLeft', 'LipPuckerLowerRight', 'LipPuckerLowerLeft'))
  add('v2/LipSuckFunnelUpper', d => avg(S(d, 'LipSuckUpperRight'), S(d, 'LipSuckUpperLeft')) - avg(S(d, 'LipFunnelUpperRight'), S(d, 'LipFunnelUpperLeft')))
  add('v2/LipSuckFunnelLower', d => avg(S(d, 'LipSuckLowerRight'), S(d, 'LipSuckLowerLeft')) - avg(S(d, 'LipFunnelLowerRight'), S(d, 'LipFunnelLowerLeft')))
  for (const side of ['LowerLeft', 'LowerRight', 'UpperLeft', 'UpperRight']) add('v2/LipSuckFunnel' + side, d => S(d, 'LipSuck' + side) - S(d, 'LipFunnel' + side))
  // Mouth combined
  add('v2/MouthUpperUp', d => avg(S(d, 'MouthUpperUpRight'), S(d, 'MouthUpperUpLeft')))
  add('v2/MouthLowerDown', d => avg(S(d, 'MouthLowerDownRight'), S(d, 'MouthLowerDownLeft')))
  add('v2/MouthOpen', d => four(d, 'MouthUpperUpRight', 'MouthUpperUpLeft', 'MouthLowerDownRight', 'MouthLowerDownLeft'))
  add('v2/MouthStretch', d => avg(S(d, 'MouthStretchRight'), S(d, 'MouthStretchLeft')))
  add('v2/MouthTightener', d => avg(S(d, 'MouthTightenerRight'), S(d, 'MouthTightenerLeft')))
  add('v2/MouthPress', d => avg(S(d, 'MouthPressRight'), S(d, 'MouthPressLeft')))
  add('v2/MouthDimple', d => avg(S(d, 'MouthDimpleRight'), S(d, 'MouthDimpleLeft')))
  add('v2/NoseSneer', d => avg(S(d, 'NoseSneerRight'), S(d, 'NoseSneerLeft')))
  add('v2/MouthTightenerStretch', d => avg(S(d, 'MouthTightenerRight'), S(d, 'MouthTightenerLeft')) - avg(S(d, 'MouthStretchRight'), S(d, 'MouthStretchLeft')))
  add('v2/MouthTightenerStretchLeft', d => S(d, 'MouthTightenerLeft') - S(d, 'MouthStretchLeft'))
  add('v2/MouthTightenerStretchRight', d => S(d, 'MouthTightenerRight') - S(d, 'MouthStretchRight'))
  // Lip corners
  add('v2/MouthCornerYLeft', d => S(d, 'MouthCornerSlantLeft') - S(d, 'MouthFrownLeft'))
  add('v2/MouthCornerYRight', d => S(d, 'MouthCornerSlantRight') - S(d, 'MouthFrownRight'))
  add('v2/MouthCornerY', d => (S(d, 'MouthCornerSlantLeft') - S(d, 'MouthFrownLeft') + S(d, 'MouthCornerSlantRight') - S(d, 'MouthFrownRight')) * 0.5)
  add('v2/SmileFrownRight', d => simple(d, 'MouthSmileRight') - S(d, 'MouthFrownRight'))
  add('v2/SmileFrownLeft', d => simple(d, 'MouthSmileLeft') - S(d, 'MouthFrownLeft'))
  add('v2/SmileFrown', d => simple(d, 'MouthSmileRight') * 0.5 + simple(d, 'MouthSmileLeft') * 0.5 - S(d, 'MouthFrownRight') * 0.5 - S(d, 'MouthFrownLeft') * 0.5)
  add('v2/SmileSadRight', d => simple(d, 'MouthSmileRight') - simple(d, 'MouthSadRight'))
  add('v2/SmileSadLeft', d => simple(d, 'MouthSmileLeft') - simple(d, 'MouthSadLeft'))
  add('v2/SmileSad', d => avg(simple(d, 'MouthSmileLeft'), simple(d, 'MouthSmileRight')) - avg(simple(d, 'MouthSadLeft'), simple(d, 'MouthSadRight')))
  // Tongue
  add('v2/TongueX', d => S(d, 'TongueRight') - S(d, 'TongueLeft'))
  add('v2/TongueY', d => S(d, 'TongueUp') - S(d, 'TongueDown'))
  add('v2/TongueArchY', d => S(d, 'TongueCurlUp') - S(d, 'TongueBendDown'))
  add('v2/TongueShape', d => S(d, 'TongueFlat') - S(d, 'TongueSquish'))
  // Head
  add('v2/Head/Yaw', d => d.head.yaw)
  add('v2/Head/Pitch', d => d.head.pitch)
  add('v2/Head/Roll', d => d.head.roll)
  add('v2/Head/PosX', d => d.head.posX)
  add('v2/Head/PosY', d => d.head.posY)
  add('v2/Head/PosZ', d => d.head.posZ)
  return defs
}
const DEFINITIONS = buildDefinitions()

// Status bools (VRCFT ConditionalBoolParameter) — plain names, no v2/ prefix.
const STATUS_PARAMS = ['EyeTrackingActive', 'ExpressionTrackingActive', 'LipTrackingActive']

/* ---------- avatar matching (VRCFT BaseParam / BinaryBaseParameter rules) ---------- */
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Address ends with "/<name>" (but not ".../v1/<name>" style versions) or equals the name.
const exactRe = name => new RegExp(`(?<!(v\\d+))(/${reEscape(name)})$|^(${reEscape(name)})$`)
const binaryRe = name => new RegExp(`(?<!(v\\d+))/${reEscape(name)}(\\d+)$|^${reEscape(name)}(\\d+)$`)
// 1 -> 0, 2 -> 1, 4 -> 2 … (only powers of two are binary steps)
function binaryStep (n) { if (n < 1 || (n & (n - 1)) !== 0) return null; return Math.log2(n) }

// avatarParams: [{ address, type: 'Float'|'Bool'|'Int' }]
// Returns a "plan": what to send for this avatar.
function planForAvatar (avatarParams, opts = {}) {
  const params = Array.isArray(avatarParams) ? avatarParams.filter(p => p && p.address) : []
  const floats = []; const bools = []; const binaries = []
  const usedNames = new Set()
  if (!opts.fullFaceTracking) {
    for (const def of DEFINITIONS) {
      if (opts.sendAll) { floats.push({ address: PREFIX + def.name, def }); usedNames.add(def.name); continue }
      const ex = exactRe(def.name)
      const f = params.find(p => p.type === 'Float' && ex.test(p.address))
      if (f) { floats.push({ address: f.address, def }); usedNames.add(def.name) }
      const b = params.find(p => p.type === 'Bool' && ex.test(p.address))
      if (b) { bools.push({ address: b.address, def }); usedNames.add(def.name) }
      if (def.binary) {
        const br = binaryRe(def.name)
        const bits = []
        for (const p of params) {
          if (p.type !== 'Bool') continue
          const m = br.exec(p.address); if (!m) continue
          const step = binaryStep(parseInt(m[2] || m[3], 10))
          if (step !== null) bits.push({ address: p.address, step })
        }
        if (bits.length) {
          const negRe = exactRe(def.name + 'Negative')
          const neg = params.find(p => p.type === 'Bool' && negRe.test(p.address))
          binaries.push({ def, bits, max: 2 ** bits.length, negative: neg ? neg.address : '' })
          usedNames.add(def.name)
        }
      }
    }
  }
  const status = []
  for (const n of STATUS_PARAMS) {
    const ex = exactRe(n)
    const p = params.find(x => x.type === 'Bool' && ex.test(x.address))
    if (p) status.push({ address: p.address, name: n })
  }
  // Native VRChat eye tracking when the avatar has no FT eye gaze / lid params
  // (VRCFT NativeParameters): /tracking/eye/LeftRightPitchYaw + EyesClosedAmount.
  const hasGaze = [...usedNames].some(n => /Eye/.test(n) && /[XY]$/.test(n))
  const hasLid = [...usedNames].some(n => /Eye/.test(n) && /(Open|Lid)/.test(n))
  const native = { gaze: opts.nativeEyes !== false && !opts.fullFaceTracking && !hasGaze, lid: opts.nativeEyes !== false && !opts.fullFaceTracking && !hasLid }
  return { floats, bools, binaries, status, native, count: floats.length + bools.length + binaries.reduce((a, b) => a + b.bits.length, 0) }
}

/* ---------- evaluation: plan + data -> [{ address, type, value }] ---------- */
const toYaw = x => Math.atan(x) * (180 / Math.PI)
const toPitch = y => -Math.atan(y) * (180 / Math.PI)

function binaryBits (value, entry) {
  const out = []
  if (entry.negative) out.push({ address: entry.negative, type: 'bool', value: value < 0 })
  else if (value < 0) value = 0 // no Negative param: cut negatives (VRCFT)
  const a = Math.abs(value)
  const big = Math.floor(a * entry.max)
  for (const bit of entry.bits) out.push({ address: bit.address, type: 'bool', value: a > 0.99999 ? true : ((big >> bit.step) & 1) === 1 })
  return out
}

// active: { eyes, expressions } — drive the *TrackingActive bools.
function evaluate (plan, data, active = { eyes: true, expressions: true }) {
  const out = []
  const cache = new Map()
  const val = def => { if (!cache.has(def.name)) { const v = def.fn(data); cache.set(def.name, Number.isFinite(v) ? v : 0) } return cache.get(def.name) }
  for (const f of plan.floats) out.push({ address: f.address, type: 'float', value: val(f.def) })
  for (const b of plan.bools) out.push({ address: b.address, type: 'bool', value: val(b.def) < b.def.boolThreshold })
  for (const e of plan.binaries) out.push(...binaryBits(val(e.def), e))
  for (const s of plan.status) out.push({ address: s.address, type: 'bool', value: s.name === 'EyeTrackingActive' ? !!active.eyes : !!active.expressions })
  if (plan.native.gaze && active.eyes) out.push({ address: '/tracking/eye/LeftRightPitchYaw', type: 'floats', value: [toPitch(data.eye.left.y), toYaw(data.eye.left.x), toPitch(data.eye.right.y), toYaw(data.eye.right.x)] })
  if (plan.native.lid && active.eyes) out.push({ address: '/tracking/eye/EyesClosedAmount', type: 'float', value: 1 - (data.eye.left.openness + data.eye.right.openness) / 2 })
  return out
}

module.exports = { DEFINITIONS, STATUS_PARAMS, planForAvatar, evaluate, binaryStep, exactRe, binaryRe }

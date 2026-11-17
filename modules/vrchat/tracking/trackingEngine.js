// modules/vrchat/tracking/trackingEngine.js
// KitsuNexus face + hand tracking over OSC — a built-in VRCFaceTracking
// replacement fed by a webcam. Takes per-frame results from the tracker window
// (one camera stream feeds both the face and the hand model), and turns them
// into VRCFT "v2" face parameters, native VRChat eye tracking and HT/ hand
// parameters for the current avatar. MAIN process.
//
//   frame -> raw (FoxyFace mapping) -> One Euro filter -> calibration
//         -> Unified Expressions -> avatar plan -> changed values -> OSC bundles

const fs = require('fs')
const path = require('path')
const UE = require('./unifiedExpressions')
const FT = require('./ftParams')
const HT = require('./handParams')
const { OneEuroBank } = require('./oneEuro')
const { findAvatarConfig, parseConfig, OSC_DIR } = require('./avatarConfig')

const DEFAULTS = {
  face: true, eyes: true, head: true, hands: true,
  mirror: false, // camera image already mirrored (most webcams aren't)
  intensity: 1, // expression gain
  minCutoff: 1.5, beta: 0.3, // One Euro (FoxyFace-like defaults)
  sendAll: false, // ignore the avatar config and send every v2 / HT param
  nativeEyes: true, // VRChat native eye tracking when the avatar has no FT eye params
  faceLostMs: 600
}
const FLOAT_EPS = 0.002

function createTrackingEngine ({ send, onStatus, loadSettings, saveSettings, now = () => Date.now() } = {}) {
  let cfg = { ...DEFAULTS, ...((loadSettings && loadSettings('config')) || {}) }
  let calibration = (loadSettings && loadSettings('calibration')) || {}
  const faceFilter = new OneEuroBank({ minCutoff: cfg.minCutoff, beta: cfg.beta, dCutoff: 1 })
  const handFilter = new OneEuroBank({ minCutoff: cfg.minCutoff, beta: cfg.beta, dCutoff: 1 })
  let avatar = null // { id, name, fullFaceTracking, parameters }
  let facePlan = FT.planForAvatar([], { nativeEyes: cfg.nativeEyes })
  let handPlan = []
  const lastSent = new Map()
  let lastFaceAt = 0
  let faceActive = false
  let calibrating = null // { until, sums, n }
  const stats = { frames: 0, fps: 0, face: false, hands: { Left: false, Right: false }, sent: 0, lastValues: {}, curls: {} }
  let fpsWindow = []

  function replan () {
    const params = avatar ? avatar.parameters : []
    facePlan = FT.planForAvatar(params, { sendAll: cfg.sendAll, nativeEyes: cfg.nativeEyes, fullFaceTracking: !!(avatar && avatar.fullFaceTracking) })
    handPlan = HT.planHands(params, { sendAll: cfg.sendAll })
    lastSent.clear() // resend everything for the new avatar
  }

  function setAvatar (cfgOrNull) { avatar = cfgOrNull; replan(); emitStatus() }
  function loadAvatarById (id) { setAvatar(findAvatarConfig(id)); return avatar }

  // No /avatar/change seen yet: VRChat rewrites the current avatar's JSON on
  // load, so the most recently modified config is the best guess.
  function loadNewestAvatar (dir = OSC_DIR) {
    let best = null; let bestT = -1
    try {
      for (const u of fs.readdirSync(dir)) {
        const ad = path.join(dir, u, 'Avatars')
        let files = []; try { files = fs.readdirSync(ad).filter(f => /^avtr_.*\.json$/.test(f)) } catch (_) { continue }
        for (const f of files) { try { const t = fs.statSync(path.join(ad, f)).mtimeMs; if (t > bestT) { bestT = t; best = path.join(ad, f) } } catch (_) {} }
      }
    } catch (_) {}
    if (best) { try { setAvatar(parseConfig(fs.readFileSync(best, 'utf8'))) } catch (_) {} }
    return avatar
  }

  function onOsc (address, args) {
    if (address === '/avatar/change' && typeof args[0] === 'string') loadAvatarById(args[0])
  }

  function sendChanged (messages) {
    const out = []
    for (const m of messages) {
      const prev = lastSent.get(m.address)
      if (m.type === 'floats') { if (!prev || prev.some((v, i) => Math.abs(v - m.value[i]) > 0.05)) { out.push(m); lastSent.set(m.address, m.value.slice()) } continue }
      if (prev !== undefined && (m.type === 'float' ? Math.abs(prev - m.value) <= FLOAT_EPS : prev === m.value)) continue
      lastSent.set(m.address, m.value); out.push(m)
    }
    if (out.length && typeof send === 'function') send(out)
    stats.sent += out.length
    return out
  }

  // frame: { t (ms), face: { blendshapes, matrix, chin } | null, hands: [...] | null (null = not run this frame) }
  function onFrame (frame = {}) {
    const t = (frame.t || now()) / 1000
    stats.frames++
    fpsWindow.push(now()); while (fpsWindow.length && fpsWindow[0] < now() - 1000) fpsWindow.shift()
    stats.fps = fpsWindow.length
    const msgs = []

    if (cfg.face || cfg.eyes || cfg.head) {
      if (frame.face) {
        lastFaceAt = now(); faceActive = true
        const raw = faceFilter.apply(UE.rawFromMediaPipe(frame.face), t)
        if (calibrating) collectCalibration(raw)
        const data = UE.toUnified(UE.calibrate(raw, calibration), { intensity: cfg.intensity, mirror: cfg.mirror, face: cfg.face, eyes: cfg.eyes, head: cfg.head })
        msgs.push(...FT.evaluate(facePlan, data, { eyes: cfg.eyes, expressions: cfg.face }))
        stats.lastValues = pickPreview(data)
      } else if (faceActive && now() - lastFaceAt > cfg.faceLostMs) {
        // face lost: mark tracking inactive so avatars fall back to their own animations
        faceActive = false
        msgs.push(...facePlan.status.map(s => ({ address: s.address, type: 'bool', value: false })))
        faceFilter.reset()
      }
      stats.face = faceActive
    }

    if (cfg.hands && frame.hands) {
      const hands = HT.handsFromMediaPipe(frame.hands, { mirrored: cfg.mirror })
      for (const side of ['Left', 'Right']) {
        const h = hands[side]
        if (h) { const f = handFilter.apply(Object.fromEntries(Object.entries(h.curls).map(([k, v]) => [side + k, v])), t); for (const k of Object.keys(h.curls)) h.curls[k] = f[side + k] }
      }
      msgs.push(...HT.evaluateHands(handPlan, hands))
      stats.hands = { Left: !!hands.Left, Right: !!hands.Right }
      stats.curls = { Left: hands.Left && { ...hands.Left.curls, gesture: hands.Left.gesture }, Right: hands.Right && { ...hands.Right.curls, gesture: hands.Right.gesture } }
    }
    sendChanged(msgs)
  }

  function pickPreview (d) {
    const s = d.shapes
    return {
      JawOpen: s.JawOpen, SmileLeft: UE.simple(d, 'MouthSmileLeft'), SmileRight: UE.simple(d, 'MouthSmileRight'),
      EyeOpenLeft: d.eye.left.openness, EyeOpenRight: d.eye.right.openness,
      BrowUp: (UE.simple(d, 'BrowUpLeft') + UE.simple(d, 'BrowUpRight')) / 2, BrowDown: (UE.simple(d, 'BrowDownLeft') + UE.simple(d, 'BrowDownRight')) / 2,
      Pucker: s.LipPuckerUpperLeft, CheekPuff: s.CheekPuffLeft, EyeX: (d.eye.left.x + d.eye.right.x) / 2, EyeY: (d.eye.left.y + d.eye.right.y) / 2,
      HeadYaw: d.head.yaw, HeadPitch: d.head.pitch
    }
  }

  /* ---- calibration: hold a neutral face for N seconds ---- */
  function startCalibration (seconds = 2) { calibrating = { until: now() + seconds * 1000, sums: {}, n: 0 } }
  function collectCalibration (raw) {
    for (const [k, v] of Object.entries(raw)) calibrating.sums[k] = (calibrating.sums[k] || 0) + v
    calibrating.n++
    if (now() < calibrating.until) return
    const n = Math.max(1, calibrating.n); const next = {}
    for (const [k, sum] of Object.entries(calibrating.sums)) {
      const mean = sum / n
      const c = UE.CENTERED[k]
      if (c) { if (c.noCalibration) continue; const half = (c.pos - c.neg) / 2; next[k] = { neg: mean - half, neutral: mean, pos: mean + half } } else if (mean < 0.9) next[k] = { neutral: mean, max: 1 }
    }
    calibration = next
    if (saveSettings) saveSettings('calibration', calibration)
    calibrating = null
    emitStatus({ calibrated: true })
  }
  function resetCalibration () { calibration = {}; if (saveSettings) saveSettings('calibration', calibration) }

  function setConfig (patch = {}) {
    const next = { ...cfg }
    for (const k of ['face', 'eyes', 'head', 'hands', 'mirror', 'sendAll', 'nativeEyes']) if (typeof patch[k] === 'boolean') next[k] = patch[k]
    for (const [k, lo, hi] of [['intensity', 0.2, 3], ['minCutoff', 0.05, 10], ['beta', 0, 5]]) if (Number.isFinite(patch[k])) next[k] = Math.min(hi, Math.max(lo, patch[k]))
    const filterChanged = next.minCutoff !== cfg.minCutoff || next.beta !== cfg.beta
    const planChanged = next.sendAll !== cfg.sendAll || next.nativeEyes !== cfg.nativeEyes
    cfg = next
    if (filterChanged) { faceFilter.setOptions({ minCutoff: cfg.minCutoff, beta: cfg.beta, dCutoff: 1 }); handFilter.setOptions({ minCutoff: cfg.minCutoff, beta: cfg.beta, dCutoff: 1 }) }
    if (planChanged) replan()
    if (saveSettings) saveSettings('config', cfg)
    return { ...cfg }
  }

  // Called when tracking stops: tell the avatar tracking is off.
  function stop () {
    const off = facePlan.status.map(s => ({ address: s.address, type: 'bool', value: false }))
    for (const p of handPlan) if (p.type === 'Bool') off.push({ address: p.address, type: 'bool', value: false })
    if (off.length && typeof send === 'function') send(off)
    faceActive = false; lastSent.clear(); faceFilter.reset(); handFilter.reset()
  }

  function status (extra = {}) {
    return {
      ...extra,
      fps: stats.fps, face: stats.face, hands: stats.hands, values: stats.lastValues, curls: stats.curls, sent: stats.sent,
      calibrating: !!calibrating, calibrated: Object.keys(calibration).length > 0,
      avatar: avatar ? { id: avatar.id, name: avatar.name, fullFaceTracking: avatar.fullFaceTracking } : null,
      faceParams: facePlan.count, nativeEyes: facePlan.native, handParams: handPlan.length,
      config: { ...cfg }
    }
  }
  function emitStatus (extra) { if (typeof onStatus === 'function') onStatus(status(extra)) }

  replan()
  return { onFrame, onOsc, setAvatar, loadAvatarById, loadNewestAvatar, startCalibration, resetCalibration, setConfig, stop, status, emitStatus, getConfig: () => ({ ...cfg }) }
}

module.exports = { createTrackingEngine, DEFAULTS }

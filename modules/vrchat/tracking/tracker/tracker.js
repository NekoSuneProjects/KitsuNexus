// modules/vrchat/tracking/tracker/tracker.js
// Runs in the hidden tracker window. Opens ONE camera stream and feeds every
// frame to both MediaPipe models — FaceLandmarker (blendshapes + head pose)
// and HandLandmarker (21 points per hand) — so face and hand tracking share a
// single camera, like VRChat's own webcam "selfie" tracking. Results go to the
// main process over IPC; nothing leaves the PC.

import { FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker } from '../../../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'

const WASM_BASE = new URL('../../../../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url).href
const video = document.getElementById('cam')
const canvas = document.getElementById('preview')
const ctx = canvas.getContext('2d')

let cfg = null
let stream = null
let face = null
let hands = null
let pose = null
let lastPose = null
let timer = null
let frameNo = 0
let lastPreview = 0
let lastStatus = 0
let fpsTimes = []
let lastTs = 0
let lastHands = null
let fileset = null
let usingGpu = false
let fallingBack = false

const status = s => window.knTracker.status({ at: Date.now(), ...s })

const FACE_OPTS = { numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true }
const HAND_OPTS = { numHands: 2 }
const POSE_OPTS = { numPoses: 1 }
function createTask (Task, model, extra, delegate) {
  return Task.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate }, runningMode: 'VIDEO', ...extra })
}
async function createTasks (gpu) {
  const delegate = gpu ? 'GPU' : 'CPU'
  face = cfg.models.face ? await createTask(FaceLandmarker, cfg.models.face, FACE_OPTS, delegate) : null
  hands = cfg.models.hand ? await createTask(HandLandmarker, cfg.models.hand, HAND_OPTS, delegate) : null
  pose = cfg.models.pose ? await createTask(PoseLandmarker, cfg.models.pose, POSE_OPTS, delegate) : null
  usingGpu = gpu
}
function closeTasks () { for (const t of [face, hands, pose]) { try { if (t) t.close() } catch (_) {} } face = null; hands = null; pose = null }
// GPU can fail at creation OR on the first frames (no WebGL / bad driver):
// rebuild both models on the CPU once, instead of stopping.
async function fallBackToCpu () {
  if (fallingBack) return
  fallingBack = true
  closeTasks()
  try { await createTasks(false); status({ state: 'running', gpu: false, note: 'GPU unavailable — running on CPU' }) } catch (e) { status({ state: 'error', error: 'Model: ' + (e && e.message ? e.message : e) }) }
  fallingBack = false
}

async function start (c) {
  await stop()
  cfg = c
  status({ state: 'starting' })
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // width/fps 0 = Auto (720p @ 30); otherwise the mode picked in the tab
      video: { deviceId: c.deviceId ? { exact: c.deviceId } : undefined, ...window.KnCameraModes.constraintsFor(c, null) }
    })
  } catch (e) { status({ state: 'error', error: 'Camera: ' + (e && e.message ? e.message : e) }); return }
  video.srcObject = stream
  try { await video.play() } catch (_) {}
  try {
    fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
    if (c.gpu !== false) { try { await createTasks(true) } catch (_) { closeTasks(); await createTasks(false) } } else await createTasks(false)
  } catch (e) { status({ state: 'error', error: 'Model: ' + (e && e.message ? e.message : e) }); await stop(); return }
  const track = stream.getVideoTracks()[0]
  const st = track ? track.getSettings() : {}
  let caps = null
  try { const k = track && track.getCapabilities ? track.getCapabilities() : null; if (k) caps = { width: k.width, height: k.height, frameRate: k.frameRate } } catch (_) {}
  // what the camera actually gave us (it may not match what was asked for)
  status({ state: 'running', camera: track ? track.label : '', deviceId: st.deviceId || '', width: st.width, height: st.height, frameRate: st.frameRate ? Math.round(st.frameRate) : 0, caps, face: !!face, hands: !!hands, pose: !!pose, gpu: usingGpu })
  tick()
}

async function stop () {
  if (timer) { clearTimeout(timer); timer = null }
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null }
  video.srcObject = null
  closeTasks(); lastHands = null; lastPose = null
}

function tick () {
  const interval = 1000 / Math.max(5, Math.min(60, (cfg && cfg.fps) || 30))
  const t0 = performance.now()
  try { if (!fallingBack) processFrame() } catch (e) {
    if (usingGpu) fallBackToCpu()
    else status({ state: 'error', error: String(e && e.message ? e.message : e) })
  }
  timer = setTimeout(tick, Math.max(1, interval - (performance.now() - t0)))
}

function processFrame () {
  if (!stream || video.readyState < 2) return
  let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts // MediaPipe needs increasing timestamps
  frameNo++
  const frame = { t: Date.now(), face: null, hands: null, pose: null }
  let faceRes = null
  if (face && cfg.face !== false) {
    faceRes = face.detectForVideo(video, ts)
    if (faceRes.faceBlendshapes && faceRes.faceBlendshapes.length) {
      frame.face = {
        blendshapes: faceRes.faceBlendshapes[0].categories.map(c => ({ categoryName: c.categoryName, score: c.score })),
        matrix: faceRes.facialTransformationMatrixes && faceRes.facialTransformationMatrixes[0] ? Array.from(faceRes.facialTransformationMatrixes[0].data) : null,
        chin: faceRes.faceLandmarks[0] && faceRes.faceLandmarks[0][152] ? { x: faceRes.faceLandmarks[0][152].x, y: faceRes.faceLandmarks[0][152].y } : null
      }
    }
  }
  // Hands can run every Nth frame to save CPU; the same camera frame is shared.
  const everyN = Math.max(1, (cfg && cfg.handsEveryN) || 1)
  if (hands && cfg.hands !== false && frameNo % everyN === 0) {
    const r = hands.detectForVideo(video, ts)
    const hd = r.handedness || r.handednesses || []
    frame.hands = (r.landmarks || []).map((lm, i) => ({
      handedness: hd[i] && hd[i][0] ? hd[i][0].categoryName : '',
      score: hd[i] && hd[i][0] ? hd[i][0].score : 0,
      world: (r.worldLandmarks[i] || []).map(p => [p.x, p.y, p.z]),
      image: lm.map(p => [p.x, p.y, p.z])
    }))
    lastHands = frame.hands
  }
  // Body pose on the same camera frame (every Nth frame).
  const poseN = Math.max(1, (cfg && cfg.poseEveryN) || 1)
  if (pose && cfg.pose !== false && frameNo % poseN === 0) {
    const r = pose.detectForVideo(video, ts)
    if (r.worldLandmarks && r.worldLandmarks[0] && r.landmarks && r.landmarks[0]) {
      frame.pose = {
        world: r.worldLandmarks[0].map(p => [p.x, p.y, p.z, p.visibility == null ? 1 : p.visibility]),
        image: r.landmarks[0].map(p => [p.x, p.y, p.z, p.visibility == null ? 1 : p.visibility])
      }
    }
    lastPose = frame.pose
  }
  window.knTracker.frame(frame)

  const now = performance.now()
  fpsTimes.push(now); while (fpsTimes.length && fpsTimes[0] < now - 1000) fpsTimes.shift()
  if (now - lastStatus > 1000) { lastStatus = now; status({ state: 'running', fps: fpsTimes.length, faceSeen: !!frame.face, handsSeen: (lastHands || []).length, poseSeen: !!lastPose }) }
  if (cfg.preview && now - lastPreview > 200) { lastPreview = now; drawPreview(faceRes, lastHands, lastPose) }
}

// Small preview with landmarks, only while the Tracking tab is open.
const HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]]
const POSE_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]]
function drawPreview (faceRes, handList, poseRes) {
  const w = canvas.width; const h = canvas.height
  ctx.save()
  if (!cfg.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1) } // show it like a mirror
  ctx.drawImage(video, 0, 0, w, h)
  if (faceRes && faceRes.faceLandmarks && faceRes.faceLandmarks[0]) {
    ctx.fillStyle = 'rgba(167,139,250,.9)'
    const lm = faceRes.faceLandmarks[0]
    for (let i = 0; i < lm.length; i += 4) ctx.fillRect(lm[i].x * w - 1, lm[i].y * h - 1, 2, 2)
  }
  ctx.strokeStyle = 'rgba(52,211,153,.95)'; ctx.lineWidth = 2
  for (const hand of handList || []) {
    const p = hand.image
    ctx.beginPath()
    for (const [a, b] of HAND_EDGES) { if (!p[a] || !p[b]) continue; ctx.moveTo(p[a][0] * w, p[a][1] * h); ctx.lineTo(p[b][0] * w, p[b][1] * h) }
    ctx.stroke()
  }
  if (poseRes && poseRes.image) {
    const p = poseRes.image
    ctx.strokeStyle = 'rgba(96,165,250,.95)'; ctx.lineWidth = 3
    ctx.beginPath()
    for (const [a, b] of POSE_EDGES) { if (!p[a] || !p[b] || p[a][3] < 0.5 || p[b][3] < 0.5) continue; ctx.moveTo(p[a][0] * w, p[a][1] * h); ctx.lineTo(p[b][0] * w, p[b][1] * h) }
    ctx.stroke()
  }
  ctx.restore()
  window.knTracker.preview(canvas.toDataURL('image/jpeg', 0.6))
}

window.knTracker.onStart(c => { start(c) })
window.knTracker.onStop(() => { stop().then(() => status({ state: 'stopped' })) })
window.knTracker.onUpdate(c => { if (cfg) cfg = { ...cfg, ...c } })
window.knTracker.ready()

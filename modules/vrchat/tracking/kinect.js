// modules/vrchat/tracking/kinect.js
// Kinect v1 (Xbox 360 Kinect / Kinect for Windows v1) as a BODY source for Face, Hands &
// Body tracking: its depth-based skeleton doesn't need to see your face, works at a
// distance and in the dark, and feeds the same pipeline as the webcam pose model
// (VR OSC trackers for FBT, desktop BT/… parameters, jump).
//
// The Kinect v1 isn't a UVC webcam, so it needs Microsoft's Kinect for Windows SDK /
// Runtime 1.8. kinect/KinectBridge.cs is compiled ON THE USER'S PC with the C# compiler
// that ships with Windows (.NET Framework 4 csc.exe) against their installed
// Microsoft.Kinect.dll — nothing downloaded, no Microsoft binaries shipped. The bridge
// prints one JSON line per skeleton frame; kinectToPose() turns its 20 joints into the
// 33-point MediaPipe pose layout bodyTracking.js already understands. MAIN process.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn, execFile } = require('child_process')

const SOURCE = path.join(__dirname, 'kinect', 'KinectBridge.cs')
const WIN = process.env.WINDIR || 'C:\\Windows'
const CSC = [path.join(WIN, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(WIN, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')]
const KINECT_DLL = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft SDKs', 'Kinect', 'v1.8', 'Assemblies', 'Microsoft.Kinect.dll'),
  path.join(WIN, 'Microsoft.NET', 'assembly', 'GAC_MSIL', 'Microsoft.Kinect', 'v4.0_1.8.0.0__31bf3856ad364e35', 'Microsoft.Kinect.dll')
]
const first = list => list.find(p => { try { return fs.existsSync(p) } catch (_) { return false } }) || ''

// Kinect v1 joint order (JointType enum)
const KJ = { HipCenter: 0, Spine: 1, ShoulderCenter: 2, Head: 3, ShoulderLeft: 4, ElbowLeft: 5, WristLeft: 6, HandLeft: 7, ShoulderRight: 8, ElbowRight: 9, WristRight: 10, HandRight: 11, HipLeft: 12, KneeLeft: 13, AnkleLeft: 14, FootLeft: 15, HipRight: 16, KneeRight: 17, AnkleRight: 18, FootRight: 19 }
// Tracked joints count as seen; inferred ones (Kinect's guesses, e.g. legs behind a desk)
// stay just under bodyTracking's 0.5 "seen" threshold, like off-picture webcam guesses.
const VIS = [0, 0.45, 1]

// 20 Kinect joints [x, y, z, state, u, v] -> { world: 33 x [x,y,z,vis], image: 33 x [u,v,0,vis] }
// in MediaPipe's layout and axes (hip-centred, x = image right, y down, z away from camera).
// Kinect skeleton space: +x = the user's right (facing the sensor), +y up, +z away from the
// sensor. VRChat space (x = wearer's right, y up, z = wearer's forward = towards the sensor)
// = (x, y, -z); MediaPipe world = -VRChat = (-x, -y, z).
function kinectToPose (joints) {
  if (!Array.isArray(joints) || joints.length < 20) return null
  const j = i => joints[i] || [0, 0, 0, 0, 0, 0]
  const hl = j(KJ.HipLeft); const hr = j(KJ.HipRight)
  if (hl[3] === 0 && hr[3] === 0 && j(KJ.HipCenter)[3] === 0) return null
  const c = [(hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2, (hl[2] + hr[2]) / 2]
  // VRChat-space point relative to the hip centre, plus an optional VRChat-space offset
  const vrc = (i, off = [0, 0, 0]) => { const p = j(i); return [p[0] - c[0] + off[0], p[1] - c[1] + off[1], -(p[2] - c[2]) + off[2]] }
  const point = (i, off) => { const v = vrc(i, off); const p = j(i); return { w: [-v[0], -v[1], -v[2], VIS[p[3]] || 0], im: [p[4], p[5], 0, VIS[p[3]] || 0] } }
  const map = new Array(33)
  const set = (idx, i, off) => { map[idx] = point(i, off) }
  // head: nose a little in front, ears either side (Kinect has one head joint)
  set(0, KJ.Head, [0, -0.02, 0.09])
  for (const k of [1, 2, 3, 4, 5, 6, 9, 10]) set(k, KJ.Head, [0, 0, 0.07]) // eyes / mouth
  set(7, KJ.Head, [-0.075, 0, 0]); set(8, KJ.Head, [0.075, 0, 0])
  set(11, KJ.ShoulderLeft); set(12, KJ.ShoulderRight)
  set(13, KJ.ElbowLeft); set(14, KJ.ElbowRight)
  set(15, KJ.WristLeft); set(16, KJ.WristRight)
  for (const k of [17, 19, 21]) set(k, KJ.HandLeft) // pinky / index / thumb
  for (const k of [18, 20, 22]) set(k, KJ.HandRight)
  set(23, KJ.HipLeft); set(24, KJ.HipRight)
  set(25, KJ.KneeLeft); set(26, KJ.KneeRight)
  set(27, KJ.AnkleLeft); set(28, KJ.AnkleRight)
  set(29, KJ.AnkleLeft, [0, -0.05, -0.05]); set(30, KJ.AnkleRight, [0, -0.05, -0.05]) // heels
  set(31, KJ.FootLeft); set(32, KJ.FootRight) // toes
  return { world: map.map(p => p.w), image: map.map(p => p.im) }
}

function createKinect ({ dataDir, onFrame, onStatus, log = () => {} } = {}) {
  let proc = null
  let state = { state: 'stopped' }
  const setState = s => { state = { ...s, at: Date.now() }; if (typeof onStatus === 'function') onStatus(state) }

  function available () {
    if (process.platform !== 'win32') return { ok: false, error: 'The Kinect needs Windows (Kinect for Windows SDK / Runtime 1.8).' }
    const csc = first(CSC); const dll = first(KINECT_DLL)
    if (!dll) return { ok: false, error: 'Kinect for Windows Runtime / SDK 1.8 is not installed (free from Microsoft).' }
    if (!csc) return { ok: false, error: '.NET Framework 4 compiler (csc.exe) not found.' }
    return { ok: true, csc, dll }
  }

  // Compile the bridge into the user's data folder when it's missing or the source changed.
  function build () {
    return new Promise(resolve => {
      const a = available(); if (!a.ok) return resolve(a)
      let src
      try { src = fs.readFileSync(SOURCE, 'utf8') } catch (e) { return resolve({ ok: false, error: 'Kinect bridge source missing: ' + e.message }) }
      const hash = crypto.createHash('sha256').update(src).update(a.dll).digest('hex').slice(0, 16)
      const dir = path.join(dataDir, 'kinect'); const exe = path.join(dir, 'KinectBridge.exe'); const stamp = path.join(dir, 'build.txt')
      try { if (fs.existsSync(exe) && fs.readFileSync(stamp, 'utf8') === hash) return resolve({ ok: true, exe }) } catch (_) {}
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'KinectBridge.cs'), src) } catch (e) { return resolve({ ok: false, error: e.message }) }
      setState({ state: 'building' })
      execFile(a.csc, ['/nologo', '/target:exe', '/optimize+', '/r:' + a.dll, '/out:' + exe, path.join(dir, 'KinectBridge.cs')], { windowsHide: true, timeout: 120000 }, (err, stdout) => {
        if (err) { log('[kinect] build failed', stdout || err.message); return resolve({ ok: false, error: 'Building the Kinect bridge failed: ' + String(stdout || err.message).trim().slice(0, 300) }) }
        try { fs.writeFileSync(stamp, hash) } catch (_) {}
        resolve({ ok: true, exe })
      })
    })
  }

  const STATUS_TEXT = {
    NotPowered: 'Kinect has no power — plug in its power adapter (the Xbox 360 Kinect needs the mains adapter, USB alone is not enough).',
    Disconnected: 'Kinect unplugged.',
    NotReady: 'Kinect is starting…',
    Initializing: 'Kinect is starting…',
    DeviceNotGenuine: 'This Kinect is not supported by the Kinect SDK.',
    DeviceNotSupported: 'This Kinect is not supported by the Kinect SDK.',
    InsufficientBandwidth: 'Not enough USB bandwidth — plug the Kinect into its own USB controller / port.',
    Error: 'Kinect error.',
    'no Kinect found': 'No Kinect found — check the USB and power cables.'
  }

  async function start ({ seated = false } = {}) {
    stop()
    const b = await build()
    if (!b.ok) { setState({ state: 'error', error: b.error }); return b }
    let child
    try { child = spawn(b.exe, seated ? ['seated'] : [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) } catch (e) { setState({ state: 'error', error: e.message }); return { ok: false, error: e.message } }
    proc = child
    setState({ state: 'starting' })
    let buf = ''; let frames = 0; let tracked = 0; let lastCount = Date.now()
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', d => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line) continue
        let m; try { m = JSON.parse(line) } catch (_) { continue }
        if (m.status) {
          if (m.status === 'running') setState({ state: 'running', mode: m.detail })
          else if (m.status === 'error') setState({ state: 'error', error: m.detail })
          else setState({ state: m.status === 'waiting' ? 'waiting' : state.state, sensor: m.detail, note: STATUS_TEXT[m.detail] || ('Kinect: ' + m.detail) })
          continue
        }
        frames++
        const pose = m.j ? kinectToPose(m.j) : null
        if (pose) tracked++
        if (typeof onFrame === 'function') onFrame({ t: Date.now(), pose })
        if (Date.now() - lastCount > 1000) { state = { ...state, fps: frames, person: tracked > 0 }; frames = 0; tracked = 0; lastCount = Date.now() }
      }
    })
    child.stderr.on('data', d => log('[kinect]', String(d).trim()))
    child.on('exit', code => { if (proc === child) { proc = null; if (state.state !== 'stopped') setState({ state: 'stopped', note: code ? 'Kinect bridge exited (' + code + ')' : '' }) } })
    return { ok: true }
  }

  function stop () {
    const p = proc; proc = null
    if (p) { try { p.stdin.end() } catch (_) {} setTimeout(() => { try { p.kill() } catch (_) {} }, 1500) }
    if (state.state !== 'stopped') setState({ state: 'stopped' })
  }

  return { start, stop, available, build, status: () => ({ ...state, available: available().ok }) }
}

module.exports = { createKinect, kinectToPose, KJ }

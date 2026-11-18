// modules/vrchat/tracking/handParams.js
// Webcam hand tracking -> avatar parameters over OSC.
//
// VRChat can't take finger bones from OSC (hands always come from your
// controllers / desktop), so like other OSC hand-tracking tools this drives
// avatar *parameters* that an avatar's animator uses. All under "HT/":
//   HT/LeftThumbCurl … HT/LeftPinkyCurl   float 0 (straight) .. 1 (curled)
//   HT/LeftSpread                         float 0 (fingers together) .. 1 (spread)
//   HT/LeftGesture                        int   0-7, same numbering as VRChat's GestureLeft
//   HT/LeftDetected                       bool  hand visible to the camera
//   HT/LeftX, HT/LeftY                    float −1..1 wrist position in the camera frame
// (and the same for Right). Only parameters the avatar has are sent, like the
// face parameters. Pure functions; MAIN process.

const FINGERS = {
  Thumb: [1, 2, 3, 4],
  Index: [5, 6, 7, 8],
  Middle: [9, 10, 11, 12],
  Ring: [13, 14, 15, 16],
  Pinky: [17, 18, 19, 20]
}
const FINGER_NAMES = Object.keys(FINGERS)

// VRChat gesture numbering (GestureLeft / GestureRight).
const GESTURES = { Neutral: 0, Fist: 1, HandOpen: 2, FingerPoint: 3, Victory: 4, RockNRoll: 5, HandGun: 6, ThumbsUp: 7 }

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0)]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = a => Math.sqrt(dot(a, a)) || 1e-9
// Bend at joint b between segments a->b and b->c: 0 = straight, π = folded back.
function bend (a, b, c) {
  const u = sub(b, a); const v = sub(c, b)
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v)))))
}
const pt = p => (Array.isArray(p) ? [p[0], p[1], p[2] || 0] : [p.x, p.y, p.z || 0])

// Curl per finger from 21 3-D landmarks (MediaPipe world landmarks preferred).
// Sum of the three joint bends, normalised: fingers ~ 0..260°, thumb ~ 0..140°.
function fingerCurls (landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return null
  const L = landmarks.map(pt)
  const out = {}
  for (const [name, [j1, j2, j3, j4]] of Object.entries(FINGERS)) {
    const base = name === 'Thumb' ? L[j1] : L[0] // wrist -> MCP for the long fingers
    const total = bend(base, L[j1], L[j2]) * (name === 'Thumb' ? 0 : 1) + bend(L[j1], L[j2], L[j3]) + bend(L[j2], L[j3], L[j4])
    const maxRad = (name === 'Thumb' ? 140 : 260) * Math.PI / 180
    out[name] = Math.max(0, Math.min(1, total / maxRad))
  }
  return out
}

// How spread the fingers are: mean angle between neighbouring finger directions.
function fingerSpread (landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return 0
  const L = landmarks.map(pt)
  const dir = (mcp, tip) => sub(L[tip], L[mcp])
  const pairs = [[dir(5, 8), dir(9, 12)], [dir(9, 12), dir(13, 16)], [dir(13, 16), dir(17, 20)]]
  const ang = pairs.map(([a, b]) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))))
  const mean = ang.reduce((x, y) => x + y, 0) / ang.length
  return Math.max(0, Math.min(1, mean / (25 * Math.PI / 180)))
}

// Curls -> VRChat gesture number. Extended < 0.35, curled > 0.6.
function classifyGesture (c) {
  if (!c) return GESTURES.Neutral
  const ext = n => c[n] < 0.35
  const cur = n => c[n] > 0.6
  const others = (...names) => FINGER_NAMES.filter(n => n !== 'Thumb' && !names.includes(n)).every(cur)
  if (FINGER_NAMES.every(ext)) return GESTURES.HandOpen
  if (ext('Index') && ext('Middle') && others('Index', 'Middle')) return GESTURES.Victory
  if (ext('Index') && ext('Pinky') && others('Index', 'Pinky')) return GESTURES.RockNRoll
  if (ext('Thumb') && ext('Index') && others('Index')) return GESTURES.HandGun
  if (ext('Index') && others('Index')) return GESTURES.FingerPoint
  if (ext('Thumb') && others()) return GESTURES.ThumbsUp
  if (['Index', 'Middle', 'Ring', 'Pinky'].every(cur)) return GESTURES.Fist
  return GESTURES.Neutral
}

// MediaPipe hands -> { Left: {...}, Right: {...} } for the *user's* hands.
// MediaPipe labels handedness as if the image were mirrored (selfie view); a
// raw webcam frame isn't, so its "Left" is the user's right hand — swapped
// unless the camera image is already mirrored.
//   hands: [{ handedness: 'Left'|'Right', score, world: [21 pts], image: [21 pts] }]
function handsFromMediaPipe (hands, { mirrored = false } = {}) {
  const out = { Left: null, Right: null }
  for (const h of Array.isArray(hands) ? hands : []) {
    if (!h || !h.handedness) continue
    const side = mirrored ? h.handedness : (h.handedness === 'Left' ? 'Right' : 'Left')
    if (out[side] && (out[side].score || 0) >= (h.score || 0)) continue
    const lm = Array.isArray(h.world) && h.world.length >= 21 ? h.world : h.image
    const curls = fingerCurls(lm)
    if (!curls) continue
    const wrist = Array.isArray(h.image) && h.image[0] ? pt(h.image[0]) : [0.5, 0.5, 0]
    out[side] = {
      score: h.score || 0,
      curls,
      spread: fingerSpread(lm),
      gesture: classifyGesture(curls),
      // camera-frame position, −1..1 (x flipped so moving your hand right is +)
      x: Math.max(-1, Math.min(1, (mirrored ? wrist[0] - 0.5 : 0.5 - wrist[0]) * 2)),
      y: Math.max(-1, Math.min(1, (0.5 - wrist[1]) * 2))
    }
  }
  return out
}

// Parameter names for one side.
function paramNames () {
  const names = []
  for (const side of ['Left', 'Right']) {
    for (const f of FINGER_NAMES) names.push({ name: `HT/${side}${f}Curl`, type: 'Float' })
    names.push({ name: `HT/${side}Spread`, type: 'Float' }, { name: `HT/${side}Gesture`, type: 'Int' }, { name: `HT/${side}Detected`, type: 'Bool' },
      { name: `HT/${side}X`, type: 'Float' }, { name: `HT/${side}Y`, type: 'Float' })
  }
  return names
}
const HAND_PARAMS = paramNames()

// Which HT params the avatar has (address ends with "/HT/…" or equals "HT/…").
function planHands (avatarParams, { sendAll = false } = {}) {
  const params = Array.isArray(avatarParams) ? avatarParams : []
  const plan = []
  for (const p of HAND_PARAMS) {
    const hit = params.find(a => a.type === p.type && (a.address.endsWith('/' + p.name) || a.address === p.name))
    if (hit) plan.push({ ...p, address: hit.address })
    else if (sendAll) plan.push({ ...p, address: '/avatar/parameters/' + p.name }) // testing: only for params the avatar lacks
  }
  return plan
}

function evaluateHands (plan, hands) {
  const out = []
  for (const p of plan) {
    const m = /^HT\/(Left|Right)(.+)$/.exec(p.name); if (!m) continue
    const h = hands && hands[m[1]]
    const key = m[2]
    let value
    if (key === 'Detected') value = !!h
    else if (!h) value = key === 'Gesture' ? 0 : 0 // hand lost: relax to neutral
    else if (key.endsWith('Curl')) value = h.curls[key.slice(0, -4)] || 0
    else if (key === 'Spread') value = h.spread
    else if (key === 'Gesture') value = h.gesture
    else if (key === 'X') value = h.x
    else if (key === 'Y') value = h.y
    out.push({ address: p.address, type: p.type === 'Int' ? 'int' : p.type === 'Bool' ? 'bool' : 'float', value })
  }
  return out
}

module.exports = { FINGERS, GESTURES, HAND_PARAMS, fingerCurls, fingerSpread, classifyGesture, handsFromMediaPipe, planHands, evaluateHands }

// modules/vrchat/tracking/cameraModes.js
// Turns a webcam's reported capabilities (MediaStreamTrack.getCapabilities())
// into the resolution / FPS choices it really supports, for the Face, Hands &
// Body tab and the tracker window. Works as a CommonJS module (main process,
// tests) and as a plain <script> (window.KnCameraModes) in the renderer.
;(function (root) {
  'use strict'

  // Common camera modes, biggest first.
  const STANDARD_RESOLUTIONS = [
    [3840, 2160, '4K'], [2560, 1440, '1440p'], [1920, 1080, '1080p'], [1600, 900, '900p'],
    [1280, 960, '960p'], [1280, 720, '720p'], [1024, 576, '576p'], [960, 540, '540p'],
    [800, 600, 'SVGA'], [848, 480, '480p wide'], [640, 480, '480p'], [640, 360, '360p'],
    [424, 240, '240p wide'], [320, 240, '240p']
  ]
  const STANDARD_FPS = [120, 90, 60, 50, 30, 25, 24, 20, 15, 10, 5]
  // What "Auto" asks for: plenty for MediaPipe (it scales frames down to ~256 px
  // anyway); bigger just costs CPU.
  const AUTO = { width: 1280, height: 720, fps: 30 }

  const range = r => (r && Number.isFinite(r.max) ? { min: Number.isFinite(r.min) ? r.min : 1, max: r.max } : null)

  // caps: { width: {min,max}, height: {min,max}, frameRate: {min,max} } (any may be missing)
  function resolutionsFor (caps) {
    const w = range(caps && caps.width); const h = range(caps && caps.height)
    if (!w || !h) return STANDARD_RESOLUTIONS.filter(([rw, rh]) => rw <= 1920 && rh <= 1080).map(([width, height, label]) => ({ width, height, label })) // unknown camera: safe list
    const out = STANDARD_RESOLUTIONS
      .filter(([rw, rh]) => rw <= w.max && rh <= h.max && rw >= w.min && rh >= h.min)
      .map(([width, height, label]) => ({ width, height, label }))
    // the camera's own maximum, if it isn't a standard size (e.g. 2592×1944)
    if (!out.some(r => r.width === w.max && r.height === h.max)) out.unshift({ width: w.max, height: h.max, label: 'max' })
    return out
  }

  function fpsFor (caps) {
    const f = range(caps && caps.frameRate)
    if (!f) return [60, 30, 25, 24, 15]
    const out = STANDARD_FPS.filter(x => x <= f.max + 0.5 && x >= f.min - 0.5)
    const top = Math.round(f.max)
    if (!out.includes(top) && top > 0) out.unshift(top)
    return out.length ? out : [top || 30]
  }

  // The mode "Auto" resolves to on this camera: 720p@30, or the closest it has.
  function autoMode (caps) {
    const res = resolutionsFor(caps)
    const pick = res.find(r => r.width === AUTO.width && r.height === AUTO.height) ||
      res.filter(r => r.width * r.height <= AUTO.width * AUTO.height).sort((a, b) => b.width * b.height - a.width * a.height)[0] ||
      res[res.length - 1] || AUTO
    const fps = fpsFor(caps)
    const pickFps = fps.includes(AUTO.fps) ? AUTO.fps : (fps.filter(x => x <= AUTO.fps)[0] || fps[fps.length - 1] || AUTO.fps)
    return { width: pick.width, height: pick.height, fps: pickFps }
  }

  // Settings -> getUserMedia constraints. width 0 = Auto.
  function constraintsFor (cam, caps) {
    const want = (!cam || !cam.width) ? autoMode(caps) : { width: cam.width, height: cam.height, fps: cam.fps || AUTO.fps }
    const fps = (!cam || !cam.fps) ? want.fps : cam.fps
    return { width: { ideal: want.width }, height: { ideal: want.height }, frameRate: { ideal: fps } }
  }

  const label = r => `${r.width}×${r.height}${r.label && r.label !== 'max' ? ` (${r.label})` : r.label === 'max' ? ' (camera max)' : ''}`

  const api = { STANDARD_RESOLUTIONS, STANDARD_FPS, AUTO, resolutionsFor, fpsFor, autoMode, constraintsFor, label }
  // Both: the main window has Node integration, so `module` exists there too.
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.KnCameraModes = api
})(typeof window !== 'undefined' ? window : this)

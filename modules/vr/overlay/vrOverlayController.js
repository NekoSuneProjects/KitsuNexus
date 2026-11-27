'use strict'

// Mirrors the main window into the VR overlay by periodically screenshotting
// it and pushing the image to SteamVR (see openvrOverlay.js). Non-interactive
// first slice - see it floating in VR, click-through input is a follow-up
// once this base mirror is confirmed working on a real headset. Runs in the
// MAIN process.

const path = require('path')
const fs = require('fs')
const os = require('os')
const overlay = require('./openvrOverlay')
const hud = require('./hudWindow')

let mainWindowRef = null
let captureTimer = null
let running = false
let framePath = null
let onStatus = () => {}
let busy = false

function init (mainWindow, statusCb) {
  mainWindowRef = mainWindow
  if (statusCb) onStatus = statusCb
}

async function captureAndPush () {
  if (!running || busy) return
  busy = true
  try {
    const surface = hud.getVrSurface()
    if (surface.webContents.isLoading()) return
    const image = await surface.webContents.capturePage()
    await fs.promises.writeFile(framePath, image.toPNG())
    overlay.updateFrame(framePath)
  } catch (err) {
    onStatus({ running: true, error: err.message })
  } finally {
    busy = false
  }
}

// `running` is only set after the awaits below, so a second start() (double
// click / auto-start + click) used to get past the check and create a second
// overlay + capture loop. `starting` closes that gap.
let starting = false
async function start ({ intervalMs = 500 } = {}) {
  if (running || starting) return
  if (!overlay.isAvailable()) throw new Error('SteamVR does not appear to be installed.')

  starting = true
  hud.getVrSurface()
  try {
    await overlay.start({ overlayKey: 'KitsuNexus.hud', overlayName: 'KitsuNexus HUD' })
  } catch (err) {
    starting = false
    hud.closeVrSurface()
    throw err
  }
  starting = false
  framePath = path.join(os.tmpdir(), `KitsuNexus-vr-frame-${process.pid}.png`)
  running = true
  onStatus({ running: true })

  await captureAndPush()
  captureTimer = setInterval(captureAndPush, Math.max(200, intervalMs))
}

function stop () {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null }
  running = false
  try { overlay.stop() } catch (_) {}
  hud.closeVrSurface()
  if (framePath) { try { fs.unlinkSync(framePath) } catch (_) {} }
  onStatus({ running: false })
}

function isRunning () { return running }
function isAvailable () { return overlay.isAvailable() }

module.exports = { init, start, stop, isRunning, isAvailable }

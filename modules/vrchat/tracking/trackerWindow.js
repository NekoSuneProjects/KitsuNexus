// modules/vrchat/tracking/trackerWindow.js
// Owns the hidden camera tracker window (tracker/tracker.html). It runs in its
// own session where every network request is cancelled — models are passed in
// over IPC and the MediaPipe runtime is a local file, so it never needs the
// network, and nothing (images, landmarks or usage metrics) can leave the PC.
// MAIN process.

const path = require('path')
const { BrowserWindow, ipcMain, session } = require('electron')

const PARTITION = 'kn-tracking'
let blocked = false
function lockDownSession () {
  const ses = session.fromPartition(PARTITION)
  if (!blocked) {
    blocked = true
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, cb) => cb({ cancel: true }))
    // Camera only; deny every other permission.
    ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permission === 'media' && (!details || !details.mediaTypes || details.mediaTypes.every(t => t === 'video'))))
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  }
  return ses
}

function createTrackerWindow ({ onFrame, onStatus, onPreview } = {}) {
  let win = null
  let ready = null // promise resolved when the page's script is up
  let pendingStart = null

  function ensure () {
    if (win && !win.isDestroyed()) return ready
    win = new BrowserWindow({
      show: false, width: 340, height: 280, skipTaskbar: true,
      webPreferences: {
        partition: PARTITION, preload: path.join(__dirname, 'tracker', 'trackerPreload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false // keep tracking while hidden / the app is minimised
      }
    })
    lockDownSession()
    const id = win.webContents.id
    ready = new Promise(resolve => {
      const onReady = e => { if (e.sender.id === id) { ipcMain.removeListener('tracker:ready', onReady); resolve() } }
      ipcMain.on('tracker:ready', onReady)
    })
    win.on('closed', () => { win = null; ready = null })
    win.loadFile(path.join(__dirname, 'tracker', 'tracker.html'))
    return ready
  }

  // Only accept messages from our own tracker window.
  const fromTracker = fn => (e, payload) => { if (win && !win.isDestroyed() && e.sender.id === win.webContents.id) fn(payload) }
  const hFrame = fromTracker(f => onFrame && onFrame(f))
  const hStatus = fromTracker(s => onStatus && onStatus(s))
  const hPreview = fromTracker(p => onPreview && typeof p === 'string' && p.startsWith('data:image/jpeg;base64,') && onPreview(p))
  ipcMain.on('tracker:frame', hFrame)
  ipcMain.on('tracker:status', hStatus)
  ipcMain.on('tracker:preview', hPreview)

  return {
    async start (cfg) {
      pendingStart = cfg
      await ensure()
      if (win && pendingStart === cfg) win.webContents.send('tracker:start', cfg)
    },
    stop () { pendingStart = null; if (win && !win.isDestroyed()) win.webContents.send('tracker:stop') },
    update (patch) { if (win && !win.isDestroyed()) win.webContents.send('tracker:update', patch) },
    destroy () {
      ipcMain.removeListener('tracker:frame', hFrame); ipcMain.removeListener('tracker:status', hStatus); ipcMain.removeListener('tracker:preview', hPreview)
      if (win && !win.isDestroyed()) win.destroy()
      win = null
    },
    isOpen: () => !!(win && !win.isDestroyed()),
    _webContents: () => (win && !win.isDestroyed() ? win.webContents : null)
  }
}

module.exports = { createTrackerWindow, PARTITION }

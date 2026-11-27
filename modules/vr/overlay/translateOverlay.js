'use strict'

// modules/vr/overlay/translateOverlay.js  (MAIN process)
// Live on-screen translation: a transparent, click-through, always-on-top
// window that draws each translation right above the chatbox bubble / text it
// came from, like a live "lens" translate.
//
// Frame -> screen mapping: OCR positions are in captured-frame pixels.
//  - Screen capture: the capture source names its display (display_id), so the
//    frame maps onto that display's bounds.
//  - Window capture (e.g. VRChat): the source id is "window:<HWND>:…"; Windows
//    is asked where that window is (GetWindowRect) and the frame maps onto it.
// The overlay window is excluded from screen capture (setContentProtection),
// otherwise OCR would read its own labels and translate the translations.

const path = require('path')
const { execFile } = require('child_process')

let electron = null
let win = null
let lastSource = null // { id, display_id }
let windowRectCache = { hwnd: '', at: 0, rect: null }

function setCaptureSource (source) {
  if (!source) return
  lastSource = { id: String(source.id || ''), display_id: String(source.display_id || '') }
}

// Physical-pixel window rectangle of a window handle, via user32.GetWindowRect.
function getWindowRect (hwnd) {
  return new Promise(resolve => {
    const ps = `Add-Type -Namespace KN -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h); public struct RECT { public int Left, Top, Right, Bottom; }'; $r = New-Object KN.W+RECT; if ([KN.W]::IsIconic([IntPtr]${Number(hwnd)})) { 'min' } elseif ([KN.W]::GetWindowRect([IntPtr]${Number(hwnd)}, [ref]$r)) { "$($r.Left),$($r.Top),$($r.Right),$($r.Bottom)" }`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const m = !err && String(out || '').trim().match(/^(-?\d+),(-?\d+),(-?\d+),(-?\d+)$/)
      resolve(m ? { x: +m[1], y: +m[2], width: +m[3] - +m[1], height: +m[4] - +m[2] } : null)
    })
  })
}

// Where (in DIP screen coordinates) the captured frame is on screen.
async function captureRect () {
  const { screen } = electron
  const id = lastSource && lastSource.id
  if (id && id.startsWith('window:')) {
    const hwnd = id.split(':')[1]
    if (windowRectCache.hwnd !== hwnd || Date.now() - windowRectCache.at > 2000) {
      const phys = process.platform === 'win32' ? await getWindowRect(hwnd) : null
      windowRectCache = { hwnd, at: Date.now(), rect: phys ? screen.screenToDipRect(null, phys) : null }
    }
    if (windowRectCache.rect) return windowRectCache.rect
  }
  const displays = screen.getAllDisplays()
  const d = (lastSource && displays.find(x => String(x.id) === lastSource.display_id)) || screen.getPrimaryDisplay()
  return d.bounds
}

function ensureWindow (bounds) {
  const { BrowserWindow } = electron
  if (win && !win.isDestroyed()) {
    const b = win.getBounds()
    if (b.x !== bounds.x || b.y !== bounds.y || b.width !== bounds.width || b.height !== bounds.height) win.setBounds(bounds)
    return win
  }
  win = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'translateOverlayPreload.js') }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true)
  try { win.setContentProtection(true) } catch (_) {} // keep our labels out of the OCR capture
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.loadFile(path.join(__dirname, 'translateOverlay.html'))
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.showInactive() })
  win.on('closed', () => { win = null })
  return win
}

// payload: { labels: [{ text, original, x0, y0, x1, y1 }], frameWidth, frameHeight, ttlMs }
async function show (payload = {}, deps) {
  if (!electron) electron = deps || require('electron')
  const labels = Array.isArray(payload.labels) ? payload.labels.slice(0, 30) : []
  if (!labels.length || !payload.frameWidth || !payload.frameHeight) {
    if (win && !win.isDestroyed()) win.webContents.send('translate-overlay:labels', { labels: [], ttlMs: 0 })
    return { ok: true, shown: 0 }
  }
  const rect = await captureRect()
  // The overlay covers the display the captured area is on.
  const display = electron.screen.getDisplayMatching(rect)
  const w = ensureWindow(display.bounds)
  const sx = rect.width / payload.frameWidth
  const sy = rect.height / payload.frameHeight
  const placed = labels.map(l => ({
    text: String(l.text || '').slice(0, 300),
    // bubble box in overlay-window coordinates
    x0: rect.x - display.bounds.x + l.x0 * sx,
    y0: rect.y - display.bounds.y + l.y0 * sy,
    x1: rect.x - display.bounds.x + l.x1 * sx,
    y1: rect.y - display.bounds.y + l.y1 * sy
  }))
  const send = () => { if (w && !w.isDestroyed()) w.webContents.send('translate-overlay:labels', { labels: placed, ttlMs: Math.max(2000, Number(payload.ttlMs) || 5000) }) }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send()
  return { ok: true, shown: placed.length }
}

// KitsuNexus' own visible windows (HUD, widgets, main window), as rectangles
// in captured-frame pixels, so OCR can blank them out: otherwise it reads our
// own HUD back (e.g. a 🎁 gift card becomes a "new" gift - a feedback loop).
// They're masked rather than hidden from capture so OBS still shows them.
async function ownWindowFrameRects (frameWidth, frameHeight, deps) {
  if (!electron) electron = deps || require('electron')
  if (!frameWidth || !frameHeight) return []
  const rect = await captureRect()
  const sx = frameWidth / rect.width
  const sy = frameHeight / rect.height
  const out = []
  for (const w of electron.BrowserWindow.getAllWindows()) {
    if (w === win || w.isDestroyed() || !w.isVisible() || w.isMinimized()) continue
    // Only windows actually on top of the game: the HUD / widgets (always on
    // top) or a focused window. The main window usually sits BEHIND VRChat
    // while still "visible" - masking it would blank real chatboxes.
    const onTop = (typeof w.isAlwaysOnTop === 'function' && w.isAlwaysOnTop()) || (typeof w.isFocused === 'function' && w.isFocused())
    if (!onTop) continue
    const b = w.getBounds()
    const x0 = Math.max(0, (b.x - rect.x) * sx); const y0 = Math.max(0, (b.y - rect.y) * sy)
    const x1 = Math.min(frameWidth, (b.x + b.width - rect.x) * sx); const y1 = Math.min(frameHeight, (b.y + b.height - rect.y) * sy)
    if (x1 > x0 && y1 > y0) out.push({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) })
  }
  return out
}

function hide () {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

module.exports = { show, hide, setCaptureSource, ownWindowFrameRects, _captureRect: captureRect }

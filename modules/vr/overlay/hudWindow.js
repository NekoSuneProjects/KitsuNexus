'use strict'

const path = require('path')
const { BrowserWindow, screen, globalShortcut, ipcMain } = require('electron')

const DEFAULTS = Object.freeze({ width: 430, height: 380, x: null, y: null, opacity: 0.94, clickThrough: false, alwaysOnTop: true })
let desktop = null
let vr = null
const detached = new Map()
const detachable = new Set(['players', 'alerts', 'tiles', 'lyrics'])
const detachedBounds = new Map()
let onBounds = () => {}
let lastData = {}
let desktopOptions = { ...DEFAULTS }
let onOptions = () => {}
const RECOVERY_HOTKEY = 'CommandOrControl+Shift+F10'
let recoveryRegistered = false
function recoverDesktop () {
  if (!desktop || desktop.isDestroyed()) return
  const area = screen.getPrimaryDisplay().workArea
  desktop.setIgnoreMouseEvents(false)
  desktop.setOpacity(1)
  desktop.setAlwaysOnTop(true, 'screen-saver')
  const bounds = desktop.getBounds()
  desktop.setBounds({ x: area.x + 24, y: area.y + 32, width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) })
  desktop.showInactive()
  desktopOptions = normalise({ ...desktopOptions, clickThrough: false, opacity: 1, alwaysOnTop: true })
  onOptions({ opacity: 1, clickThrough: false, alwaysOnTop: true })
}
function registerRecovery () {
  if (recoveryRegistered) return
  try { recoveryRegistered = globalShortcut.register(RECOVERY_HOTKEY, recoverDesktop) } catch (_) { recoveryRegistered = false }
}
function unregisterRecovery () {
  if (!recoveryRegistered) return
  globalShortcut.unregister(RECOVERY_HOTKEY)
  recoveryRegistered = false
}

function normalise (input = {}) {
  return {
    width: Math.round(Math.max(280, Math.min(800, Number(input.width) || DEFAULTS.width))),
    height: Math.round(Math.max(280, Math.min(750, Number(input.height) || DEFAULTS.height))),
    x: Number.isFinite(input.x) ? input.x : null,
    y: Number.isFinite(input.y) ? input.y : null,
    opacity: Math.max(0.25, Math.min(1, Number(input.opacity) || DEFAULTS.opacity)),
    clickThrough: !!input.clickThrough,
    alwaysOnTop: input.alwaysOnTop !== false
  }
}

function visibleBounds (cfg) {
  const displays = screen.getAllDisplays().map(display => display.workArea)
  const primary = screen.getPrimaryDisplay().workArea
  const x = cfg.x == null ? primary.x + primary.width - cfg.width - 24 : cfg.x
  const y = cfg.y == null ? primary.y + 32 : cfg.y
  // Keep the draggable title bar reachable even after a monitor is disconnected.
  const visible = displays.find(area =>
    x + cfg.width > area.x + 48 && x < area.x + area.width - 48 &&
    y + 40 > area.y && y < area.y + area.height - 40
  )
  if (visible) return {
    x: Math.max(visible.x - cfg.width + 96, Math.min(x, visible.x + visible.width - 96)),
    y: Math.max(visible.y, Math.min(y, visible.y + visible.height - 40))
  }
  return {
    x: primary.x + Math.max(0, primary.width - cfg.width - 24),
    y: primary.y + 32
  }
}

function create (options, mode) {
  const cfg = normalise(options)
  const bounds = visibleBounds(cfg)
  const window = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: mode === 'desktop',
    skipTaskbar: true,
    show: false,
    alwaysOnTop: mode === 'desktop' && cfg.alwaysOnTop,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'hudPreload.js'),
      backgroundThrottling: false,
      offscreen: mode === 'vr'
    }
  })
  window.setMenuBarVisibility(false)
  window.loadFile(path.join(__dirname, 'hud.html'), { query: { mode } })
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('kitsunexus:hud-data', lastData)
  })
  if (mode === 'desktop') {
    window.setOpacity(cfg.opacity)
    window.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
    // Transparent windows may never emit ready-to-show on some GPU/driver setups.
    let shown = false
    const reveal = () => {
      if (shown || window.isDestroyed()) return
      shown = true
      window.showInactive()
      if (cfg.alwaysOnTop) window.setAlwaysOnTop(true, 'screen-saver')
    }
    window.once('ready-to-show', reveal)
    window.webContents.once('did-finish-load', reveal)
    window.webContents.on('did-fail-load', (_event, code, description) => {
      console.error('[Desktop HUD] Failed to load:', code, description)
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[Desktop HUD] Renderer exited:', details.reason)
    })
    setTimeout(reveal, 2500).unref?.()
  } else {
    // Off-screen painted surface, no extra desktop window.
    window.webContents.setFrameRate?.(15)
  }
  return window
}

function toggleDetached (event, widget) {
  if (!desktop || desktop.isDestroyed() || event.sender !== desktop.webContents || !detachable.has(widget)) return { ok: false }
  const existing = detached.get(widget)
  if (existing && !existing.isDestroyed()) { existing.close(); return { ok: true, detached: false } }
  const area = screen.getPrimaryDisplay().workArea
  const saved = detachedBounds.get(widget)
  const cfg = { width: 340, height: widget === 'tiles' ? 260 : 180, x: saved?.x ?? area.x + 80, y: saved?.y ?? area.y + 80 }
  const bounds = visibleBounds(cfg)
  const win = new BrowserWindow({ width: saved?.width || cfg.width, height: saved?.height || cfg.height, x: bounds.x, y: bounds.y, frame: false, transparent: true, resizable: true, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#00000000', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'hudPreload.js') } })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'hud.html'), { query: { mode: 'desktop', widget } })
  win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) win.webContents.send('kitsunexus:hud-data', lastData) })
  const save = () => { if (!win.isDestroyed()) detachedBounds.set(widget, win.getBounds()) }
  win.on('moved', save); win.on('resized', save)
  win.on('closed', () => { detached.delete(widget); if (desktop && !desktop.isDestroyed()) desktop.webContents.send('kitsunexus:widget-state', { widget, detached: false }) })
  detached.set(widget, win)
  desktop.webContents.send('kitsunexus:widget-state', { widget, detached: true })
  return { ok: true, detached: true }
}
ipcMain.handle('kitsunexus:detach-widget', toggleDetached)
function closeDetached () { for (const win of detached.values()) if (!win.isDestroyed()) win.close(); detached.clear() }

function showDesktop (options = {}) {
  if (desktop && !desktop.isDestroyed()) {
    desktop.showInactive()
    configureDesktop(options)
    registerRecovery()
    return
  }
  desktopOptions = normalise(options)
  desktop = create(desktopOptions, 'desktop')
  registerRecovery()
  const saveBounds = () => { if (desktop && !desktop.isDestroyed()) onBounds(desktop.getBounds()) }
  const recoverIfDisconnected = () => {
    if (!desktop || desktop.isDestroyed()) return
    const current = desktop.getBounds()
    const next = visibleBounds(current)
    if (current.x !== next.x || current.y !== next.y) desktop.setPosition(next.x, next.y)
  }
  screen.on('display-removed', recoverIfDisconnected)
  screen.on('display-metrics-changed', recoverIfDisconnected)
  desktop.on('moved', saveBounds)
  desktop.on('resized', saveBounds)
  desktop.on('closed', () => {
    closeDetached()
    screen.removeListener('display-removed', recoverIfDisconnected)
    screen.removeListener('display-metrics-changed', recoverIfDisconnected)
    desktop = null
    unregisterRecovery()
  })
}

function configureDesktop (options = {}) {
  if (!desktop || desktop.isDestroyed()) return
  desktopOptions = normalise({ ...desktopOptions, ...options })
  const cfg = desktopOptions
  desktop.setAlwaysOnTop(cfg.alwaysOnTop, 'screen-saver')
  desktop.setOpacity(cfg.opacity)
  desktop.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
  if (options.x !== undefined || options.y !== undefined || options.width !== undefined || options.height !== undefined) {
    const bounds = visibleBounds(cfg)
    desktop.setBounds({ x: bounds.x, y: bounds.y, width: cfg.width, height: cfg.height })
  }
  onOptions({ opacity: cfg.opacity, clickThrough: cfg.clickThrough, alwaysOnTop: cfg.alwaysOnTop })
}

function hideDesktop () {
  closeDetached()
  if (desktop && !desktop.isDestroyed()) desktop.close()
  desktop = null
  unregisterRecovery()
}

function getVrSurface () {
  if (!vr || vr.isDestroyed()) vr = create({ width: 640, height: 390 }, 'vr')
  return vr
}

function closeVrSurface () {
  if (vr && !vr.isDestroyed()) vr.destroy()
  vr = null
}

function broadcast (data) {
  if (!data || typeof data !== 'object') return
  lastData = { ...lastData, ...data }
  for (const win of [desktop, vr, ...detached.values()]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('kitsunexus:hud-data', lastData)
    }
  }
}

function setBoundsCallback (callback) { onBounds = typeof callback === 'function' ? callback : () => {} }

function setOptionsCallback (callback) { onOptions = typeof callback === 'function' ? callback : () => {} }

function state () {
  return {
    running: !!(desktop && !desktop.isDestroyed()),
    visible: !!(desktop && !desktop.isDestroyed() && desktop.isVisible()),
    recoveryHotkey: recoveryRegistered ? RECOVERY_HOTKEY : null,
    bounds: desktop && !desktop.isDestroyed() ? desktop.getBounds() : null,
    options: { opacity: desktopOptions.opacity, clickThrough: desktopOptions.clickThrough, alwaysOnTop: desktopOptions.alwaysOnTop }
  }
}

module.exports = { showDesktop, configureDesktop, hideDesktop, getVrSurface, closeVrSurface, broadcast, state, setBoundsCallback, setOptionsCallback }

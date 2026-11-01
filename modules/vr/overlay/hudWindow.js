'use strict'

const path = require('path')
const { BrowserWindow, screen } = require('electron')

const DEFAULTS = Object.freeze({ width: 400, height: 260, x: null, y: null, opacity: 0.94, clickThrough: false, alwaysOnTop: true })
let desktop = null
let vr = null
let onBounds = () => {}

function normalise (input = {}) {
  return {
    width: Math.max(280, Math.min(800, Number(input.width) || DEFAULTS.width)),
    height: Math.max(170, Math.min(650, Number(input.height) || DEFAULTS.height)),
    x: Number.isFinite(input.x) ? input.x : null,
    y: Number.isFinite(input.y) ? input.y : null,
    opacity: Math.max(0.25, Math.min(1, Number(input.opacity) || DEFAULTS.opacity)),
    clickThrough: !!input.clickThrough,
    alwaysOnTop: input.alwaysOnTop !== false
  }
}

function create (options, mode) {
  const cfg = normalise(options)
  const display = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: cfg.width,
    height: cfg.height,
    x: cfg.x == null ? display.x + display.width - cfg.width - 24 : cfg.x,
    y: cfg.y == null ? display.y + 32 : cfg.y,
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
  if (mode === 'desktop') {
    window.setOpacity(cfg.opacity)
    window.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
    window.once('ready-to-show', () => window.showInactive())
  } else {
    // Off-screen painted surface, no extra desktop window.
    window.webContents.setFrameRate?.(15)
  }
  return window
}

function showDesktop (options = {}) {
  if (desktop && !desktop.isDestroyed()) {
    desktop.showInactive()
    configureDesktop(options)
    return
  }
  desktop = create(options, 'desktop')
  const saveBounds = () => { if (desktop && !desktop.isDestroyed()) onBounds(desktop.getBounds()) }
  desktop.on('moved', saveBounds)
  desktop.on('resized', saveBounds)
  desktop.on('closed', () => { desktop = null })
}

function configureDesktop (options = {}) {
  if (!desktop || desktop.isDestroyed()) return
  const cfg = normalise(options)
  desktop.setAlwaysOnTop(cfg.alwaysOnTop, 'floating')
  desktop.setOpacity(cfg.opacity)
  desktop.setIgnoreMouseEvents(cfg.clickThrough, { forward: true })
}

function hideDesktop () {
  if (desktop && !desktop.isDestroyed()) desktop.close()
  desktop = null
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
  for (const win of [desktop, vr]) {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('kitsunexus:hud-data', data)
    }
  }
}

function setBoundsCallback (callback) { onBounds = typeof callback === 'function' ? callback : () => {} }

function state () {
  return {
    running: !!(desktop && !desktop.isDestroyed()),
    bounds: desktop && !desktop.isDestroyed() ? desktop.getBounds() : null
  }
}

module.exports = { showDesktop, configureDesktop, hideDesktop, getVrSurface, closeVrSurface, broadcast, state, setBoundsCallback }

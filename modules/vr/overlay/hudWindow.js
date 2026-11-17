'use strict'

const path = require('path')
const fs = require('fs')
const { BrowserWindow, screen, globalShortcut, ipcMain, app } = require('electron')

const DEFAULTS = Object.freeze({ width: 420, height: 540, x: null, y: null, opacity: 0.94, clickThrough: false, alwaysOnTop: true })
let desktop = null
let gamePoll = null
const rendererDiagnostics = new Map()
let diagnosticTimer = null
let gameReader = null
let gameBounds = null
let attaching = false
let anchor = { x: 20, y: 20 }
let alertsOnly = false
let hasAlerts = false
let alertHeight = 120
let expandedSize = null
let interacting = false
let interactionRegistered = false
const registeredInputHotkeys = new Set()
let focusTransitionUntil = 0
let lastInputError = ''
let attachmentError = ''
function windowHandle (window) {
  const handle = window.getNativeWindowHandle()
  return handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
}
const INTERACTION_HOTKEY = 'CommandOrControl+Shift+F9'
const widgetAnchors = new Map()
function inputMode (enabled, returnToGame = true) {
  if (!desktop || desktop.isDestroyed()) return false
  if (enabled) {
    syncGame(true)
    if (!gameBounds) { lastInputError = 'VRChat window unavailable or minimized'; return false }
    focusTransitionUntil = Date.now() + 1000
  }
  lastInputError = ''
  interacting = enabled
  for (const win of [desktop, ...detached.values()]) {
    if (win.isDestroyed()) continue
    win.setIgnoreMouseEvents(!enabled, { forward: true })
    win.setFocusable(enabled)
    win.webContents.send('kitsunexus:interaction', { enabled, hotkey: INTERACTION_HOTKEY })
  }
  if (enabled) {
    const bounds = desktop.getBounds()
    if (bounds.height < 420) { expandedSize = null; desktop.setBounds({ ...bounds, height: Math.min(540, gameBounds.height) }) }
    desktop.show(); desktop.focus()
  }
  else if (returnToGame) gameReader?.focusGame?.()
  return true
}
function syncGame (explicitOpen = false) {
  if (!desktop || desktop.isDestroyed()) return
  const windows = [desktop, ...detached.values()].filter(w => !w.isDestroyed())
  let area = null
  try {
    if (process.platform === 'win32') {
      if (!gameReader) gameReader = require('./gameWindow').createReader()
      const physical = gameReader(windows.map(windowHandle), explicitOpen)
      if (physical) area = screen.screenToDipRect(null, physical)
    }
  } catch (error) {
    if (attachmentError !== error.message) console.warn('[HUD] Attachment unavailable:', error.message)
    attachmentError = error.message
  }
  if (!area && interacting && Date.now() < focusTransitionUntil) area = gameBounds
  if (!area && interacting) inputMode(false, false)
  gameBounds = area
  for (const win of windows) {
    if (!area) { if (win.isVisible()) win.hide(); continue }
    const size = win.getBounds()
    const width = Math.min(size.width, area.width)
    if (win === desktop && alertsOnly && !interacting && !expandedSize) expandedSize = { width: size.width, height: size.height }
    const targetHeight = win === desktop && alertsOnly && !interacting ? alertHeight : win === desktop && expandedSize ? expandedSize.height : size.height
    const height = Math.min(targetHeight, area.height)
    if (win === desktop && (!alertsOnly || interacting) && expandedSize) expandedSize = null
    const offset = win === desktop ? anchor : widgetAnchors.get([...detached].find(([, value]) => value === win)?.[0]) || { x: 32, y: 48 }
    const x = area.x + Math.max(0, Math.min(offset.x, area.width - width))
    const y = area.y + Math.max(0, Math.min(offset.y, area.height - height))
    attaching = true
    try { if (size.x !== x || size.y !== y || size.width !== width || size.height !== height) win.setBounds({ x, y, width, height }) } finally { attaching = false }
    const isNotices = detached.get('alerts') === win
    const shouldShow = isNotices ? interacting || widgetAlertActive : win !== desktop || interacting || !alertsOnly || (hasAlerts && !detached.has('alerts'))
    if (shouldShow && !win.isVisible()) win.showInactive()
    if (!shouldShow && win.isVisible()) win.hide()
  }
}
function startGameTracking () {
  if (process.argv?.includes('--hud-diagnostics') && !diagnosticTimer) {
    diagnosticTimer = setInterval(() => {
      try { fs.writeFileSync(path.join(app.getPath('userData'), 'hud-diagnostics.json'), JSON.stringify({ at: Date.now(), feeds: feedOptions, collection: collectionState(), musicPresent: !!lastData.music && lastData.music !== 'No track', activitySequence: lastData.activitySequence, windows: [...detached].map(([widget, win]) => ({ widget, visible: win.isVisible(), bounds: win.getBounds() })), renderers: [...rendererDiagnostics.values()] }, null, 2)) } catch (_) {}
    }, 2000)
    diagnosticTimer.unref?.()
  }
  if (!gamePoll) gamePoll = setInterval(syncGame, 150)
  gamePoll.unref?.()
  syncGame()
}
function stopGameTracking () { if (diagnosticTimer) clearInterval(diagnosticTimer); diagnosticTimer = null; if (gamePoll) clearInterval(gamePoll); gamePoll = null; gameReader = null; gameBounds = null }

let vr = null
const detached = new Map()
const detachable = new Set(['players', 'alerts', 'tiles', 'lyrics', 'music', 'heart'])
let widgetAlertActive = false
let feedRevision = 0
let feedOptions = { live: true, players: true, music: true, heart: true }
const detachedBounds = new Map()
const detachedOpen = new Set()
let restored = false
function geometryPath () { return path.join(app.getPath('userData'), 'desktop-hud-widgets.json') }
function persistWidgets () {
  try {
    fs.mkdirSync(path.dirname(geometryPath()), { recursive: true })
    fs.writeFileSync(geometryPath(), JSON.stringify({ version: 1, bounds: Object.fromEntries(detachedBounds), open: [...detachedOpen], anchor, widgetAnchors: Object.fromEntries(widgetAnchors), feedOptions }))
  } catch (error) { console.warn('[Desktop HUD] Widget settings could not be saved:', error.message) }
}
function restoreWidgets () {
  if (restored) return
  restored = true
  try {
    const saved = JSON.parse(fs.readFileSync(geometryPath(), 'utf8'))
    if (saved.version !== 1) return
    for (const key of Object.keys(feedOptions)) if (typeof saved.feedOptions?.[key] === 'boolean') feedOptions[key] = saved.feedOptions[key]
    if (Number.isFinite(saved.anchor?.x) && Number.isFinite(saved.anchor?.y)) anchor = { x: saved.anchor.x, y: saved.anchor.y }
    for (const widget of detachable) {
      const offset = saved.widgetAnchors?.[widget]
      if (Number.isFinite(offset?.x) && Number.isFinite(offset?.y)) widgetAnchors.set(widget, offset)
      const bounds = saved.bounds?.[widget]
      if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width >= 200 && bounds.height >= 100) detachedBounds.set(widget, bounds)
      if (saved.open?.includes(widget)) detachedOpen.add(widget)
    }
  } catch (_) {}
}
let onBounds = () => {}
let lastData = {}
let desktopOptions = { ...DEFAULTS }
let onOptions = () => {}
const RECOVERY_HOTKEY = 'CommandOrControl+Shift+F10'
let recoveryRegistered = false
function recoverDesktop () {
  if (!desktop || desktop.isDestroyed()) return
  anchor = { x: 20, y: 20 }; persistWidgets()
  const area = screen.getPrimaryDisplay().workArea
  desktop.setIgnoreMouseEvents(false)
  desktop.setOpacity(1)
  desktop.setAlwaysOnTop(true, 'screen-saver')
  const bounds = desktop.getBounds()
  desktop.setBounds({ x: area.x + 24, y: area.y + 32, width: Math.min(bounds.width, area.width), height: Math.min(bounds.height, area.height) })
  syncGame()
  inputMode(true)
  desktopOptions = normalise({ ...desktopOptions, clickThrough: false, opacity: 1, alwaysOnTop: true })
  onOptions({ opacity: 1, clickThrough: false, alwaysOnTop: true })
}
function registerRecovery () {
  for (const key of [INTERACTION_HOTKEY, 'CommandOrControl+Alt+F9']) {
    if (registeredInputHotkeys.has(key)) continue
    try {
      if (globalShortcut.register(key, () => inputMode(!interacting))) registeredInputHotkeys.add(key)
      else console.warn('[HUD] Shortcut unavailable:', key)
    } catch (error) { console.warn('[HUD] Shortcut registration failed:', key, error.message) }
  }
  interactionRegistered = registeredInputHotkeys.has(INTERACTION_HOTKEY)
  if (recoveryRegistered) return
  try { recoveryRegistered = globalShortcut.register(RECOVERY_HOTKEY, recoverDesktop) } catch (_) { recoveryRegistered = false }
}
function unregisterRecovery () {
  for (const key of registeredInputHotkeys) globalShortcut.unregister(key)
  registeredInputHotkeys.clear()
  interactionRegistered = false
  interacting = false
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
    // Layered transparent windows can render invisible with software compositing.
    transparent: mode === 'vr',
    resizable: mode === 'desktop',
    focusable: mode !== 'desktop',
    skipTaskbar: true,
    show: false,
    alwaysOnTop: mode === 'desktop' && cfg.alwaysOnTop,
    backgroundColor: mode === 'desktop' ? '#151126' : '#00000000',
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
  window.loadFile(path.join(__dirname, 'hud.html'), { query: { mode, diagnostics: process.argv?.includes('--hud-diagnostics') ? '1' : '0' } })
  window.webContents.on('did-finish-load', () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('kitsunexus:hud-data', lastData)
    if (mode === 'desktop') {
      window.webContents.send('kitsunexus:interaction', { enabled: interacting, hotkey: INTERACTION_HOTKEY })
      for (const widget of detached.keys()) window.webContents.send('kitsunexus:widget-state', { widget, detached: true })
    }
  })
  if (mode === 'desktop') {
    window.setOpacity(cfg.opacity)
    window.setIgnoreMouseEvents(true, { forward: true })
    // Transparent windows may never emit ready-to-show on some GPU/driver setups.
    let shown = false
    const reveal = () => {
      if (shown || window.isDestroyed()) return
      shown = true
      syncGame()
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
  if (!desktop || desktop.isDestroyed() || !detachable.has(widget) || (event.sender !== desktop.webContents && detached.get(widget)?.webContents !== event.sender)) return { ok: false }
  const existing = detached.get(widget)
  if (existing && !existing.isDestroyed()) { detachedOpen.delete(widget); persistWidgets(); existing.close(); return { ok: true, detached: false } }
  const area = screen.getPrimaryDisplay().workArea
  const saved = detachedBounds.get(widget)
  if (!widgetAnchors.has(widget)) { const index = [...detachable].indexOf(widget); widgetAnchors.set(widget, { x: 60 + index * 36, y: 80 + index * 36 }) }
  const cfg = { width: 340, height: widget === 'tiles' ? 260 : 180, x: saved?.x ?? area.x + 80, y: saved?.y ?? area.y + 80 }
  const bounds = visibleBounds({ ...cfg, width: saved?.width || cfg.width, height: saved?.height || cfg.height })
  const win = new BrowserWindow({ width: saved?.width || cfg.width, height: saved?.height || cfg.height, x: bounds.x, y: bounds.y, frame: false, transparent: false, resizable: true, alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#151126', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'hudPreload.js'), backgroundThrottling: false } })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'hud.html'), { query: { mode: 'desktop', widget, diagnostics: process.argv?.includes('--hud-diagnostics') ? '1' : '0' } })
  win.webContents.on('did-finish-load', () => { if (!win.isDestroyed()) { win.webContents.send('kitsunexus:hud-data', lastData); win.webContents.send('kitsunexus:interaction', { enabled: interacting, hotkey: INTERACTION_HOTKEY }); syncGame() } })
  win.webContents.on('did-fail-load', (_event, code, reason) => console.error('[Desktop HUD] Pop-out failed:', widget, code, reason))
  win.setIgnoreMouseEvents(!interacting, { forward: true }); win.setFocusable(interacting)
  win.on('will-move', (_event, bounds) => { if (gameBounds && interacting) widgetAnchors.set(widget, { x: bounds.x - gameBounds.x, y: bounds.y - gameBounds.y }) })
  const save = () => { if (!win.isDestroyed() && !attaching) { detachedBounds.set(widget, win.getBounds()); persistWidgets() } }
  win.on('moved', save); win.on('resized', save)
  win.on('closed', () => { if (!closingDetached) { detachedOpen.delete(widget); persistWidgets() } detached.delete(widget); if (desktop && !desktop.isDestroyed()) desktop.webContents.send('kitsunexus:widget-state', { widget, detached: false }) })
  detached.set(widget, win)
  detachedOpen.add(widget)
  persistWidgets()
  desktop.webContents.send('kitsunexus:widget-state', { widget, detached: true })
  return { ok: true, detached: true }
}
ipcMain.handle('kitsunexus:detach-widget', toggleDetached)
ipcMain.handle('kitsunexus:hud-input', (event, request = {}) => {
  if (!ownsSender(event.sender)) return { ok: false }
  if (request.op === 'diagnostics') {
    rendererDiagnostics.set(event.sender.id || request.widget, { widget: String(request.widget).slice(0, 20), live: request.live === true, paused: request.paused === true, sequence: Number(request.sequence) || 0, notices: Number(request.notices) || 0, receivedMusic: request.receivedMusic === true, musicVisible: request.musicVisible === true })
    return { ok: true }
  }
  if (request.op === 'presentation' && detached.get('alerts')?.webContents === event.sender) { widgetAlertActive = request.hasAlerts === true; syncGame(); return { ok: true } }
  if (request.op === 'presentation' && desktop?.webContents === event.sender) {
    alertsOnly = request.alertsOnly === true; hasAlerts = request.hasAlerts === true
    alertHeight = Math.max(80, Math.min(500, Number(request.height) || 120))
    syncGame(); return { ok: true }
  }
  if (request.op === 'resetPositions' && desktop?.webContents === event.sender && interacting) {
    anchor = { x: 20, y: 20 }
    for (const [index, widget] of [...detachable].entries()) widgetAnchors.set(widget, { x: 60 + index * 36, y: 80 + index * 36 })
    persistWidgets(); syncGame(); return { ok: true }
  }
  if (request.op === 'feeds' && desktop?.webContents === event.sender) {
    let changed = false
    for (const key of Object.keys(feedOptions)) if (typeof request[key] === 'boolean' && feedOptions[key] !== request[key]) { feedOptions[key] = request[key]; changed = true }
    if (changed) feedRevision++
    if (!feedOptions.live || !feedOptions.music) lastData.music = 'Music feed paused'
    if (!feedOptions.live || !feedOptions.heart) lastData.heart = 'Heart feed paused'
    if (!feedOptions.live || !feedOptions.players) lastData.players = []
    persistWidgets(); broadcast({}); return { ok: true }
  }
  if (request.op === 'play') return { ok: inputMode(false) }
  if (request.op === 'dock' && gameBounds && interacting) {
    const size = desktop.getBounds()
    const right = Math.max(0, gameBounds.width - size.width - 20)
    const bottom = Math.max(0, gameBounds.height - size.height - 20)
    const positions = { 'top-left': { x: 20, y: 20 }, 'top-right': { x: right, y: 20 }, 'bottom-left': { x: 20, y: bottom }, 'bottom-right': { x: right, y: bottom } }
    if (!positions[request.corner]) return { ok: false }
    anchor = positions[request.corner]; persistWidgets(); syncGame(); return { ok: true }
  }
  return { ok: false }
})
let closingDetached = false
function closeDetached () {
  closingDetached = true
  for (const win of detached.values()) if (!win.isDestroyed()) win.close()
  detached.clear()
  closingDetached = false
}

function showDesktop (options = {}) {
  if (desktop && !desktop.isDestroyed()) {
    syncGame()
    configureDesktop(options)
    registerRecovery()
    return
  }
  desktopOptions = normalise(options)
  restoreWidgets()
  desktop = create(desktopOptions, 'desktop')
  startGameTracking()
  for (const widget of [...detachedOpen]) {
    try { toggleDetached({ sender: desktop.webContents }, widget) } catch (error) { console.warn('[Desktop HUD] Could not restore widget:', widget, error.message) }
  }
  registerRecovery()
  const saveBounds = () => {
    if (!desktop || desktop.isDestroyed() || attaching || (alertsOnly && !interacting)) return
    const bounds = desktop.getBounds()
    if (gameBounds) { anchor = { x: bounds.x - gameBounds.x, y: bounds.y - gameBounds.y }; persistWidgets() }
    onBounds(bounds)
  }
  const recoverIfDisconnected = () => {
    if (!desktop || desktop.isDestroyed()) return
    const current = desktop.getBounds()
    const next = visibleBounds(current)
    if (current.x !== next.x || current.y !== next.y) desktop.setPosition(next.x, next.y)
  }
  screen.on('display-removed', recoverIfDisconnected)
  screen.on('display-metrics-changed', recoverIfDisconnected)
  desktop.on('will-move', (_event, bounds) => { if (gameBounds && interacting) anchor = { x: bounds.x - gameBounds.x, y: bounds.y - gameBounds.y } })
  desktop.on('moved', saveBounds)
  desktop.on('resized', saveBounds)
  desktop.on('closed', () => {
    closeDetached()
    screen.removeListener('display-removed', recoverIfDisconnected)
    screen.removeListener('display-metrics-changed', recoverIfDisconnected)
    stopGameTracking()
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
  desktop.setIgnoreMouseEvents(!interacting, { forward: true })
  if (options.x !== undefined || options.y !== undefined || options.width !== undefined || options.height !== undefined) {
    const bounds = visibleBounds(cfg)
    desktop.setBounds({ x: bounds.x, y: bounds.y, width: cfg.width, height: cfg.height })
  }
  onOptions({ opacity: cfg.opacity, clickThrough: cfg.clickThrough, alwaysOnTop: cfg.alwaysOnTop })
}

function hideDesktop () {
  stopGameTracking()
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
  data = { ...data }
  if (!feedOptions.live || !feedOptions.music) delete data.music
  if (!feedOptions.live || !feedOptions.heart) delete data.heart
  if (!feedOptions.live || !feedOptions.players) delete data.players
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
    interactionHotkey: interactionRegistered ? INTERACTION_HOTKEY : null,
    interactionHotkeys: [...registeredInputHotkeys],
    inputError: lastInputError || attachmentError,
    interacting,
    recoveryHotkey: recoveryRegistered ? RECOVERY_HOTKEY : null,
    bounds: desktop && !desktop.isDestroyed() ? desktop.getBounds() : null,
    options: { opacity: desktopOptions.opacity, clickThrough: desktopOptions.clickThrough, alwaysOnTop: desktopOptions.alwaysOnTop }
  }
}

function ownsSender (sender) {
  return !!sender && [desktop, vr, ...detached.values()].some(window => window && !window.isDestroyed() && window.webContents === sender)
}
function openWidgets (names) {
  if (!desktop || desktop.isDestroyed() || !Array.isArray(names)) return
  for (const name of new Set(names.slice(0, 6))) if (detachable.has(name) && !detached.has(name)) toggleDetached({ sender: desktop.webContents }, name)
}
function collectionState () { return { music: !!desktop && feedOptions.live && feedOptions.music, revision: feedRevision } }
module.exports = { openWidgets, collectionState, openEditor: () => inputMode(true), ownsSender, showDesktop, configureDesktop, hideDesktop, getVrSurface, closeVrSurface, broadcast, state, setBoundsCallback, setOptionsCallback }

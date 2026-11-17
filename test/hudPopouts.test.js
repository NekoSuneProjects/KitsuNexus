'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
function load (dir) {
  const windows = []; const handlers = {}
  class Window extends EventEmitter {
    constructor (options) { super(); this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }; this.visible = false; this.webContents = new EventEmitter(); this.webContents.sent = []; this.webContents.send = (...args) => this.webContents.sent.push(args); this.webContents.isDestroyed = () => false; windows.push(this) }
    isDestroyed () { return !!this.destroyed }
    getBounds () { return { ...this.bounds } }
    setBounds (bounds) { this.bounds = { ...bounds } }
    setMenuBarVisibility () {}
    loadFile (_file, { query }) { this.query = query }
    setOpacity () {}
    setIgnoreMouseEvents () {}
    setFocusable () {}
    setAlwaysOnTop () {}
    getNativeWindowHandle () { return Buffer.alloc(8) }
    isVisible () { return this.visible }
    showInactive () { this.visible = true }
    show () { this.visible = true }
    focus () {}
    hide () { this.visible = false }
    close () { this.destroyed = true; this.emit('closed') }
  }
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const screen = new EventEmitter(); screen.getPrimaryDisplay = () => ({ workArea: area }); screen.getAllDisplays = () => [{ workArea: area }]; screen.screenToDipRect = (_, bounds) => bounds
  const electron = { BrowserWindow: Window, screen, app: { getPath: () => dir }, globalShortcut: { register: () => true, unregister () {} }, ipcMain: { handle: (key, handler) => { handlers[key] = handler } } }
  const context = { module: { exports: {} }, process: { platform: 'win32' }, Buffer, console, __dirname: dir, setInterval: () => ({ unref () {} }), clearInterval () {}, setTimeout: () => ({ unref () {} }), require: name => name === 'electron' ? electron : name === './gameWindow' ? { createReader: () => () => area } : require(name) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/vr/overlay/hudWindow.js'), 'utf8'), context)
  return { api: context.module.exports, windows, handlers }
}
test('music and heart popouts restore geometry and feed collection honors persisted disable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsu-popouts-'))
  try {
    let app = load(dir); app.api.showDesktop()
    const main = app.windows[0]
    for (const widget of ['music', 'heart']) assert.equal(app.handlers['kitsunexus:detach-widget']({ sender: main.webContents }, widget).ok, true)
    const music = app.windows.find(w => w.query.widget === 'music')
    music.emit('will-move', {}, { ...music.bounds, x: 530, y: 90 }); music.bounds = { x: 530, y: 90, width: 410, height: 220 }; music.emit('resized')
    app.handlers['kitsunexus:hud-input']({ sender: main.webContents }, { op: 'feeds', music: false })
    assert.equal(app.api.collectionState().music, false)
    app.api.hideDesktop()
    app = load(dir); app.api.showDesktop()
    const restored = app.windows.find(w => w.query.widget === 'music')
    assert.ok(restored); assert.equal(restored.bounds.width, 410); assert.equal(restored.bounds.height, 220); assert.equal(restored.bounds.x, 530)
    assert.ok(app.windows.find(w => w.query.widget === 'heart'))
    assert.equal(app.api.collectionState().music, false)
    app.api.hideDesktop()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('independent notices window hides between alerts and rejects untrusted feed changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsu-notices-'))
  try {
    const app = load(dir); app.api.showDesktop(); const main = app.windows[0]
    app.handlers['kitsunexus:detach-widget']({ sender: main.webContents }, 'alerts')
    const notices = app.windows[1]; notices.webContents.emit('did-finish-load')
    assert.equal(notices.visible, false)
    const handler = app.handlers['kitsunexus:hud-input']
    handler({ sender: notices.webContents }, { op: 'presentation', hasAlerts: true }); assert.equal(notices.visible, true)
    handler({ sender: main.webContents }, { op: 'presentation', alertsOnly: true, hasAlerts: true })
    assert.equal(main.visible, false, 'Detached alerts must not leave an empty duplicate main HUD')
    handler({ sender: notices.webContents }, { op: 'presentation', hasAlerts: false }); assert.equal(notices.visible, false)
    assert.equal(handler({ sender: {} }, { op: 'feeds', music: false }).ok, false)
    app.api.hideDesktop()
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

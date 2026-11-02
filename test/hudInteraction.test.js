'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
function setup () {
  const handlers = {}; let focusedGame = false
  const win = { bounds: { x: 20, y: 20, width: 420, height: 540 }, visible: true, isDestroyed: () => false,
    getBounds () { return { ...this.bounds } }, setBounds (b) { this.bounds = b },
    getNativeWindowHandle: () => Buffer.alloc(8), webContents: { send () {} },
    isVisible () { return this.visible }, hide () { this.visible = false }, showInactive () { this.visible = true }, show () { this.visible = true }, focus () { this.focused = true },
    setFocusable (v) { this.focusable = v }, setIgnoreMouseEvents (v) { this.passthrough = v }
  }
  const reader = () => ({ x: 0, y: 0, width: 1920, height: 1080 }); reader.focusGame = () => { focusedGame = true }
  const electron = { screen: { screenToDipRect: (_, r) => r }, ipcMain: { handle: (name, fn) => { handlers[name] = fn } } }
  const context = { module: { exports: {} }, Buffer, process: { platform: 'win32' }, console,
    require: name => name === 'electron' ? electron : require(name) }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/vr/overlay/hudWindow.js'), 'utf8') + '\nmodule.exports.testSetup = (win, reader) => { desktop = win; gameReader = reader }; module.exports.testInput = inputMode; module.exports.testSetReader = r => { gameReader = r }; module.exports.testSync = syncGame;', context)
  const api = context.module.exports; api.testSetup(win, reader)
  return { api, win, handlers, focusedGame: () => focusedGame }
}
test('HUD shortcut mode allows interaction and returns input to the game', () => {
  const { api, win, focusedGame } = setup()
  assert.equal(api.testInput(true), true)
  assert.equal(win.passthrough, false); assert.equal(win.focusable, true); assert.equal(win.focused, true)
  api.testInput(false)
  assert.equal(win.passthrough, true); assert.equal(win.focusable, false); assert.equal(focusedGame(), true)
})
test('alerts-only hides empty overlay and edit mode restores it', () => {
  const { api, win, handlers } = setup()
  handlers['kitsunexus:hud-input']({ sender: win.webContents }, { op: 'presentation', alertsOnly: true, hasAlerts: false })
  assert.equal(win.visible, false)
  api.testInput(true); assert.equal(win.visible, true)
  api.testInput(false); api.testSync(); assert.equal(win.visible, false)
  handlers['kitsunexus:hud-input']({ sender: win.webContents }, { op: 'presentation', alertsOnly: true, hasAlerts: true, height: 150 })
  assert.equal(win.visible, true); assert.equal(win.bounds.height, 150)
})

test('explicit editor opening survives transient focus loss and restores full-size controls', () => {
  const { api, win } = setup()
  const reader = (_handles, explicit) => explicit ? { x: 0, y: 0, width: 1920, height: 1080 } : null
  api.testSetReader(reader)
  win.bounds.height = 90
  assert.equal(api.testInput(true), true)
  api.testSync()
  assert.equal(win.visible, true)
  assert.equal(win.passthrough, false)
  assert.ok(win.bounds.height >= 420)
})

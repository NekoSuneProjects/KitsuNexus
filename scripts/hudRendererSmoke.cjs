'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsu-hud-renderer-'))
app.setPath('userData', path.join(output, 'profile'))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
ipcMain.handle('kitsunexus:hud-input', () => ({ ok: true }))
ipcMain.handle('hud:history', () => ({ ok: true, events: [], retentionDays: 30 }))
ipcMain.handle('kitsunexus:detach-widget', () => ({ ok: true, detached: false }))
ipcMain.handle('hud:action', () => ({ ok: true }))
app.whenReady().then(async () => {
  let window
  try {
    for (const widget of ['music', 'heart', 'alerts']) {
      window = new BrowserWindow({ width: 420, height: 300, show: false, webPreferences: { preload: path.join(root, 'modules/vr/overlay/hudPreload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } })
      const errors = []
      window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
      await window.loadFile(path.join(root, 'modules/vr/overlay/hud.html'), { query: { mode: 'desktop', widget } })
      window.webContents.send('kitsunexus:hud-data', { activitySequence: 0, activityEvents: [], players: ['Test player'], music: 'Test artist — Test song', heart: '72 BPM' })
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 50))')
      window.webContents.send('kitsunexus:hud-data', { activitySequence: 3, activityEvents: [{ id: 1, at: Date.now(), kind: 'join', name: 'Test join' }, { id: 2, at: Date.now(), kind: 'leave', name: 'Test leave' }, { id: 3, at: Date.now(), kind: 'avatar', name: 'Test avatar', detail: 'Changed avatar' }] })
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 50))')
      const result = await window.webContents.executeJavaScript(`(() => {
        const id = ${JSON.stringify(widget === 'alerts' ? 'alerts' : widget)}
        const element = document.getElementById(id)
        const ancestry = []
        for (let current = element; current; current = current.parentElement) ancestry.push({ tag: current.tagName, widget: current.dataset.widget, hidden: current.hidden, display: getComputedStyle(current).display, height: current.getBoundingClientRect().height })
        return { text: element.textContent, cards: document.querySelectorAll('.activity-notice').length, ancestry }
      })()`)
      console.log(JSON.stringify({ widget, errors, result }))
      fs.writeFileSync(path.join(output, widget + '.json'), JSON.stringify({ widget, errors, result }, null, 2))
      fs.writeFileSync(path.join(output, widget + '.png'), (await window.webContents.capturePage()).toPNG())
      assert.equal(errors.length, 0, 'Renderer errors')
      assert.ok(result.ancestry.every(item => item.display !== 'none' && item.height > 0), widget + ' content is hidden')
      if (widget === 'music') assert.match(result.text, /Test song/)
      if (widget === 'heart') assert.match(result.text, /72 BPM/)
      if (widget === 'alerts') {
        assert.equal(result.cards, 3)
        const expired = await window.webContents.executeJavaScript(`(() => { const now = Date.now(); Date.now = () => now + 200000; renderNotices(); return document.querySelectorAll('.activity-notice').length })()`)
        assert.equal(expired, 0, 'Old alerts must expire')
        window.webContents.send('kitsunexus:hud-data', { activitySequence: 4, activityEvents: [{ id: 4, at: Date.now() + 200000, kind: 'join', name: 'New arrival' }] })
        const next = await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(() => resolve(document.querySelectorAll(".activity-notice").length), 50))')
        assert.equal(next, 1, 'New alerts must appear after idle expiry')
      }
      window.destroy(); window = null
    }
    console.log('PASS: renderer content and event cards. Artifacts: ' + output)
    app.exit(0)
  } catch (error) { console.error(error.stack); console.error('Artifacts: ' + output); if (window) window.destroy(); app.exit(1) }
})

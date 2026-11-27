'use strict'
const { contextBridge, ipcRenderer } = require('electron')
// The HUD shows the same corrected local time as the main window (see
// modules/time/clockSync.js): Windows' real offset + the 2026 tz rule fixes.
// A sandboxed preload can't require local files; then hud.js falls back to
// plain Intl formatting instead of the whole HUD bridge failing to load.
let clockSync = null
try { clockSync = require('../../time/clockSync') } catch (_) {}
if (clockSync) {
  ipcRenderer.on('time:osClock', (_event, info) => clockSync.setOsClock(info))
  ipcRenderer.on('time:override', (_event, tz) => clockSync.setOverrideTimeZone(tz))
  ipcRenderer.invoke('time:osClock').then(info => { if (info) clockSync.setOsClock(info) }).catch(() => {})
  ipcRenderer.invoke('getSetting', 'clock.overrideTimeZone', '').then(tz => clockSync.setOverrideTimeZone(tz)).catch(() => {})
}
contextBridge.exposeInMainWorld('kitsunexusHud', {
  formatTime: clockSync ? (ms, opts) => clockSync.formatTime(new Date(Number(ms) || Date.now()), opts || { hour: '2-digit', minute: '2-digit' }) : null,
  formatDateTime: clockSync ? ms => clockSync.formatDateTime(new Date(Number(ms) || Date.now())) : null,
  input: request => ipcRenderer.invoke('kitsunexus:hud-input', request),
  onInteraction: callback => { if (typeof callback === 'function') ipcRenderer.on('kitsunexus:interaction', (_event, state) => callback(state)) },
  action: payload => ipcRenderer.invoke('hud:action', payload),
  history: request => ipcRenderer.invoke('hud:history', request),
  toggleWidget: widget => ipcRenderer.invoke('kitsunexus:detach-widget', widget),
  onWidgetState: callback => { if (typeof callback === 'function') ipcRenderer.on('kitsunexus:widget-state', (_event, state) => callback(state)) },
  onData: callback => {
    if (typeof callback === 'function') ipcRenderer.on('kitsunexus:hud-data', (_event, data) => callback(data))
  }
})

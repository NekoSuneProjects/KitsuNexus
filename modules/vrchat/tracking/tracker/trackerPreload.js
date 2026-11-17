'use strict'
// Preload for the hidden camera tracker window: a narrow bridge, nothing else.
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('knTracker', {
  onStart: cb => ipcRenderer.on('tracker:start', (_e, cfg) => cb(cfg)),
  onStop: cb => ipcRenderer.on('tracker:stop', () => cb()),
  onUpdate: cb => ipcRenderer.on('tracker:update', (_e, cfg) => cb(cfg)),
  frame: f => ipcRenderer.send('tracker:frame', f),
  status: s => ipcRenderer.send('tracker:status', s),
  preview: p => ipcRenderer.send('tracker:preview', p),
  ready: () => ipcRenderer.send('tracker:ready')
})

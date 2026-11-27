'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('translateOverlay', {
  onLabels: callback => { if (typeof callback === 'function') ipcRenderer.on('translate-overlay:labels', (_e, data) => callback(data)) }
})

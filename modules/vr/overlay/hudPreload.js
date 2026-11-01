'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kitsunexusHud', {
  onData: callback => {
    if (typeof callback === 'function') ipcRenderer.on('kitsunexus:hud-data', (_event, data) => callback(data))
  }
})

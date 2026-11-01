'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kitsunexusHud', {
  action: payload => ipcRenderer.invoke('hud:action', payload),
  onData: callback => {
    if (typeof callback === 'function') ipcRenderer.on('kitsunexus:hud-data', (_event, data) => callback(data))
  }
})

'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kitsunexusHud', {
  action: payload => ipcRenderer.invoke('hud:action', payload),
  toggleWidget: widget => ipcRenderer.invoke('kitsunexus:detach-widget', widget),
  onWidgetState: callback => { if (typeof callback === 'function') ipcRenderer.on('kitsunexus:widget-state', (_event, state) => callback(state)) },
  onData: callback => {
    if (typeof callback === 'function') ipcRenderer.on('kitsunexus:hud-data', (_event, data) => callback(data))
  }
})

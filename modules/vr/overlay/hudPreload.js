'use strict'
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kitsunexusHud', {
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

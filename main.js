const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog, clipboard, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFile } = require('child_process')
const axios = require('axios')
const settings = require('./settings')

// ffmpeg-static's own path points inside app.asar when packaged, which can't
// be executed directly - asarUnpack (package.json build config) places the
// real binary alongside it under app.asar.unpacked, so redirect there.
// Resolved lazily (not at module load) since app.isPackaged isn't safe to
// read before Electron has fully initialized the main process.
function getFfmpegBinPath () {
  const p = require('ffmpeg-static')
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}

const { getNowPlaying, setPreferredSource, getPreferredSource, getSources } = require('./modules/media/nowPlaying')
const {
  setMediaProvider,
  updateOverlaySettings,
  getOverlayState
} = require('./modules/overlay/overlayServer')

const { startComponentStats, stopComponentStats } = require('./modules/stats/componentStats')
const { startNetworkStats, stopNetworkStats } = require('./modules/stats/networkStats')
const { startPulsoid, stopPulsoid } = require('./modules/heartrate/providers/pulsoid/client')
const { startHyperate, stopHyperate } = require('./modules/heartrate/providers/hyperate/client')
const { startDeviceBridge, stopDeviceBridge, submitDeviceBpm } = require('./modules/heartrate/devices/bridge')
const pulsoidOAuth = require('./modules/heartrate/providers/pulsoid/oauth')
const hrAnalytics = require('./modules/heartrate/core/analytics')
const hrOsc = require('./modules/heartrate/osc/profiles')
const { startWindowActivity, stopWindowActivity } = require('./modules/activity/windowActivity')
const { startAfk, stopAfk } = require('./modules/activity/afkModule')
const { connectTikTok, disconnectTikTok, startTikTokFollowers, stopTikTokFollowers } = require('./modules/live/tiktokModule')
const { startTwitch, stopTwitch } = require('./modules/live/twitch/followers')
const { startKick, stopKick } = require('./modules/live/kickModule')
const { getTikTokTtsAudio, TIKTOK_VOICES } = require('./modules/live/tiktokTts')
const { intelliRewrite, AI_PROVIDERS } = require('./modules/ai/intelliChat')
const { translateText, TRANSLATE_PROVIDERS } = require('./modules/ai/translateProviders')
const { speak, listSapiVoices, TTS_PROVIDERS } = require('./modules/ai/ttsProviders')
const { transcribeCloud, transcribeLocal, configureModelsDir, STT_CLOUD_PROVIDERS, STT_LOCAL_MODELS } = require('./modules/ai/speechToText')
const { interpretCommand, summarizeSearchResults } = require('./modules/ai/assistantBrain')
const { searchWeb } = require('./modules/ai/webSearch')
const i18n = require('./modules/i18n/i18n')
const { loginTwitch, TWITCH_REDIRECT } = require('./modules/oauth/providers/twitch')
const { loginDiscordIdentity } = require('./modules/oauth/providers/discordIdentity')
const twitchInteractive = require('./modules/live/twitch/interactive')
const { startDiscord, stopDiscord, updateActivity, setVrcContext, setExtraOscTargets: setDiscordExtraOscTargets, getVrcContextSnapshot } = require('./modules/integrations/discord/discord')
const { startStatusPush, stopStatusPush } = require('./modules/integrations/discord/statusPush')
// Fixed NekoSuneAPPS Discord Rich Presence Application ID — must match
// DEFAULT_DISCORD_APP_ID in renderer.js. Not user-editable.
const DISCORD_APP_ID = '1534208250046578790'
// NekoSuneAPPS backend (feature/discord-backend-server, deployed separately)
// for the Discord Activity panel + official shared bot — holds the bot
// token/OAuth secret, never this app. Defaults to the official NekoSuneVR
// deployment, but — unlike DISCORD_APP_ID — users may point this at their own
// self-hosted instance instead (see #nekosuneBackendUrl in index.html), since
// a self-hoster runs their own backend with their own bot/OAuth app entirely;
// nothing here needs to match DISCORD_APP_ID for that to work.
const DEFAULT_NEKOSUNE_BACKEND_URL = 'https://nekosuneappsvrc.nekosunevr.co.uk'
function getNekosuneBackendUrl () {
  return String(settings.get('nekosuneBackendUrl', '') || '').trim() || DEFAULT_NEKOSUNE_BACKEND_URL
}
const { startVrcWorld, stopVrcWorld, getVrcWorld } = require('./modules/vrchat/world/vrchatWorld')
const { startVrBattery, stopVrBattery } = require('./modules/vrchat/vr/vrBattery')
const vrchatApi = require('./modules/vrchat/api/vrchatApi')
const { startWeather, stopWeather, getWeather } = require('./modules/weather/weatherModule')
const {
  startBot, stopBot, setMute: botSetMute, setDeaf: botSetDeaf, inviteUrl,
  startOfficialBot, stopOfficialBot, setMuteOfficial, setDeafOfficial
} = require('./modules/integrations/discord/discordBot')
const soundpad = require('./modules/integrations/media/soundpadModule')
const { pressMediaKey } = require('./modules/vrchat/osc/mediaKeys')
const keyHookPs = require('./modules/vrchat/osc/keyHookPs')
const { vkName } = require('./modules/vrchat/osc/vkCodes')
const vrcTools = require('./modules/vrchat/tools/vrcTools')
const screenshotMetadata = require('./modules/vrchat/tools/screenshotMetadata')
const pawprints = require('./modules/vrchat/tools/pawprints')
const gamelog = require('./modules/history/gamelog')
const photoRelay = require('./modules/integrations/media/photoRelay')
const avatarDb = require('./modules/vrchat/avatars/avatarDb')
const crashGuard = require('./modules/vrchat/tools/crashGuard')
const quickLaunch = require('./modules/vrchat/launcher/quickLaunch')
const vrOverlay = require('./modules/vr/overlay/vrOverlayController')
const { startTon, stopTon, getTonState, getTonRaw } = require('./modules/integrations/ton/tonModule')
const tonOsc = require('./modules/integrations/ton/tonOsc')
const osc = require('./modules/vrchat/osc/oscModule')
const tonData = require('./modules/integrations/ton/tonData')
const tonSaveCodec = require('./modules/integrations/ton/tonSaveCodec')
const tonUnlockDecoder = require('./modules/integrations/ton/tonUnlockDecoder')
const { startTonLog, stopTonLog } = require('./modules/integrations/ton/tonLogReader')
const updater = require('./modules/integrations/maintenance/updater')
const tonManager = require('./modules/integrations/ton/tonManager')
const vrNotify = require('./modules/integrations/maintenance/vrNotify')
const ranks = require('./modules/ranks')
const avatarLocker = require('./modules/avatarlocker/avatarLockerModule')
const ruskLaserdome = require('./modules/integrations/osc/laserdome/ruskLaserdome')
const { recognizeAudio, getProviderStatus } = require('./modules/integrations/osc/recognition/songRecognition')

// Keep a stray error in any poller/network module from hard-crashing the app.
process.on('uncaughtException', err => console.error('[uncaughtException]', err))
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err))

// The UI is lightweight; GPU compositing just wastes power. This drops the
// "GPU Very high" usage to near zero. Must be called before app is ready.
app.disableHardwareAcceleration()

// Linux desktops (GNOME/KDE) default to Wayland now, where Chromium's screen/
// window capture (desktopCapturer, used by OSCQR/ShazamOSC/VRChat-window
// capture below) needs PipeWire explicitly enabled - without it, capture can
// hang indefinitely waiting on a portal that's never offered instead of
// failing fast. Both switches are no-ops under X11/Windows/Mac.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
}

let mainWindow
let tray
let bleSelectCallback = null
let blePairingCallback = null
let bleReconnectTarget = null
const bleScanDevices = new Map()
let oscAppsCaptureSourceId = ''

// desktopCapturer.getSources() can hang indefinitely on Linux under Wayland
// when the PipeWire/xdg-desktop-portal screen-cast backend isn't available
// (no portal offered, nothing ever resolves or rejects) - unlike a normal
// failure, that leaves the awaiting IPC handler stuck forever, which is what
// actually froze the whole app ("Not Responding"), not just the visible
// "Failed to get sources" error. Race it against a timeout so it always
// settles one way or the other.
function getDesktopSourcesSafe (opts, timeoutMs = 6000) {
  return Promise.race([
    desktopCapturer.getSources(opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for the screen/window capture list (no permission from the desktop compositor?)')), timeoutMs))
  ])
}

function cacheBleDevice (device) {
  if (!device?.deviceId) return
  const stored = settings.get('hrBleCachedDevices', [])
  const cached = (Array.isArray(stored) ? stored : []).filter(item => item && item.id !== device.deviceId)
  cached.unshift({ id: device.deviceId, name: device.deviceName || 'Unnamed BLE device', lastSeenAt: Date.now() })
  settings.set('hrBleCachedDevices', cached.slice(0, 20))
}

function bleDebugPath () { return path.join(app.getPath('userData'), 'ble-debug.log') }
function appendBleDebug (entry) {
  try {
    const file = bleDebugPath()
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`)
    } catch (_) { /* best-effort rotation */ }
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch (err) { console.warn('BLE debug log:', err.message) }
}

// Only ever allow ONE instance — prevents the process count ballooning if the
// app (or its installer/shortcut) is launched more than once.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus() }
  })
}

// Forward a module event into the renderer over a named channel.
function push (channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function createTray () {
  tray = new Tray(path.join(__dirname, 'assets/icon.ico'))
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show NekoSuneAPPS', click: () => mainWindow.show() },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.setToolTip('NekoSuneAPPS')
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow.show())
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b14',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.ico'),
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false
    }
  })

  mainWindow.loadFile('index.html')

  // OSCQR, ShazamOSC, desktop STT/OCR and the SOS instant-replay buffer all
  // share this one handler (Electron only allows one per session), so there
  // is never an OS picker shown - we pick the source ourselves. An explicit
  // user selection (oscAppsCaptureSourceId, set via the capture-source
  // picker in Settings) always wins. Otherwise capture a whole SCREEN, not
  // the VRChat window specifically - Chromium's window-level capture on
  // Windows uses GDI/BitBlt, which can't see hardware-accelerated
  // DirectX/Vulkan swapchain content and returns solid black for exactly the
  // kind of window a game renders into. Full-screen/monitor capture goes
  // through the Desktop Duplication API instead, which composites whatever
  // the GPU actually drew, so it's the only reliable way to capture VRChat.
  // (If VRChat is on a second monitor, use the manual capture-source picker
  // in Settings to choose that screen explicitly.)
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await getDesktopSourcesSafe({ types: ['screen', 'window'] })
      const selected = sources.find(source => source.id === oscAppsCaptureSourceId) ||
        sources.find(source => source.id.startsWith('screen:')) || sources[0]
      callback(selected ? { video: selected, audio: request.audioRequested ? 'loopback' : undefined } : {})
    } catch (err) {
      console.warn('Display media request failed:', err.message)
      callback({})
    }
  }, { useSystemPicker: true })

  // Electron does not display Chromium's Bluetooth chooser. Keep the request
  // open while forwarding discoveries to our Heart Rate device list.
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    bleSelectCallback = callback
    for (const device of devices || []) {
      bleScanDevices.set(device.deviceId, {
        id: device.deviceId,
        name: device.deviceName || 'Unnamed BLE device',
        source: 'nearby'
      })
    }
    push('hr:bleDevices', [...bleScanDevices.values()])
    if (bleReconnectTarget) {
      const match = (devices || []).find(device =>
        device.deviceId === bleReconnectTarget.id ||
        (!!bleReconnectTarget.name && device.deviceName === bleReconnectTarget.name))
      if (match) {
        cacheBleDevice(match)
        bleReconnectTarget = null
        bleSelectCallback = null
        callback(match.deviceId)
      }
    }
  })

  mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
    blePairingCallback = callback
    push('hr:blePairing', {
      deviceId: details.deviceId,
      deviceName: bleScanDevices.get(details.deviceId)?.name || '',
      pairingKind: details.pairingKind,
      pin: details.pin || ''
    })
  })

  // Honor "Start minimized to tray": only reveal the window if not opted in.
  const startMinimized = !!settings.get('autostart', {}).autoMinimized
  mainWindow.once('ready-to-show', () => { if (!startMinimized) mainWindow.show() })

  mainWindow.on('minimize', event => {
    event.preventDefault()
    mainWindow.hide()
  })
  mainWindow.on('restore', () => mainWindow.show())

  vrOverlay.init(mainWindow, state => push('vrOverlay:status', state))

  createTray()
}

async function configureOverlayServer () {
  setMediaProvider(getNowPlaying)
  setPreferredSource(settings.get('nowPlayingSource', '')) // restore the chosen media source
  try {
    await updateOverlaySettings({
      enabled: settings.get('overlayEnabled', true),
      port: settings.get('overlayPort', 39530),
      style: settings.get('overlayStyle', 'default'),
      boxBg: settings.get('overlayBoxBg', 'solid')
    })
  } catch (error) {
    console.error('Overlay server failed:', error)
  }
}

app.whenReady().then(async () => {
  // Downloaded Whisper models land under userData (always writable without
  // elevation), not @huggingface/transformers's own node_modules-relative
  // default - see speechToText.js for why that default broke on a
  // per-machine install.
  configureModelsDir(app.getPath('userData'))
  await configureOverlayServer()
  createWindow()
  // Track the current VRChat world from its log; feed it to the renderer and
  // (when connected) into the Discord presence.
  gamelog.init(app.getPath('userData')).catch(err => console.warn('gamelog init:', err.message))
  // Community Ranks (NekoSuneAPPS OG ranks) — only spin up the store when the
  // master toggle is on. Dormant DB is retained when off (it just isn't loaded).
  if (settings.get('communityRanks', {}).enabled) {
    ranks.init(app.getPath('userData'))
      .then(ok => { if (ok) setTimeout(refreshSelfRank, 18000) }) // stagger after VRChat pollers
      .catch(err => console.warn('ranks init:', err.message))
  }
  tonData.init(app.getPath('userData')) // load/refresh the offline ToN reference cache
  tonManager.init(app.getPath('userData'))
  osc.setExtraOscTargets(settings.get('extraOscTargets', []))
  setDiscordExtraOscTargets(settings.get('extraOscTargets', []))
  // Resume the Activity status push if the user already logged in with
  // Discord in a previous session — no need to log in again every launch.
  const savedDiscordSession = settings.get('discordSessionToken', '')
  if (savedDiscordSession) startStatusPush(getNekosuneBackendUrl(), savedDiscordSession, getVrcContextSnapshot)
  // Restore the ToN Tablet OSC proxy (sends avatar params on each ToN update).
  if (settings.get('tonOscEnabled', false)) { osc.setOscPort(settings.get('oscPort', 9000)); tonOsc.setEnabled(true) }
  const savedRusk = settings.get('oscApps.ruskLaserdome', {})
  if (savedRusk.enabled) ruskLaserdome.start({ ...savedRusk, oscPort: settings.get('oscPort', 9000) }, state => push('oscApps:ruskUpdate', state))
  // Auto-launch ToNSaveManager in the background on app start (downloads it first if missing).
  if (settings.get('tonAutoManager', false)) tonManager.ensureRunning().then(r => { if (r && r.ok) push('tonmgr:status', { installed: true, running: true }) }).catch(() => {})
  if (settings.get('screenshotMetadata', false)) screenshotMetadata.start()
  startVrcWorld(w => {
    push('vrc:world', w)
    setVrcContext({ worldName: w.inWorld ? w.worldName : '', joinUrl: w.joinUrl, worldUrl: w.worldUrl, profileUrl: w.profileUrl })
    pawprints.setWorld(w.inWorld ? w.worldName : '')
    logWorldDiff(w)
    if (w.lastVideo && w.lastVideo !== lastVideoLogged) { lastVideoLogged = w.lastVideo; gamelog.log('video', '🎬 Video', w.lastVideo, w.worldName) }
    if (w.portalSeq && w.portalSeq !== lastPortalSeq) { lastPortalSeq = w.portalSeq; gamelog.log('portal', w.lastPortal || 'Someone', 'dropped a portal', w.worldName) }
  })
  crashGuard.start({ enabled: settings.get('autoRejoin', false), getLocation: () => { const w = getVrcWorld(); return (w.inWorld && w.worldId && w.instanceId) ? `${w.worldId}:${w.instanceId}` : '' } })
  setInterval(() => pawprints.tickCommit(), 60000) // persist ongoing world time
  // Stagger the pollers so they don't all hit the API at once on launch.
  setTimeout(startFriendDiff, 8000)
  setTimeout(startNotifPoll, 14000)
  setTimeout(startGroupAlerts, 22000)
  // Check GitHub for a newer release and tell the renderer once it's loaded.
  setTimeout(async () => {
    const info = await updater.check(app.getVersion())
    if (info && info.ok && info.available) push('update:available', info)
  }, 4000)
  // Background VRChat news poller — staggered so it doesn't hit the network
  // at the same time as the update check and friend pollers on startup.
  setTimeout(startNewsPoller, 10000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  if (bleSelectCallback) { const callback = bleSelectCallback; bleSelectCallback = null; callback('') }
  if (blePairingCallback) { const callback = blePairingCallback; blePairingCallback = null; callback({ confirmed: false }) }
  stopComponentStats(); stopNetworkStats(); stopPulsoid(); stopHyperate(); stopDeviceBridge(); stopWindowActivity(); stopTon()
  disconnectTikTok(); stopTwitch(); twitchInteractive.stop(false); stopKick(); stopDiscord(); stopVrBattery(); stopVrcWorld(); stopAfk()
  stopWeather(); stopVrcStatusPoll(); stopBot(); stopOfficialBot(); stopStatusPush(); pawprints.tickCommit(); stopFriendDiff(); stopGreeter(); gamelog.close(); photoRelay.stop(); stopGroupAlerts(); stopNotifPoll(); crashGuard.stop(); vrcTools.stopVideoCacher(); stopTonLog(); ranks.close(); screenshotMetadata.stop()
  ruskLaserdome.stop(false)
  if (unsubHotkeyHold) { unsubHotkeyHold(); unsubHotkeyHold = null }
  stopHotkeyTick()
  vrOverlay.stop()
})

/* ------------------------------------------------------------------ */
/* Generic settings + now playing (carried from OSCAudiolink)          */
/* ------------------------------------------------------------------ */
ipcMain.handle('getSetting', (e, key, def) => settings.get(key, def))
ipcMain.handle('saveSetting', (e, key, value) => { settings.set(key, value); return value })
ipcMain.handle('getOscPort', () => settings.get('oscPort', 9000))
ipcMain.on('updateOscPort', (e, port) => settings.set('oscPort', port))
ipcMain.on('updateOscTargets', (e, targets) => {
  const value = Array.isArray(targets) ? targets : []
  osc.setExtraOscTargets(value)
  setDiscordExtraOscTargets(value)
  settings.set('extraOscTargets', value)
})
ipcMain.handle('saveOscPort', (e, port) => { settings.set('oscPort', port); return port })
ipcMain.handle('getNowPlaying', () => getNowPlaying())
ipcMain.handle('nowPlaying:sources', () => ({ sources: getSources(), preferred: getPreferredSource() }))
ipcMain.handle('nowPlaying:setSource', (e, value) => { setPreferredSource(value); settings.set('nowPlayingSource', String(value || '')); return getPreferredSource() })
ipcMain.handle('getOverlayState', () => getOverlayState())
ipcMain.handle('updateOverlaySettings', (e, s) => updateOverlaySettings(s))

/* NekoAvatarLocker: signed ownership vault + OSC feature gates */
ipcMain.handle('locker:getState', () => avatarLocker.getState())
ipcMain.handle('locker:importOwnership', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import avatar ownership package',
    filters: [{ name: 'NekoAvatarLocker ownership', extensions: ['nalown', 'json'] }],
    properties: ['openFile']
  })
  return result.canceled || !result.filePaths[0] ? avatarLocker.getState() : avatarLocker.importOwnershipFile(result.filePaths[0])
})
ipcMain.handle('locker:exportOwnership', async (event, avatarId) => {
  const vault = avatarLocker.getState()
  const record = vault.avatars.find(item => item.ownershipPackage.license.avatarId === avatarId)
  if (!record) throw new Error(`Avatar not found: ${avatarId}`)
  const safeName = String(record.ownershipPackage.license.avatarName || 'ownership').replace(/[<>:"/\\|?*]/g, '_')
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export avatar ownership package',
    defaultPath: `${safeName}.nalown`,
    filters: [{ name: 'NekoAvatarLocker ownership', extensions: ['nalown'] }]
  })
  return result.canceled || !result.filePath ? vault : avatarLocker.exportOwnershipFile(avatarId, result.filePath)
})
ipcMain.handle('locker:signOwnershipTemplate', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select ownership template to sign',
    filters: [{ name: 'NekoAvatarLocker template', extensions: ['nalown', 'json'] }],
    properties: ['openFile']
  })
  return result.canceled || !result.filePaths[0] ? null : avatarLocker.signOwnershipTemplate(result.filePaths[0])
})
ipcMain.handle('locker:setUnlock', (event, avatarId, mode, groupIds) => avatarLocker.setUnlock(String(avatarId || ''), mode, groupIds))
ipcMain.handle('locker:updateOscSettings', (event, value) => avatarLocker.updateOscSettings(value))
ipcMain.handle('locker:resetVault', () => avatarLocker.resetVault())
ipcMain.handle('locker:legacyStatus', () => ({ available: !!avatarLocker.findLegacyVaultPath() }))
ipcMain.handle('locker:importLegacyVault', () => avatarLocker.importLegacyVault())
ipcMain.handle('locker:openUserData', () => shell.openPath(avatarLocker.getVaultFolder()))

/* OSC companion integrations */
ipcMain.handle('oscApps:ruskGet', () => ({ ...ruskLaserdome.getState(), saved: settings.get('oscApps.ruskLaserdome', {}) }))
ipcMain.handle('oscApps:ruskStart', (event, options) => {
  const value = { ...(options || {}), enabled: true }
  settings.set('oscApps.ruskLaserdome', value)
  return ruskLaserdome.start({ ...value, oscPort: settings.get('oscPort', 9000) }, state => push('oscApps:ruskUpdate', state))
})
ipcMain.handle('oscApps:ruskStop', () => {
  const value = { ...settings.get('oscApps.ruskLaserdome', {}), enabled: false }
  settings.set('oscApps.ruskLaserdome', value)
  return ruskLaserdome.stop()
})
ipcMain.handle('oscApps:twitchInteractiveGet', () => ({
  ...twitchInteractive.getState(),
  saved: settings.get('oscApps.twitchInteractive', {})
}))
ipcMain.handle('oscApps:twitchInteractiveStart', async (event, options) => {
  const value = { ...(options || {}), enabled: true }
  settings.set('oscApps.twitchInteractive', value)
  const twitch = settings.get('oauth.twitch', settings.get('twitch', {}))
  return twitchInteractive.start({ ...value, ...twitch }, osc.sendParam, state => push('oscApps:twitchInteractiveUpdate', state))
})
ipcMain.handle('oscApps:twitchInteractiveStop', () => {
  settings.set('oscApps.twitchInteractive', { ...settings.get('oscApps.twitchInteractive', {}), enabled: false })
  return twitchInteractive.stop()
})
ipcMain.handle('oscApps:recognizeSong', (event, request = {}) => recognizeAudio({
  audio: Buffer.from(String(request.audioBase64 || ''), 'base64'),
  token: request.token,
  provider: request.provider,
  acrHost: request.acrHost,
  acrAccessKey: request.acrAccessKey,
  acrAccessSecret: request.acrAccessSecret
}))
ipcMain.handle('oscApps:recognitionProviders', () => getProviderStatus())
ipcMain.handle('oscApps:captureSources', async () => {
  try {
    const sources = await getDesktopSourcesSafe({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    return { selected: oscAppsCaptureSourceId, sources: sources.map(source => ({ id: source.id, name: source.name })) }
  } catch (err) {
    return { selected: oscAppsCaptureSourceId, sources: [], error: err.message }
  }
})
ipcMain.handle('oscApps:selectCaptureSource', (event, sourceId) => {
  oscAppsCaptureSourceId = String(sourceId || '')
  return oscAppsCaptureSourceId
})

/* ------------------------------------------------------------------ */
/* Component stats                                                     */
/* ------------------------------------------------------------------ */
ipcMain.handle('stats:start', (e, intervalMs) => {
  startComponentStats(s => push('stats:update', s), intervalMs)
  return true
})
ipcMain.handle('stats:stop', () => { stopComponentStats(); return true })

/* Network stats */
ipcMain.handle('net:start', (e, opts) => {
  startNetworkStats(s => push('net:update', s), opts || {})
  return true
})
ipcMain.handle('net:stop', () => { stopNetworkStats(); return true })

/* ------------------------------------------------------------------ */
/* Heart rate (Pulsoid + HypeRate + local device bridges)             */
/* ------------------------------------------------------------------ */
let hrProvider = 'pulsoid'
let hrOscProfiles = { ...hrOsc.DEFAULTS }
let hrMonitoringActive = false

let hrLastBpm = 0
let hrBeatTimer = null
let hrPulseTimer = null
let hrBeatToggle = false

// Drive isHRBeat (a brief pulse) + HeartBeatToggle (alternates) once per beat,
// re-reading hrLastBpm each tick so the rhythm tracks the latest reading.
function scheduleHrBeat () {
  if (hrBeatTimer) { clearTimeout(hrBeatTimer); hrBeatTimer = null }
  if (!hrLastBpm || hrLastBpm <= 0) return
  const interval = Math.max(250, Math.round(60000 / hrLastBpm)) // floor guards against absurd BPM
  hrBeatTimer = setTimeout(() => {
    hrBeatToggle = !hrBeatToggle
    hrOsc.sendBeat(osc.sendParam, hrOscProfiles, true, hrBeatToggle)
    if (hrPulseTimer) clearTimeout(hrPulseTimer)
    hrPulseTimer = setTimeout(() => hrOsc.sendBeat(osc.sendParam, hrOscProfiles, false), Math.min(150, Math.floor(interval / 2)))
    scheduleHrBeat()
  }, interval)
}

function stopHrBeat () {
  if (hrBeatTimer) { clearTimeout(hrBeatTimer); hrBeatTimer = null }
  if (hrPulseTimer) { clearTimeout(hrPulseTimer); hrPulseTimer = null }
  hrOsc.sendBeat(osc.sendParam, hrOscProfiles, false)
}

// Wrap the provider listener so every reading also feeds analytics + Discord.
function onHr (s) {
  push('hr:update', s)
  hrAnalytics.record(s.bpm)
  const online = !!(s.online && s.bpm)
  hrOsc.sendStatus(osc.sendParam, hrOscProfiles, { active: hrMonitoringActive, connected: online })
  if (online) {
    setVrcContext({ hrBpm: s.bpm })
    hrOsc.sendReading(osc.sendParam, hrOscProfiles, s.bpm, s.avg)
    hrLastBpm = s.bpm
    if (!hrBeatTimer) scheduleHrBeat() // start the beat loop; it reschedules itself off hrLastBpm
  } else {
    setVrcContext({ hrBpm: 0 })
    hrOsc.sendReading(osc.sendParam, hrOscProfiles, 0)
    hrLastBpm = 0
    stopHrBeat()
  }
}

function stopHr () {
  stopPulsoid(); stopHyperate(); stopDeviceBridge()
  const summary = hrAnalytics.end()
  if (summary) push('hr:sessions', hrAnalytics.list())
  setVrcContext({ hrBpm: 0 })
  hrMonitoringActive = false
  hrLastBpm = 0
  stopHrBeat()
  hrBeatToggle = false
  hrOsc.sendBeat(osc.sendParam, hrOscProfiles, false, false)
  hrOsc.sendReading(osc.sendParam, hrOscProfiles, 0)
  hrOsc.sendStatus(osc.sendParam, hrOscProfiles, { active: false, connected: false })
}

// cfg: { provider:'pulsoid'|'hyperate'|'device', token, apiKey, deviceId,
//        bridgePort, relayToPulsoid, relayToken, oscProfiles }
ipcMain.handle('hr:start', async (e, cfg) => {
  cfg = cfg || {}
  stopHr()
  hrOscProfiles = hrOsc.options(cfg.oscProfiles)
  hrMonitoringActive = true
  hrBeatToggle = false
  osc.setOscPort(settings.get('oscPort', 9000)) // mirror BPM to the configured OSC port
  hrOsc.sendBeat(osc.sendParam, hrOscProfiles, false, false)
  hrOsc.sendStatus(osc.sendParam, hrOscProfiles, { active: true, connected: false })
  hrProvider = ['hyperate', 'device'].includes(cfg.provider) ? cfg.provider : 'pulsoid'
  hrAnalytics.begin(hrProvider)
  if (hrProvider === 'hyperate') startHyperate(cfg.apiKey, cfg.deviceId, onHr)
  else if (hrProvider === 'device') {
    const result = await startDeviceBridge({
      port: cfg.bridgePort,
      relayEnabled: cfg.relayToPulsoid,
      relayToken: cfg.relayToken
    }, onHr)
    if (!result.ok) {
      hrAnalytics.end()
      hrMonitoringActive = false
      hrOsc.sendStatus(osc.sendParam, hrOscProfiles, { active: false, connected: false })
    }
    return result
  }
  else startPulsoid(cfg.token, onHr)
  return { ok: true }
})
ipcMain.handle('hr:stop', () => { stopHr(); return true })
ipcMain.handle('hr:sessions', () => hrAnalytics.list())
ipcMain.handle('hr:clearSessions', () => { hrAnalytics.clear(); return true })
ipcMain.handle('hr:bleSelect', (e, deviceId) => {
  if (!bleSelectCallback || !bleScanDevices.has(String(deviceId || ''))) return false
  const selected = bleScanDevices.get(String(deviceId))
  if (selected) cacheBleDevice({ deviceId: selected.id, deviceName: selected.name })
  const callback = bleSelectCallback
  bleSelectCallback = null
  callback(String(deviceId))
  return true
})
ipcMain.handle('hr:bleCancel', () => {
  if (bleSelectCallback) { const callback = bleSelectCallback; bleSelectCallback = null; callback('') }
  bleScanDevices.clear()
  bleReconnectTarget = null
  return true
})
ipcMain.on('hr:blePrepareReconnect', (e, target) => {
  bleReconnectTarget = target && target.id ? { id: String(target.id), name: String(target.name || '') } : null
})
ipcMain.handle('hr:bleCached', () => {
  const cached = settings.get('hrBleCachedDevices', [])
  return Array.isArray(cached) ? cached : []
})
ipcMain.handle('hr:bleDebug', (e, eventName, details) => {
  appendBleDebug({ event: String(eventName || 'event'), details: details && typeof details === 'object' ? details : {} })
  return true
})
ipcMain.handle('hr:bleOpenDebug', async () => {
  const file = bleDebugPath()
  if (!fs.existsSync(file)) appendBleDebug({ event: 'log-created', details: {} })
  shell.showItemInFolder(file)
  return file
})
ipcMain.handle('hr:blePairingResponse', (e, response) => {
  if (!blePairingCallback) return false
  const callback = blePairingCallback
  blePairingCallback = null
  callback(response || { confirmed: false })
  return true
})
ipcMain.handle('hr:bleReading', (e, bpm, measuredAt) => submitDeviceBpm(bpm, measuredAt))
ipcMain.handle('hr:pulsoidAuthorize', async () => {
  const session = await pulsoidOAuth.beginDeviceAuthorization()
  await shell.openExternal(session.verificationUri)
  const token = await pulsoidOAuth.waitForDeviceToken(session)
  return { ok: true, ...pulsoidOAuth.publicConfig(), ...token }
})
ipcMain.handle('hr:pulsoidKeys', async () => {
  await shell.openExternal('https://pulsoid.net/ui/keys')
  return true
})

/* ------------------------------------------------------------------ */
/* Window activity                                                     */
/* ------------------------------------------------------------------ */
ipcMain.handle('window:start', () => {
  startWindowActivity(s => push('window:update', s))
  return true
})
ipcMain.handle('window:stop', () => { stopWindowActivity(); return true })

/* ------------------------------------------------------------------ */
/* ToNSaveManager (Terrors of Nowhere tracker)                         */
/* ------------------------------------------------------------------ */
// Encountered terrors / maps — the "how many you've bumped into" tally, persisted.
const tonSeenTerrors = new Set(settings.get('tonSeenTerrors', []))
const tonSeenMaps = new Set(settings.get('tonSeenMaps', []))
// Manually-marked + live auto-unlocked entries (ToN broadcasts achievement unlocks
// over the WS as TRACKER { event:"achievement" }).
const tonUnlockAch = new Set(settings.get('tonUnlockAch', []))
const tonUnlockItems = new Set(settings.get('tonUnlockItems', []))
const tonUnlockRounds = new Set(settings.get('tonUnlockRounds', []))
let tonSeenSaveTimer = null
// Resolve a notification icon for a ToN achievement/terror from the cached art
// (local downloaded file if present, else the remote URL — the lib handles both).
function tonArtIcon (cat, name) {
  try {
    const c = tonData.get()
    const list = cat === 'terror' ? (c.terrors || []) : (c.achievements || [])
    const e = list.find(x => x.name === name) || list.find(x => x.name && x.name.toLowerCase() === String(name).toLowerCase())
    if (!e) return null
    if (e.icon && c.iconDir) { const p = path.join(c.iconDir, e.icon); if (fs.existsSync(p)) return p }
    return e.img || null
  } catch (_) { return null }
}
function tonRecordSeen (s) {
  let changed = false
  if (s.roundActive && s.terror && s.terror !== '???' && !tonSeenTerrors.has(s.terror)) {
    tonSeenTerrors.add(s.terror); changed = true
    if (settings.get('tonNotify', true) && settings.get('tonNotifyTerrors', false)) vrNotify.notify('👹 New Terror Encountered', s.terror, settings.get('tonNotifyMode', 'auto'), tonArtIcon('terror', s.terror))
  }
  if (s.map && !tonSeenMaps.has(s.map)) { tonSeenMaps.add(s.map); changed = true }
  if (changed) {
    clearTimeout(tonSeenSaveTimer)
    tonSeenSaveTimer = setTimeout(() => {
      settings.set('tonSeenTerrors', [...tonSeenTerrors]); settings.set('tonSeenMaps', [...tonSeenMaps])
    }, 3000)
  }
}
let tonWsConnected = false
function onTonUpdate (s) { tonWsConnected = !!s.connected; tonRecordSeen(s); if (tonOsc.isEnabled()) tonOsc.apply(s); push('ton:update', s) }

// Persist a finished round to the offline history and push it live.
function tonOnRound (rec) {
  gamelog.log('ton_round', rec.roundType || 'Round',
    JSON.stringify({ terror: rec.terror, map: rec.map, result: rec.result, dur: rec.durationSec }), rec.map || '')
  push('ton:round', rec)
}
// A captured save code (from ToNSaveManager OR the VRChat log): back it up AND
// auto-decode the achievements it contains, marking them on the board. This is how
// achievements stay current without ToNSaveManager — the save code is the source.
function tonHandleSaveCode (code) {
  const rec = tonAddSave(code)
  try {
    const boardNames = (tonData.get().achievements || []).map(a => a.name)
    const dec = tonUnlockDecoder.decodeAchievements(code, { boardNames })
    if (dec && dec.ok && Array.isArray(dec.matched) && dec.matched.length) {
      let added = 0
      dec.matched.forEach(n => { if (!tonUnlockAch.has(n)) { tonUnlockAch.add(n); added++ } })
      if (added) { settings.set('tonUnlockAch', [...tonUnlockAch]); push('ton:unlocksUpdated', { added, unlocked: dec.unlockedCount }) }
    }
  } catch (_) { /* decode is best-effort */ }
  if (rec) push('ton:save', { ts: rec.ts, length: code.length })
}

ipcMain.handle('ton:start', (e, opts) => {
  startTon(onTonUpdate, {
    ...(opts || {}),
    onRound: tonOnRound,
    // Live achievement unlock from the game — mark it, persist, alert, tell renderer.
    onAchievement: name => {
      if (!tonUnlockAch.has(name)) { tonUnlockAch.add(name); settings.set('tonUnlockAch', [...tonUnlockAch]) }
      push('ton:achievement', name)
      if (settings.get('tonNotify', true)) vrNotify.notify('🏆 ToN Achievement Unlocked', name, settings.get('tonNotifyMode', 'auto'), tonArtIcon('ach', name))
    },
    onSave: tonHandleSaveCode
  })
  // Always read the VRChat log too (ToNSaveManager optional): captures save codes and,
  // when the WebSocket isn't connected, drives the live round/map/death state.
  startTonLog({
    onSave: tonHandleSaveCode,
    onRound: rec => { if (!tonWsConnected) tonOnRound(rec) },
    onUpdate: s => { if (!tonWsConnected) { tonRecordSeen(s); push('ton:update', s) } }
  })
  return true
})
ipcMain.handle('ton:stop', () => { stopTon(); stopTonLog(); return true })
ipcMain.handle('ton:get', () => getTonState())

/* ToN Tablet avatar OSC proxy (core params → ToN_ avatar parameters) */
ipcMain.handle('tonOsc:get', () => ({ enabled: tonOsc.isEnabled(), params: tonOsc.preview(getTonState()) }))
ipcMain.handle('tonOsc:set', (e, on) => {
  osc.setOscPort(settings.get('oscPort', 9000)) // main has its own OSC socket; match the configured port
  tonOsc.setEnabled(!!on)
  settings.set('tonOscEnabled', !!on)
  if (on) { tonOsc.resync(); tonOsc.apply(getTonState()) }
  return { enabled: tonOsc.isEnabled(), params: tonOsc.preview(getTonState()) }
})
// Force a full re-send (e.g. after an avatar reload).
ipcMain.handle('tonOsc:resync', () => { osc.setOscPort(settings.get('oscPort', 9000)); tonOsc.resync(); return tonOsc.apply(getTonState()) })
// Raw recent WebSocket messages — for verifying the id mappings in-game.
ipcMain.handle('tonOsc:raw', () => getTonRaw())
ipcMain.handle('ton:history', (e, limit) => gamelog.list({ type: 'ton_round', limit: limit || 200 }).map(r => {
  let d = {}; try { d = JSON.parse(r.detail || '{}') } catch (_) {}
  return { ts: r.ts, roundType: r.name, terror: d.terror || '', map: d.map || r.world || '', result: d.result || '', durationSec: d.dur || 0 }
}))

// Offline ToN reference cache (achievements + terrors, scraped from terror.moe).
ipcMain.handle('ton:data', () => tonData.get())
ipcMain.handle('ton:dataRefresh', async () => {
  const c = await tonData.refresh()
  return { achievements: c.achievements.length, terrors: c.terrors.length, fetchedAt: c.fetchedAt }
})
ipcMain.handle('ton:seen', () => ({ terrors: [...tonSeenTerrors], maps: [...tonSeenMaps] }))
ipcMain.handle('app:openExternal', (e, url) => { if (/^https?:\/\//i.test(url || '')) shell.openExternal(url); return true })
ipcMain.handle('update:check', () => updater.check(app.getVersion()))
ipcMain.handle('app:version', () => app.getVersion())
ipcMain.handle('app:contributors', () => updater.contributors())

// Public, unauthenticated supporters list (Patreon/Ko-fi via linked Discord
// accounts) for the About page - see NekoSuneLinkupSite's
// api/publicSupporters.js. Fetched from main to avoid the renderer's CORS
// restrictions; fails soft (empty list) if the linkup site is unreachable.
ipcMain.handle('app:supporters', async () => {
  try {
    const { data } = await axios.get('https://linkup.nekosunevr.co.uk/api/supporters', { timeout: 10000 })
    return { ok: true, supporters: Array.isArray(data?.supporters) ? data.supporters : [] }
  } catch (err) {
    return { ok: false, supporters: [], error: err.message }
  }
})

// Launches the standalone updater helper (updater/ - its own little Electron
// app with its own branded window) and quits - the helper owns the whole
// download + install + relaunch flow from here, since it has to run outside
// this app's own files to be able to replace them. See updater.js for how
// it's located per platform / dev vs packaged.
ipcMain.handle('update:startUpdate', (e, { url, name, version } = {}) => {
  if (!url) throw new Error('No update file to download')
  try {
    updater.startUpdate({
      url, name, version,
      appRootDir: __dirname,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      pid: process.pid
    }, () => app.quit())
    return true
  } catch (err) {
    throw new Error(`Could not start the update: ${err.message}`)
  }
})

// VR overlay (experimental, Windows + SteamVR only) - mirrors the main
// window into a floating VR panel. Non-interactive first slice; see
// modules/vr/overlay/openvrOverlay.js for what is/isn't verified.
ipcMain.handle('vrOverlay:isAvailable', () => vrOverlay.isAvailable())
ipcMain.handle('vrOverlay:start', async () => {
  try {
    await vrOverlay.start()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
ipcMain.handle('vrOverlay:stop', () => { vrOverlay.stop(); return true })
ipcMain.handle('vrOverlay:isRunning', () => vrOverlay.isRunning())

// Achievements auto-unlock from the live WS feed; all categories are click-to-toggle.
const tonSetFor = cat => ({ achievements: tonUnlockAch, items: tonUnlockItems, rounds: tonUnlockRounds, terrors: tonSeenTerrors, locations: tonSeenMaps }[cat])
const tonKeyFor = cat => ({ achievements: 'tonUnlockAch', items: 'tonUnlockItems', rounds: 'tonUnlockRounds', terrors: 'tonSeenTerrors', locations: 'tonSeenMaps' }[cat])
ipcMain.handle('ton:unlocks', () => ({
  achievements: [...tonUnlockAch], items: [...tonUnlockItems], rounds: [...tonUnlockRounds],
  terrors: [...tonSeenTerrors], locations: [...tonSeenMaps]
}))
ipcMain.handle('ton:toggleUnlock', (e, { category, key } = {}) => {
  const set = tonSetFor(category); if (!set || !key) return false
  if (set.has(key)) set.delete(key); else set.add(key)
  settings.set(tonKeyFor(category), [...set])
  return set.has(key)
})

// Dated backups of the game's save code (captured from the WS SAVED event).
let tonSaves = null
function tonSavesFile () { return path.join(app.getPath('userData'), 'ton-saves.json') }
function tonLoadSaves () { if (tonSaves) return; try { tonSaves = JSON.parse(fs.readFileSync(tonSavesFile(), 'utf8')) } catch (_) { tonSaves = [] } }
function tonAddSave (code) {
  code = String(code || '').trim(); if (!code) return null
  tonLoadSaves()
  if (tonSaves[0] && tonSaves[0].code === code) return null // skip consecutive identical saves
  const rec = { ts: Date.now(), code }
  tonSaves.unshift(rec)
  if (tonSaves.length > 200) tonSaves.length = 200 // keep the 200 most recent backups
  try { fs.writeFileSync(tonSavesFile(), JSON.stringify(tonSaves)) } catch (err) { console.warn('ton-saves write:', err.message) }
  return rec
}
ipcMain.handle('ton:saves', () => { tonLoadSaves(); return tonSaves.map(s => ({ ts: s.ts, length: (s.code || '').length, preview: (s.code || '').slice(0, 24) })) })
ipcMain.handle('ton:saveCode', (e, ts) => { tonLoadSaves(); const s = tonSaves.find(x => x.ts === ts); return s ? s.code : '' })
ipcMain.handle('ton:savesClear', () => { tonSaves = []; try { fs.writeFileSync(tonSavesFile(), '[]') } catch (_) {} return true })

// Reset all of the app's tracked ToN progress: board unlocks (every category),
// terrors/maps seen, and round history. Optionally also the save-code backups.
// Note: lifetime stats (rounds/deaths/…) live in ToNSaveManager + the game and
// repopulate from the WS on connect — the app can't wipe those.
ipcMain.handle('ton:resetAll', (e, opts = {}) => {
  for (const s of [tonUnlockAch, tonUnlockItems, tonUnlockRounds, tonSeenTerrors, tonSeenMaps]) s.clear()
  settings.set('tonUnlockAch', []); settings.set('tonUnlockItems', []); settings.set('tonUnlockRounds', [])
  settings.set('tonSeenTerrors', []); settings.set('tonSeenMaps', [])
  let rounds = 0
  try { rounds = gamelog.list({ type: 'ton_round', limit: 1000 }).length; gamelog.clearType('ton_round') } catch (_) {}
  let saves = 0
  if (opts.saves) { tonLoadSaves(); saves = tonSaves.length; tonSaves = []; try { fs.writeFileSync(tonSavesFile(), '[]') } catch (_) {} }
  return { ok: true, rounds, saves }
})

// Import a manually-pasted save code (e.g. from ToNSaveManager or another PC) and
// keep it alongside the auto-captured backups. Validates it looks like a real code.
ipcMain.handle('ton:saveImport', (e, code) => {
  const clean = tonSaveCodec.sanitize(code)
  if (!clean) return { ok: false, error: 'empty' }
  if (!tonSaveCodec.isSaveCode(clean)) return { ok: false, error: 'not a save code' }
  tonLoadSaves()
  const dup = !!(tonSaves[0] && tonSaves[0].code === clean)
  const rec = tonAddSave(clean) // null if identical to the most-recent backup
  return { ok: true, duplicate: dup, length: clean.length, ts: rec ? rec.ts : (tonSaves[0] && tonSaves[0].ts) }
})
// Resolve a code from { ts } (a stored backup) or { code } (a raw string).
function tonResolveCode (arg) {
  if (arg && typeof arg === 'object') {
    if (arg.code) return tonSaveCodec.sanitize(arg.code)
    if (arg.ts) { tonLoadSaves(); const s = tonSaves.find(x => x.ts === Number(arg.ts)); return s ? s.code : '' }
  }
  return typeof arg === 'string' ? tonSaveCodec.sanitize(arg) : ''
}
// Lossless structural decode (fields are unlabeled — the format has no public schema).
ipcMain.handle('ton:saveDecode', (e, arg) => {
  const code = tonResolveCode(arg)
  return code ? tonSaveCodec.decode(code) : { ok: false, error: 'not found' }
})
// Positional diff of two stored saves — reveals which fields changed between them.
ipcMain.handle('ton:saveDiff', (e, { tsA, tsB } = {}) => {
  const a = tonResolveCode({ ts: tsA })
  const b = tonResolveCode({ ts: tsB })
  if (!a || !b) return { ok: false, error: 'not found' }
  return tonSaveCodec.diff(a, b)
})
// Decode the achievement unlocks from a save (reverse-engineered — for preview/verify).
ipcMain.handle('ton:decodeUnlocks', (e, { ts, code } = {}) => {
  const c = tonResolveCode(code ? { code } : { ts })
  if (!c) return { ok: false, error: 'not found' }
  const boardNames = (tonData.get().achievements || []).map(a => a.name)
  return tonUnlockDecoder.decodeAchievements(c, { boardNames })
})
// Apply confirmed achievement names to the board (user-gated catch-up, not a guess).
ipcMain.handle('ton:applyUnlocks', (e, { names } = {}) => {
  if (!Array.isArray(names) || !names.length) return { ok: false, error: 'nothing to apply' }
  let added = 0
  names.forEach(n => { if (n && !tonUnlockAch.has(n)) { tonUnlockAch.add(n); added++ } })
  if (added) settings.set('tonUnlockAch', [...tonUnlockAch])
  return { ok: true, added, total: names.length }
})
ipcMain.handle('app:clipboard', (e, text) => { clipboard.writeText(String(text || '')); return true })

// Manage the ToNSaveManager app itself (download / run / stop / update in background).
ipcMain.handle('tonmgr:status', () => tonManager.status())
ipcMain.handle('tonmgr:install', () => tonManager.install())
ipcMain.handle('tonmgr:update', () => tonManager.update())
ipcMain.handle('tonmgr:start', () => tonManager.start())
ipcMain.handle('tonmgr:stop', () => tonManager.stop())
ipcMain.handle('tonmgr:setAuto', (e, on) => { settings.set('tonAutoManager', !!on); return true })
ipcMain.handle('tonmgr:getAuto', () => settings.get('tonAutoManager', false))

// VR / desktop alerts for ToN achievements & unlocks (vrnotications).
ipcMain.handle('tonNotify:get', () => ({
  enabled: settings.get('tonNotify', true),
  mode: settings.get('tonNotifyMode', 'auto'),
  terrors: settings.get('tonNotifyTerrors', false)
}))
ipcMain.handle('tonNotify:set', (e, cfg = {}) => {
  if ('enabled' in cfg) settings.set('tonNotify', !!cfg.enabled)
  if ('mode' in cfg) settings.set('tonNotifyMode', cfg.mode)
  if ('terrors' in cfg) settings.set('tonNotifyTerrors', !!cfg.terrors)
  return true
})
ipcMain.handle('tonNotify:test', () => {
  const logo = path.join(__dirname, 'assets', 'logo.png')
  return vrNotify.notify('🏆 NekoSuneAPPS', 'ToN alerts are working!', settings.get('tonNotifyMode', 'auto'), fs.existsSync(logo) ? logo : null)
})
ipcMain.handle('tonNotify:detect', () => vrNotify.detect())

// Export / import the player's ToN data (stats + encounters + round history).
ipcMain.handle('ton:export', async () => {
  const r = await dialog.showSaveDialog({ defaultPath: 'ton-player-data.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
  try {
    const payload = {
      app: 'NekoSuneAPPS', kind: 'ton-player-data', version: 1, exportedAt: Date.now(),
      stats: getTonState(),
      seenTerrors: [...tonSeenTerrors],
      seenMaps: [...tonSeenMaps],
      unlockAch: [...tonUnlockAch],
      saves: (tonLoadSaves(), tonSaves),
      history: gamelog.list({ type: 'ton_round', limit: 5000 })
    }
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2))
    return { ok: true, path: r.filePath }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('ton:import', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' }
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'))
    if (Array.isArray(data.seenTerrors)) data.seenTerrors.forEach(t => tonSeenTerrors.add(t))
    if (Array.isArray(data.seenMaps)) data.seenMaps.forEach(m => tonSeenMaps.add(m))
    if (Array.isArray(data.unlockAch)) data.unlockAch.forEach(a => tonUnlockAch.add(a))
    settings.set('tonSeenTerrors', [...tonSeenTerrors]); settings.set('tonSeenMaps', [...tonSeenMaps]); settings.set('tonUnlockAch', [...tonUnlockAch])
    // Merge save backups (skip duplicates by timestamp).
    if (Array.isArray(data.saves)) {
      tonLoadSaves()
      const have = new Set(tonSaves.map(s => s.ts))
      data.saves.forEach(s => { if (s && s.ts && s.code && !have.has(s.ts)) tonSaves.push({ ts: s.ts, code: String(s.code) }) })
      tonSaves.sort((a, b) => b.ts - a.ts); if (tonSaves.length > 200) tonSaves.length = 200
      try { fs.writeFileSync(tonSavesFile(), JSON.stringify(tonSaves)) } catch (_) {}
    }
    // Merge round history (skip exact duplicates by timestamp+type).
    if (Array.isArray(data.history)) {
      const existing = new Set(gamelog.list({ type: 'ton_round', limit: 5000 }).map(e => e.ts))
      data.history.forEach(h => { if (h && h.ts && !existing.has(h.ts)) gamelog.log('ton_round', h.name || 'Round', h.detail || '{}', h.world || '') })
    }
    return { ok: true, terrors: tonSeenTerrors.size, maps: tonSeenMaps.size }
  } catch (err) { return { ok: false, error: err.message } }
})

/* ------------------------------------------------------------------ */
/* TikTok live (followers)                                             */
/* ------------------------------------------------------------------ */
ipcMain.handle('tiktok:connect', (e, payload) => {
  const username = typeof payload === 'string' ? payload : payload?.username
  const signApiKey = typeof payload === 'object' ? payload?.signApiKey : ''
  connectTikTok(username, s => push('tiktok:update', s), signApiKey)
  return true
})
ipcMain.handle('tiktok:disconnect', () => { disconnectTikTok(); return true })

/* TikTok followers without being live (reads public profile) */
ipcMain.handle('tiktok:followers:start', (e, username) => {
  startTikTokFollowers(username, s => push('tiktok:followers', s))
  return true
})
ipcMain.handle('tiktok:followers:stop', () => { stopTikTokFollowers(); return true })

/* TikTok TTS */
ipcMain.handle('tiktok:voices', () => TIKTOK_VOICES)
ipcMain.handle('tiktok:tts', async (e, { text, voice }) => {
  const buf = await getTikTokTtsAudio(text, voice)
  return buf ? buf.toString('base64') : null
})

/* ------------------------------------------------------------------ */
/* Twitch (followers)                                                  */
/* ------------------------------------------------------------------ */
ipcMain.handle('twitch:start', (e, cfg) => {
  startTwitch(cfg, s => push('twitch:update', s))
  return true
})
ipcMain.handle('twitch:stop', () => { stopTwitch(); return true })

/* ------------------------------------------------------------------ */
/* Kick.com (followers)                                                */
/* ------------------------------------------------------------------ */
ipcMain.handle('kick:start', (e, slug) => {
  startKick(slug, s => push('kick:update', s))
  return true
})
ipcMain.handle('kick:stop', () => { stopKick(); return true })

/* ------------------------------------------------------------------ */
/* IntelliChat (multi-provider)                                        */
/* ------------------------------------------------------------------ */
ipcMain.handle('ai:rewrite', (e, opts) => intelliRewrite(opts))
ipcMain.handle('ai:providers', () => AI_PROVIDERS)

/* ------------------------------------------------------------------ */
/* Avatar Scaling - global hotkeys (main process only; the OSC         */
/* controller itself lives in the renderer alongside KAT)              */
/* ------------------------------------------------------------------ */
let unsubHotkeyHold = null
const hotkeyHeld = { up: false, down: false }
let hotkeyTickTimer = null

function startHotkeyTick () {
  if (hotkeyTickTimer) return
  hotkeyTickTimer = setInterval(() => {
    if (hotkeyHeld.up) push('avatarScaling:scaleTick', { dir: 1 })
    if (hotkeyHeld.down) push('avatarScaling:scaleTick', { dir: -1 })
  }, 50)
}

function stopHotkeyTick () {
  if (hotkeyTickTimer) { clearInterval(hotkeyTickTimer); hotkeyTickTimer = null }
}

ipcMain.handle('avatarScaling:recordKey', () => {
  return new Promise(resolve => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      unsub()
      clearTimeout(timer)
      clearTimeout(healthCheck)
      resolve(result)
    }
    const unsub = keyHookPs.subscribe(evt => {
      if (evt.t !== 'down') return
      finish({ vk: evt.vk, name: vkName(evt.vk) })
    })
    // If the hook process never actually comes up (blocked by antivirus, a
    // restrictive PowerShell execution policy, etc.) this used to just sit
    // silent until the 8s timeout and report a generic "no key captured",
    // which looked identical to "recording is broken". Surface the real
    // reason instead once it's had a couple seconds to start.
    const healthCheck = setTimeout(() => {
      if (done || keyHookPs.isRunning()) return
      finish({ error: keyHookPs.getLastError() || "The keyboard hook didn't start - check that PowerShell scripts aren't blocked (antivirus or execution policy) and try again." })
    }, 2500)
    const timer = setTimeout(() => finish(null), 8000)
  })
})

ipcMain.handle('avatarScaling:setHotkeys', (e, { keyUp, keyDown } = {}) => {
  if (unsubHotkeyHold) { unsubHotkeyHold(); unsubHotkeyHold = null }
  stopHotkeyTick()
  hotkeyHeld.up = false
  hotkeyHeld.down = false
  if (!keyUp && !keyDown) return true

  unsubHotkeyHold = keyHookPs.subscribe(evt => {
    if (evt.vk === keyUp) hotkeyHeld.up = (evt.t === 'down')
    else if (evt.vk === keyDown) hotkeyHeld.down = (evt.t === 'down')
    if (hotkeyHeld.up || hotkeyHeld.down) startHotkeyTick()
    else stopHotkeyTick()
  })
  return true
})

ipcMain.handle('avatarScaling:clearHotkeys', () => {
  if (unsubHotkeyHold) { unsubHotkeyHold(); unsubHotkeyHold = null }
  stopHotkeyTick()
  hotkeyHeld.up = false
  hotkeyHeld.down = false
  return true
})

/* ------------------------------------------------------------------ */
/* Translator (DeepL / Google / LibreTranslate + optional AI grammar   */
/* pre-pass, reusing the IntelliChat provider settings)                */
/* ------------------------------------------------------------------ */
ipcMain.handle('translate:run', async (e, opts = {}) => {
  let text = String(opts.text || '')
  if (opts.useAiGrammarFix && opts.aiSettings) {
    try {
      text = await intelliRewrite({ ...opts.aiSettings, mode: 'spellcheck', text })
    } catch (_) {
      // fall back to the original text if the grammar-fix pass fails
    }
  }
  return translateText({ ...opts, text })
})
ipcMain.handle('translate:providers', () => TRANSLATE_PROVIDERS)

/* ------------------------------------------------------------------ */
/* i18n                                                                 */
/* ------------------------------------------------------------------ */
ipcMain.handle('i18n:languages', () => i18n.listLanguages())
ipcMain.handle('i18n:strings', (e, lang) => i18n.getStrings(lang))

/* ------------------------------------------------------------------ */
/* Text-to-speech (SAPI / TikTok / ElevenLabs / self-hosted)           */
/* ------------------------------------------------------------------ */
ipcMain.handle('tts:speak', (e, opts) => speak(opts))
ipcMain.handle('tts:providers', () => TTS_PROVIDERS)
ipcMain.handle('tts:sapiVoices', () => listSapiVoices())

/* ------------------------------------------------------------------ */
/* Speech-to-text (cloud OpenAI/Groq + local Whisper via transformers) */
/* ------------------------------------------------------------------ */
ipcMain.handle('stt:transcribeCloud', (e, opts) => transcribeCloud(opts))
ipcMain.handle('stt:transcribeLocal', (e, opts) => transcribeLocal({
  ...opts,
  // Functions can't cross the IPC boundary from the renderer, so the
  // progress callback is built here and forwarded as an event instead -
  // matters most for medium/large/turbo, which are 1-3GB downloads on
  // first use and would otherwise look like a silent hang.
  onProgress: data => { if (data?.status === 'progress') push('stt:downloadProgress', data) }
}))
ipcMain.handle('stt:cloudProviders', () => STT_CLOUD_PROVIDERS)
ipcMain.handle('stt:localModels', () => STT_LOCAL_MODELS)

/* ------------------------------------------------------------------ */
/* Voice assistant command interpretation (wake-word body -> action)   */
/* ------------------------------------------------------------------ */
ipcMain.handle('assistant:interpret', (e, opts) => interpretCommand(opts))
ipcMain.handle('assistant:summarizeSearch', (e, opts) => summarizeSearchResults(opts))
ipcMain.handle('assistant:searchWeb', (e, { query, provider, endpoint } = {}) => searchWeb(query, { provider, endpoint }))

function runFfmpeg (args) {
  return new Promise((resolve, reject) => {
    execFile(getFfmpegBinPath(), args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || '').trim().slice(-400) || err.message))
      else resolve()
    })
  })
}

// GPU encoders this ffmpeg build might support, checked in order (Nvidia,
// then Intel Quick Sync, then AMD) - having the encoder compiled in doesn't
// guarantee matching hardware/drivers actually exist on this machine, so
// each candidate is confirmed with a throwaway 1-frame encode, not just a
// name match against `ffmpeg -encoders`. Result is cached for the process
// lifetime so this probe only ever runs once.
const GPU_ENCODERS = [
  { codec: 'h264_nvenc', args: ['-preset', 'p4', '-cq', '23'] },
  { codec: 'h264_qsv', args: ['-global_quality', '23'] },
  { codec: 'h264_amf', args: ['-quality', 'speed'] }
]
let detectedEncoderPromise = null

function encodeArgsFor (encoder, outFile) {
  if (!encoder) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outFile]
  return ['-c:v', encoder.codec, ...encoder.args, '-c:a', 'aac', '-movflags', '+faststart', outFile]
}

async function detectGpuEncoder () {
  if (!detectedEncoderPromise) {
    detectedEncoderPromise = (async () => {
      for (const encoder of GPU_ENCODERS) {
        try {
          await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=black:size=64x64:duration=0.1', '-c:v', encoder.codec, ...encoder.args, '-f', 'null', '-'])
          return encoder
        } catch (_) { /* not available on this machine, try the next */ }
      }
      return null
    })()
  }
  return detectedEncoderPromise
}

// Saves an SOS instant-replay clip to ~/Videos/NekoSuneAPPS (created if
// missing), alongside any Discord-webhook upload the assistant also does.
// The renderer records segments as mp4/h264+aac when the system's Chromium
// build exposes a hardware encoder for it (the normal case on Windows), only
// falling back to webm/vp8 on older systems without one. Segments still need
// stitching into one file (see jarvisAssistant.js's segment-rotation replay
// buffer for why), but when they're already mp4 that's a plain stream-copy
// remux - no re-encoding, negligible CPU/GPU - not a full transcode.
// Any real transcode that IS needed (webm source, or a stream-copy that
// failed) prefers a detected GPU encoder before falling back to CPU libx264.
ipcMain.handle('assistant:saveClip', async (e, { segments } = {}) => {
  if (!Array.isArray(segments) || !segments.length) throw new Error('No clip data was captured')

  const dir = path.join(app.getPath('videos'), 'NekoSuneAPPS')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tmpDir = path.join(app.getPath('temp'), `nekosune-clip-${stamp}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const isMp4 = segments.every(seg => /mp4/i.test(seg.mime || ''))
    const partExt = isMp4 ? 'mp4' : 'webm'
    const partFiles = segments.map((seg, i) => {
      const p = path.join(tmpDir, `part${i}.${partExt}`)
      fs.writeFileSync(p, Buffer.from(seg.base64 || seg, 'base64'))
      return p
    })

    const outFile = path.join(dir, `sos-clip-${stamp}.mp4`)
    const copyArgs = ['-c', 'copy', '-movflags', '+faststart', outFile]

    const inputArgs = partFiles.length === 1
      ? ['-i', partFiles[0]]
      : (() => {
          const listFile = path.join(tmpDir, 'concat.txt')
          fs.writeFileSync(listFile, partFiles.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'))
          return ['-f', 'concat', '-safe', '0', '-i', listFile]
        })()

    const transcode = async () => {
      const gpu = await detectGpuEncoder()
      try {
        await runFfmpeg(['-y', ...inputArgs, ...encodeArgsFor(gpu, outFile)])
      } catch (gpuErr) {
        if (!gpu) throw gpuErr
        await runFfmpeg(['-y', ...inputArgs, ...encodeArgsFor(null, outFile)])
      }
    }

    if (isMp4) {
      try {
        // Segments from one continuous capture stream share codec/
        // resolution, so stream-copy normally just works - transcode is
        // only a fallback for the rare case something about them didn't
        // line up.
        await runFfmpeg(['-y', ...inputArgs, ...copyArgs])
      } catch (_) {
        await transcode()
      }
    } else {
      await transcode()
    }

    return outFile
  } catch (err) {
    throw new Error(`Could not save clip: ${err.message}`)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) {}
  }
})

/* ------------------------------------------------------------------ */
/* Shared OAuth providers                                              */
/* ------------------------------------------------------------------ */
ipcMain.handle('oauth:twitchRedirect', () => TWITCH_REDIRECT)
ipcMain.handle('oauth:twitchLogin', async (e, { clientId, clientSecret, scopes }) => {
  try {
    const tokens = await loginTwitch(clientId, clientSecret, scopes)
    return { ok: true, ...tokens }
  } catch (err) { return { ok: false, error: err.message } }
})

/* ------------------------------------------------------------------ */
/* Discord RPC                                                         */
/* ------------------------------------------------------------------ */
ipcMain.handle('discord:start', async (e, cfg) => {
  const oscPort = settings.get('oscPort', 9000)
  // Discord Application ID is fixed (official NekoSuneAPPS app) — never take
  // it from renderer input, no matter what cfg claims.
  const r = await startDiscord({ ...(cfg || {}), clientId: DISCORD_APP_ID, oscPort, extraOscTargets: settings.get('extraOscTargets', []) }, s => push('discord:update', s))
  // Seed the presence with the world we've already detected.
  const w = getVrcWorld()
  setVrcContext({ worldName: w.inWorld ? w.worldName : '', joinUrl: w.joinUrl, worldUrl: w.worldUrl, profileUrl: w.profileUrl })
  return r
})
ipcMain.handle('discord:stop', async () => { await stopDiscord(); return true })
ipcMain.handle('discord:activity', (e, activity) => { updateActivity(activity); return true })
// Live VRChat status / world-visibility changes from the Discord card.
ipcMain.handle('discord:vrc', (e, ctx) => { setVrcContext(ctx || {}); return true })
ipcMain.handle('discord:live', (e, ctx) => { setVrcContext(ctx || {}); return true }) // { nowPlaying, hrBpm }
ipcMain.handle('vrc:get', () => getVrcWorld())

/* ------------------------------------------------------------------ */
/* Discord identity login (official bot + Activity status push)        */
/* ------------------------------------------------------------------ */
ipcMain.handle('oauth:discordLogin', async () => {
  try {
    const backendUrl = getNekosuneBackendUrl()
    const { sessionToken } = await loginDiscordIdentity(backendUrl)
    settings.set('discordSessionToken', sessionToken)
    startStatusPush(backendUrl, sessionToken, getVrcContextSnapshot)
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('oauth:discordLogout', async () => {
  settings.set('discordSessionToken', '')
  stopStatusPush()
  await stopOfficialBot()
  return true
})
// UI-only status check — never sends the session token itself to the renderer.
ipcMain.handle('oauth:discordLoginStatus', () => !!settings.get('discordSessionToken', ''))

/* ------------------------------------------------------------------ */
/* VRChat account — auto status detection                              */
/* ------------------------------------------------------------------ */
let vrcStatusTimer = null
async function applyVrcStatus () {
  if (vrchatApi.isRateLimited()) return
  const r = await vrchatApi.fetchUser()
  if (r.ok && r.user) {
    push('vrchat:account', { ok: true, displayName: r.user.displayName, status: r.user.status, statusDescription: r.user.statusDescription })
    setVrcContext({ vrcStatus: vrchatApi.mapStatus(r.user.status) })
  } else {
    push('vrchat:account', { ok: false, needs2fa: r.needs2fa, error: r.error })
  }
}
function startVrcStatusPoll () { stopVrcStatusPoll(); applyVrcStatus(); vrcStatusTimer = setInterval(applyVrcStatus, 60000) }
function stopVrcStatusPoll () { if (vrcStatusTimer) { clearInterval(vrcStatusTimer); vrcStatusTimer = null } }

ipcMain.handle('vrchat:login', (e, { username, password }) => vrchatApi.login(username, password))
ipcMain.handle('vrchat:verify2fa', (e, { code, method }) => vrchatApi.verify2fa(code, method))
ipcMain.handle('vrchat:status', () => vrchatApi.fetchUser())
ipcMain.handle('vrchat:isLoggedIn', () => vrchatApi.isLoggedIn())
ipcMain.handle('vrchat:logout', () => { vrchatApi.logout(); stopVrcStatusPoll(); return true })
ipcMain.handle('vrchat:autostatus', (e, on) => { if (on) startVrcStatusPoll(); else stopVrcStatusPoll(); return true })

/* Friend Den / Event Scout / Pawprints / Auto-Greeter (VRChat API) */
ipcMain.handle('vrchat:friends', () => vrchatApi.getFriends())
// Complete friend list (online + offline + reconciled stragglers) — see getAllFriends.
ipcMain.handle('vrchat:allFriends', () => vrchatApi.getAllFriends())
ipcMain.handle('vrchat:groups', () => vrchatApi.getMyGroups())
ipcMain.handle('vrchat:groupEvents', (e, groupId) => vrchatApi.getGroupEvents(groupId))
ipcMain.handle('vrchat:notifications', () => vrchatApi.getNotifications())
ipcMain.handle('vrchat:acceptFriend', (e, id) => vrchatApi.acceptFriendRequest(id))
ipcMain.handle('vrchat:user', (e, id) => vrchatApi.getUser(id))
ipcMain.handle('vrchat:friendRequest', (e, id) => vrchatApi.sendFriendRequest(id))
ipcMain.handle('vrchat:requestInvite', (e, { id, slot } = {}) => vrchatApi.requestInvite(id, slot))
ipcMain.handle('vrchat:unfriend', (e, id) => vrchatApi.unfriend(id))
ipcMain.handle('vrchat:invite', (e, { id, instanceId, slot } = {}) => vrchatApi.inviteUser(id, instanceId, slot))
ipcMain.handle('vrchat:userGroups', (e, id) => vrchatApi.getUserGroups(id))
ipcMain.handle('vrchat:userWorlds', (e, id) => vrchatApi.getUserWorlds(id))
ipcMain.handle('vrchat:mutuals', (e, id) => vrchatApi.getMutualFriends(id))
ipcMain.handle('vrchat:favWorlds', () => vrchatApi.getFavoriteWorlds())
ipcMain.handle('vrchat:favGroups', (e, type) => vrchatApi.getFavoriteGroups(type))
ipcMain.handle('vrchat:boop', (e, { id, emojiId } = {}) => vrchatApi.sendBoop(id, emojiId))
ipcMain.handle('vrchat:myAvatars', () => vrchatApi.getMyAvatars())
ipcMain.handle('vrchat:myWorlds', () => vrchatApi.getMyWorlds())
ipcMain.handle('vrchat:addFav', (e, { type, id } = {}) => vrchatApi.addFavorite(type, id))
ipcMain.handle('vrchat:removeFav', (e, id) => vrchatApi.removeFavorite(id))
ipcMain.handle('vrchat:searchUsers', (e, q) => vrchatApi.searchUsers(q))
ipcMain.handle('vrchat:searchWorlds', (e, q) => vrchatApi.searchWorlds(q))
ipcMain.handle('vrchat:searchGroups', (e, q) => vrchatApi.searchGroups(q))
ipcMain.handle('vrchat:world', (e, id) => vrchatApi.getWorld(id))
ipcMain.handle('vrchat:worldName', (e, id) => vrchatApi.getWorldName(id))
ipcMain.handle('vrchat:group', (e, id) => vrchatApi.getGroup(id))
ipcMain.handle('vrchat:updateProfile', async (e, fields) => {
  const r = await vrchatApi.updateProfile(fields || {})
  // Immediately sync Discord RPC when status changes — don't wait for the 60s poll.
  if (r.ok && fields && fields.status) setVrcContext({ vrcStatus: vrchatApi.mapStatus(fields.status) })
  return r
})
ipcMain.handle('vrchat:selectAvatar', (e, id) => vrchatApi.selectAvatar(id))
ipcMain.handle('vrchat:deleteAvatar', (e, id) => vrchatApi.deleteAvatar(id))
ipcMain.handle('vrchat:createInstance', (e, { worldId, access, region } = {}) => vrchatApi.createInstance(worldId, access, region))
ipcMain.handle('vrchat:inviteSelf', (e, location) => vrchatApi.inviteSelf(location))
ipcMain.handle('vrchat:createGroupInstance', (e, { worldId, groupId, access, region } = {}) => vrchatApi.createGroupInstance(worldId, groupId, access, region))
ipcMain.handle('vrchat:groupInvite', (e, { groupId, userId } = {}) => vrchatApi.groupInvite(groupId, userId))
ipcMain.handle('vrchat:setNote', (e, { userId, note } = {}) => vrchatApi.setNote(userId, note))
ipcMain.handle('vrchat:moderate', (e, { userId, type } = {}) => vrchatApi.moderate(userId, type))
ipcMain.handle('vrchat:unmoderate', (e, { userId, type } = {}) => vrchatApi.unmoderate(userId, type))
ipcMain.handle('vrchat:favFriendIds', () => vrchatApi.getFavoriteFriendIds())
ipcMain.handle('vrchat:messages', (e, type) => vrchatApi.getMessages(type))
ipcMain.handle('vrchat:updateMessage', (e, { type, slot, message } = {}) => vrchatApi.updateMessage(type, slot, message))
ipcMain.handle('vrchat:groupGalleries', (e, id) => vrchatApi.getGroupGalleries(id))
ipcMain.handle('vrchat:groupGalleryImages', (e, { groupId, galleryId } = {}) => vrchatApi.getGroupGalleryImages(groupId, galleryId))
ipcMain.handle('vrchat:groupPosts', (e, id) => vrchatApi.getGroupPosts(id))
ipcMain.handle('vrchat:avatar', (e, id) => vrchatApi.getAvatar(id))
ipcMain.handle('vrchat:groupMembers', (e, id) => vrchatApi.getGroupMembers(id))
ipcMain.handle('vrchat:groupRoles', (e, id) => vrchatApi.getGroupRoles(id))
ipcMain.handle('vrchat:moderations', () => vrchatApi.getModerations())
ipcMain.handle('vrchat:inventory', (e, tag) => vrchatApi.getInventory(tag))
ipcMain.handle('vrchat:prints', () => vrchatApi.getPrints())
ipcMain.handle('vrchat:image', (e, url) => vrchatApi.imageData(url))
ipcMain.handle('avatars:search', (e, { url, query, page } = {}) => avatarDb.search(url, query, page))
ipcMain.handle('avatars:defaultProviders', () => avatarDb.DEFAULT_PROVIDERS)
ipcMain.handle('app:setAutoRejoin', (e, on) => { crashGuard.setEnabled(!!on); settings.set('autoRejoin', !!on); return true })
ipcMain.handle('pawprints:list', () => pawprints.list())
ipcMain.handle('pawprints:clear', () => { pawprints.clear(); return true })

/* ------------------------------------------------------------------ */
/* History / game-log (SQLite via sql.js)                              */
/* ------------------------------------------------------------------ */
let lastPlayers = new Set()
let playersPrimed = false
let lastWorldLogged = ''
let lastVideoLogged = ''
let lastPortalSeq = 0
let worldEnteredAt = 0
function logWorldDiff (w) {
  if (!w) return
  if (!w.inWorld) {
    if (lastWorldLogged && worldEnteredAt) { gamelog.log('world', lastWorldLogged, `Left after ${Math.round((Date.now() - worldEnteredAt) / 60000)}m`, lastWorldLogged) }
    lastPlayers = new Set(); playersPrimed = false; lastWorldLogged = ''; worldEnteredAt = 0; return
  }
  if (w.worldName && w.worldName !== lastWorldLogged) {
    if (lastWorldLogged && worldEnteredAt) gamelog.log('world', lastWorldLogged, `Left after ${Math.round((Date.now() - worldEnteredAt) / 60000)}m`, lastWorldLogged)
    lastWorldLogged = w.worldName; worldEnteredAt = Date.now()
    gamelog.log('world', w.worldName, 'Entered instance', w.worldName)
  }
  const cur = new Set(w.players || [])
  if (!playersPrimed) { lastPlayers = cur; playersPrimed = true; return }
  for (const p of cur) if (!lastPlayers.has(p)) gamelog.log('join', p, 'joined', w.worldName)
  for (const p of lastPlayers) if (!cur.has(p)) gamelog.log('leave', p, 'left', w.worldName)
  lastPlayers = cur
}

let lastFriends = null // Map(id -> displayName)
let friendDiffTimer = null
async function pollFriendDiff () {
  if (!vrchatApi.isLoggedIn() || vrchatApi.isRateLimited()) return
  // Always fetch fresh: the paginated buckets can silently miss friends mid-transition,
  // causing spurious unfriend/refriend events. getAllFriends() reconciles against the
  // authoritative auth/user.friends id array so the list is stable and complete.
  vrchatApi.invalidate('friends:all')
  const r = await vrchatApi.getAllFriends()
  if (!r.ok) return
  const map = new Map()
  for (const f of (r.friends || [])) map.set(f.id, f.displayName)
  if (lastFriends === null) { lastFriends = map; return } // baseline
  for (const [id, name] of map) {
    if (!lastFriends.has(id)) gamelog.log('friend_add', name, 'New friend', '')
    else if (lastFriends.get(id) !== name) gamelog.log('name_change', name, `was "${lastFriends.get(id)}"`, '')
  }
  for (const [id, name] of lastFriends) if (!map.has(id)) gamelog.log('friend_remove', name, 'No longer friends', '')
  lastFriends = map
}
function startFriendDiff () { stopFriendDiff(); pollFriendDiff(); friendDiffTimer = setInterval(pollFriendDiff, 120000) }
function stopFriendDiff () { if (friendDiffTimer) { clearInterval(friendDiffTimer); friendDiffTimer = null } }

ipcMain.handle('history:list', (e, opts) => gamelog.list(opts || {}))
ipcMain.handle('history:clear', () => { gamelog.clear(); return true })
ipcMain.handle('history:log', (e, { type, name, detail, world } = {}) => { gamelog.log(type, name, detail, world); return true })
ipcMain.handle('history:importVrcx', (e, customPath) => {
  const p = customPath || path.join(app.getPath('appData'), 'VRCX', 'VRCX.sqlite3')
  return gamelog.importVrcx(p)
})

/* ------------------------------------------------------------------ */
/* Auto-Greeter — auto-accept friend requests                          */
/* ------------------------------------------------------------------ */
let greeterTimer = null
let greeterCfg = { enabled: false, mode: 'all', allow: [] }
async function pollGreeter () {
  if (!greeterCfg.enabled || !vrchatApi.isLoggedIn()) return
  const r = await vrchatApi.getNotifications()
  if (!r.ok) return
  for (const n of r.notifications) {
    if (n.type !== 'friendRequest') continue
    const who = String(n.senderUsername || '').toLowerCase()
    const allowed = greeterCfg.mode === 'all' || greeterCfg.allow.some(a => a && (who.includes(a) || n.senderUserId === a))
    if (!allowed) continue
    const res = await vrchatApi.acceptFriendRequest(n.id)
    if (res.ok) { gamelog.log('friend_add', n.senderUsername || 'someone', 'Auto-accepted request', ''); push('greeter:accepted', { name: n.senderUsername || 'someone' }) }
  }
}
function stopGreeter () { if (greeterTimer) { clearInterval(greeterTimer); greeterTimer = null } }
ipcMain.handle('greeter:set', (e, cfg = {}) => {
  greeterCfg = {
    enabled: !!cfg.enabled,
    mode: cfg.mode === 'list' ? 'list' : 'all',
    allow: (cfg.allow || []).map(s => String(s).toLowerCase().trim()).filter(Boolean)
  }
  stopGreeter()
  if (greeterCfg.enabled) { pollGreeter(); greeterTimer = setInterval(pollGreeter, 60000) }
  return true
})
ipcMain.handle('app:launchVRChat', () => { shell.openExternal('steam://rungameid/438100'); return true })

/* ------------------------------------------------------------------ */
/* VRChat Quick Launch — multi-profile simultaneous VRChat launching   */
/* ------------------------------------------------------------------ */
// A manually-set path (via Browse) always wins; otherwise auto-detect via
// the registered "vrchat" protocol handler (see quickLaunch.js) each time,
// since the user could move/reinstall VRChat between sessions.
async function resolveQuickLaunchExe () {
  const override = settings.get('quickLaunchExePath', '')
  if (override && fs.existsSync(override)) return override
  return quickLaunch.detectExePath()
}

// Builds the vrchat:// launch URI for a Quick Launch profile's chosen
// instance mode - Create makes one fresh instance via the existing VRChat
// API wrapper (shared by every profile in the same launch-all batch so they
// all land together), Join reuses a pasted location string, Local/None pass
// no instance arg at all.
async function buildQuickLaunchInstanceUri (instanceInfo) {
  if (!instanceInfo || instanceInfo.mode === 'none' || instanceInfo.mode === 'local') return null
  let location = instanceInfo.location || ''
  if (instanceInfo.mode === 'create') {
    if (!instanceInfo.worldId) throw new Error('No world ID set for instance creation')
    const r = await vrchatApi.createInstance(instanceInfo.worldId, instanceInfo.access, instanceInfo.region)
    if (!r.ok) throw new Error(r.error || 'Failed to create instance')
    location = r.location
  }
  return location ? `vrchat://launch?ref=vrchat.com&id=${encodeURIComponent(location)}` : null
}

ipcMain.handle('quickLaunch:resolveExe', async () => {
  const p = await resolveQuickLaunchExe()
  return { ok: !!p, path: p || '', isOverride: !!settings.get('quickLaunchExePath', '') }
})

ipcMain.handle('quickLaunch:browseExe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select VRChat executable (start_protected_game.exe)',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false }
  settings.set('quickLaunchExePath', result.filePaths[0])
  return { ok: true, path: result.filePaths[0] }
})

ipcMain.handle('quickLaunch:launch', async (e, { profile, instanceInfo } = {}) => {
  try {
    const exePath = await resolveQuickLaunchExe()
    if (!exePath) throw new Error('VRChat executable not found — set the path in Quick Launch first.')
    const uri = await buildQuickLaunchInstanceUri(instanceInfo)
    const result = quickLaunch.launch(exePath, profile, uri)
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('quickLaunch:launchAll', async (e, { profiles, instanceInfo } = {}) => {
  try {
    const exePath = await resolveQuickLaunchExe()
    if (!exePath) throw new Error('VRChat executable not found — set the path in Quick Launch first.')
    // Resolved once so every selected profile in this batch joins the same
    // instance, rather than each spawning its own fresh Create-mode instance.
    const uri = await buildQuickLaunchInstanceUri(instanceInfo)
    const results = await quickLaunch.launchAll(exePath, profiles || [], () => uri)
    return { ok: true, results }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/* ------------------------------------------------------------------ */
/* Media library / server status / configured start / data + alerts    */
/* ------------------------------------------------------------------ */
ipcMain.handle('media:photos', () => { try { return { ok: true, photos: vrcTools.listPhotos(300) } } catch (e) { return { ok: false, error: e.message } } })
ipcMain.handle('media:open', (e, p) => { shell.openPath(p); return true })

ipcMain.handle('vrchat:online', () => vrchatApi.getOnlineCount())

// Fetches and parses the VRChat blog RSS feed once. Split out so the handler
// below can retry it on transient failure before falling back to cache.
async function fetchVrchatNewsOnce () {
  const { DOMParser } = require('@xmldom/xmldom')
  const { data } = await axios.get('https://hello.vrchat.com/blog?format=rss', {
    timeout: 15000,
    responseType: 'text',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NekoSuneAPPS/1.0' }
  })
  const doc = new DOMParser({
    onError: (level, msg) => console.warn(`[vrchat:news] xml ${level}:`, msg)
  }).parseFromString(data, 'text/xml')
  const items = Array.from(doc.getElementsByTagName('item')).slice(0, 20)
  return items.map(item => {
    const get = tag => { const el = item.getElementsByTagName(tag)[0]; return el ? el.textContent.trim() : '' }
    const raw = get('description').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return { title: get('title'), link: get('link'), description: raw.slice(0, 200), date: get('pubDate') }
  })
}

// Merges incoming news items with the persisted cache, deduped by link,
// sorted newest-first, capped at 30. Call before returning to renderer so
// the list grows over time rather than resetting to whatever the RSS shows
// on each fetch.
function mergeAndCacheNews (incoming) {
  const existing = settings.get('vrchatNewsCache', [])
  const byLink = new Map()
  for (const item of existing) if (item.link) byLink.set(item.link, item)
  for (const item of incoming) if (item.link) byLink.set(item.link, item)
  const merged = [...byLink.values()]
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 30)
  settings.set('vrchatNewsCache', merged)
  return merged
}

// On-demand IPC — called by renderer on tab open / manual refresh.
ipcMain.handle('vrchat:news', async () => {
  try {
    let news
    try {
      news = await fetchVrchatNewsOnce()
    } catch (firstErr) {
      await new Promise(resolve => setTimeout(resolve, 800))
      news = await fetchVrchatNewsOnce()
    }
    const merged = mergeAndCacheNews(news)
    return { ok: true, news: merged, ts: Date.now() }
  } catch (e) {
    console.error('[vrchat:news] failed after retry:', e.message)
    const cached = settings.get('vrchatNewsCache', [])
    if (cached.length) return { ok: true, news: cached, cached: true, ts: Date.now() }
    return { ok: false, error: e.message, news: [] }
  }
})

// Background poller — runs every 5 minutes, merges new items into the cache,
// and pushes the result to the renderer so the home tab updates automatically
// without the user having to refresh or re-open the tab.
function startNewsPoller () {
  const poll = async () => {
    try {
      const news = await fetchVrchatNewsOnce()
      const merged = mergeAndCacheNews(news)
      push('home:newsUpdate', { ok: true, news: merged, ts: Date.now() })
    } catch (e) {
      console.warn('[home:news] background poll failed:', e.message)
      const cached = settings.get('vrchatNewsCache', [])
      if (cached.length) push('home:newsUpdate', { ok: true, news: cached, cached: true, ts: Date.now() })
    }
  }
  poll()
  setInterval(poll, 5 * 60 * 1000)
}

// Configured Start — launch companion apps (and optionally VRChat).
ipcMain.handle('apps:launch', (e, { paths, withVrchat } = {}) => {
  let launched = 0
  for (const p of (paths || [])) {
    if (!p) continue
    try { spawn(p, [], { detached: true, stdio: 'ignore' }).unref(); launched++ } catch (err) { console.warn('launch failed:', p, err.message) }
  }
  if (withVrchat) shell.openExternal('steam://rungameid/438100')
  return { ok: true, launched }
})

// Data export / import (settings + history) via file dialogs.
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog({ defaultPath: 'nekosuneapps-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' }
  try {
    fs.writeFileSync(r.filePath, JSON.stringify({ settings: settings.all(), history: gamelog.list({ limit: 5000 }) }, null, 2))
    return { ok: true, path: r.filePath }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancelled' }
  try {
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'))
    if (data.settings) settings.importAll(data.settings)
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

// Group alerts — poll watched groups' posts AND events, log new ones + toast.
let alertTimer = null
const lastPostByGroup = {}
const lastEventByGroup = {}
async function pollGroupAlerts () {
  if (!vrchatApi.isLoggedIn() || vrchatApi.isRateLimited()) return
  const groups = settings.get('eventGroups', [])
  for (const gid of groups) {
    const r = await vrchatApi.getGroupPosts(gid)
    if (r.ok && r.posts.length) {
      const newest = r.posts[0]
      if (lastPostByGroup[gid] && lastPostByGroup[gid] !== newest.id) {
        gamelog.log('group', newest.title || 'Group post', newest.text || '', gid)
        gamelog.upsertNotif({ id: 'grouppost_' + newest.id, ts: Date.now(), type: 'group', sender: newest.title || 'Group post', message: newest.text || '' })
        push('alert:group', { groupId: gid, title: '📣 ' + (newest.title || 'Group post'), text: newest.text })
        push('notif:update')
      }
      lastPostByGroup[gid] = newest.id
    }
    const ev = await vrchatApi.getGroupEvents(gid)
    if (ev.ok && ev.events.length) {
      const ne = ev.events[0]
      if (lastEventByGroup[gid] && lastEventByGroup[gid] !== ne.id) {
        gamelog.log('group', ne.title || 'Group event', 'New event', gid)
        gamelog.upsertNotif({ id: 'groupevent_' + ne.id, ts: Date.now(), type: 'group', sender: '📅 ' + (ne.title || 'Event'), message: ne.description || 'New event' })
        push('alert:group', { groupId: gid, title: '📅 New event: ' + (ne.title || ''), text: ne.description || '' })
        push('notif:update')
      }
      lastEventByGroup[gid] = ne.id
    }
  }
}
function startGroupAlerts () { stopGroupAlerts(); pollGroupAlerts(); alertTimer = setInterval(pollGroupAlerts, 300000) }
function stopGroupAlerts () { if (alertTimer) { clearInterval(alertTimer); alertTimer = null } }
ipcMain.handle('alerts:groupsRefresh', () => { startGroupAlerts(); return true })

// Notifications — poll, parse, cache in SQLite (persist until dismissed), toast new.
let notifTimer = null
function parseNotif (n) {
  let det = n.details
  if (typeof det === 'string') { try { det = JSON.parse(det) } catch (_) { det = {} } }
  det = det || {}
  let link = ''
  if (det.worldId) link = `https://vrchat.com/home/launch?worldId=${det.worldId}` + (det.instanceId ? `&instanceId=${encodeURIComponent(det.instanceId)}` : '')
  return { id: n.id, ts: Date.parse(n.created_at) || Date.now(), type: n.type || 'notification', sender: n.senderUsername || det.senderUsername || '', message: n.message || det.inviteMessage || '', world: det.worldName || '', link }
}
function notifText (p) {
  switch (p.type) {
    case 'friendRequest': return 'sent a friend request'
    case 'invite': return 'invited you' + (p.world ? ' to ' + p.world : '')
    case 'requestInvite': return 'requested an invite'
    case 'requestInviteResponse': return 'responded to your invite request'
    case 'inviteResponse': return 'responded to your invite'
    case 'boop': return 'booped you 👉'
    default: return p.message || p.type
  }
}
async function pollNotifications () {
  if (!vrchatApi.isLoggedIn() || vrchatApi.isRateLimited()) return
  const r = await vrchatApi.getNotifications()
  if (!r.ok) return
  const activeIds = []
  for (const n of r.notifications) {
    const p = parseNotif(n)
    if (p.id) activeIds.push(p.id)
    if (gamelog.upsertNotif(p)) push('notif:new', p)
  }
  gamelog.reconcileNotifs(activeIds)
  push('notif:update')
}
function startNotifPoll () { stopNotifPoll(); pollNotifications(); notifTimer = setInterval(pollNotifications, 60000) }
function stopNotifPoll () { if (notifTimer) { clearInterval(notifTimer); notifTimer = null } }
ipcMain.handle('notif:list', () => gamelog.listNotifs())
ipcMain.handle('notif:dismiss', async (e, id) => { await vrchatApi.hideNotification(id); gamelog.removeNotif(id, 'dismissed'); return true })
ipcMain.handle('notif:accept', async (e, id) => { const r = await vrchatApi.acceptFriendRequest(id); if (r.ok) gamelog.removeNotif(id, 'accepted'); return r })
ipcMain.handle('notif:clear', () => { gamelog.clearNotifs(); return true })
ipcMain.handle('notif:unreadCount', () => gamelog.unreadNotifCount())
ipcMain.handle('notif:markAllRead', () => { gamelog.markAllNotifsRead(); return true })

/* ------------------------------------------------------------------ */
/* Weather                                                             */
/* ------------------------------------------------------------------ */
ipcMain.handle('weather:start', (e, opts) => { startWeather(opts || {}, s => push('weather:update', s)); return true })
ipcMain.handle('weather:stop', () => { stopWeather(); return true })
ipcMain.handle('weather:get', () => getWeather())

/* ------------------------------------------------------------------ */
/* Discord BOT (voice state + DiscordOSC mute/deafen)                  */
/* ------------------------------------------------------------------ */
ipcMain.handle('bot:start', (e, cfg) => startBot(cfg || {}, s => push('bot:update', s)))
ipcMain.handle('bot:stop', async () => { await stopBot(); return true })
ipcMain.handle('bot:setMute', (e, m) => botSetMute(m))
ipcMain.handle('bot:setDeaf', (e, d) => botSetDeaf(d))
ipcMain.handle('bot:invite', (e, appId) => inviteUrl(appId))

// Official NekoSuneAPPS bot mode — no token, backed by the NekoSuneAPPS backend
// (server/) instead of a local discord.js gateway client. Requires having
// logged in via oauth:discordLogin first (session token in settings).
ipcMain.handle('bot:startOfficial', () => {
  const sessionToken = settings.get('discordSessionToken', '')
  return startOfficialBot({ backendBaseUrl: getNekosuneBackendUrl(), sessionToken }, s => push('bot:update', s))
})
ipcMain.handle('bot:stopOfficial', async () => { await stopOfficialBot(); return true })
ipcMain.handle('bot:setMuteOfficial', (e, m) => setMuteOfficial(getNekosuneBackendUrl(), settings.get('discordSessionToken', ''), m))
ipcMain.handle('bot:setDeafOfficial', (e, d) => setDeafOfficial(getNekosuneBackendUrl(), settings.get('discordSessionToken', ''), d))
// Lets renderer resolve the effective backend URL (default or self-hosted
// override) without duplicating DEFAULT_NEKOSUNE_BACKEND_URL client-side.
ipcMain.handle('nekosune:getBackendUrl', () => getNekosuneBackendUrl())

/* ------------------------------------------------------------------ */
/* Soundpad                                                            */
/* ------------------------------------------------------------------ */
ipcMain.handle('soundpad:cmd', async (e, { action, index } = {}) => {
  try {
    switch (action) {
      case 'play': await soundpad.playSound(index); break
      case 'stop': await soundpad.stopSound(); break
      case 'next': await soundpad.nextSound(); break
      case 'previous': await soundpad.previousSound(); break
      case 'random': await soundpad.randomSound(); break
      case 'pause': await soundpad.togglePause(); break
      default: return { ok: false, error: 'Unknown action' }
    }
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.handle('soundpad:list', async () => {
  try { return { ok: true, list: await soundpad.getSoundList() } } catch (err) { return { ok: false, error: err.message } }
})

/* ------------------------------------------------------------------ */
/* Media keys (SpotiOSC)                                               */
/* ------------------------------------------------------------------ */
ipcMain.handle('media:key', (e, action) => pressMediaKey(action).then(() => ({ ok: true })).catch(err => ({ ok: false, error: err.message })))

// Photo Relay (VRChat screenshots -> Discord webhook)
ipcMain.handle('photoRelay:set', (e, cfg) => { photoRelay.start(cfg || {}, s => push('photoRelay:event', s)); return true })

// Screenshot metadata (VRCX-compatible world/instance/players embedded into new screenshots)
ipcMain.handle('screenshotMetadata:set', (e, enabled) => {
  settings.set('screenshotMetadata', !!enabled)
  if (enabled) screenshotMetadata.start(); else screenshotMetadata.stop()
  return true
})

/* ------------------------------------------------------------------ */
/* VRChat maintenance tools (external/file-based — no game injection)  */
/* ------------------------------------------------------------------ */
ipcMain.handle('vrctools:ytdlp', () => vrcTools.updateYtDlp())
ipcMain.handle('vrctools:cacheSize', () => vrcTools.cacheSize())
ipcMain.handle('vrctools:clearCache', () => vrcTools.clearCache())
ipcMain.handle('vrctools:openFolder', (e, which) => {
  const p = vrcTools.folderPath(which)
  if (p) shell.openPath(p)
  return p
})
ipcMain.handle('vrctools:vvcInstall', () => vrcTools.installVideoCacher(settings.get('vvcUrl', '')))
ipcMain.handle('vrctools:vvcStart', () => vrcTools.startVideoCacher())
ipcMain.handle('vrctools:vvcStop', () => vrcTools.stopVideoCacher())
ipcMain.handle('vrctools:vvcStatus', () => vrcTools.videoCacherStatus())

/* ------------------------------------------------------------------ */
/* Startup / auto-launch                                               */
/* ------------------------------------------------------------------ */
ipcMain.handle('app:setLaunchOnLogin', (e, enabled) => {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, args: [] })
  } catch (err) { console.warn('setLoginItemSettings failed:', err.message) }
  return true
})
ipcMain.handle('app:getLaunchOnLogin', () => {
  try { return app.getLoginItemSettings().openAtLogin } catch (_) { return false }
})

/* ------------------------------------------------------------------ */
/* VR gear battery                                                     */
/* ------------------------------------------------------------------ */
ipcMain.handle('vr:start', () => {
  startVrBattery(s => push('vr:update', s))
  return true
})
ipcMain.handle('vr:stop', () => { stopVrBattery(); return true })

/* ------------------------------------------------------------------ */
/* Auto-AFK                                                            */
/* ------------------------------------------------------------------ */
ipcMain.handle('afk:start', (e, opts) => { startAfk(opts || {}, s => push('afk:update', s)); return true })
ipcMain.handle('afk:stop', () => { stopAfk(); return true })

/* ------------------------------------------------------------------ */
/* Community Ranks — NekoSuneAPPS OG ranks (Veteran / Legend), opt-in  */
/* These are independent community ranks, NOT official VRChat ranks.   */
/* ------------------------------------------------------------------ */
const ranksCfg = () => settings.get('communityRanks', { enabled: false, ogMode: true })
// Sync the local user's facts from VRChat + history, then recompute their rank.
async function refreshSelfRank () {
  if (!ranks.isReady()) return null
  try { await ranks.syncSelf() } catch (err) { console.warn('ranks sync:', err.message) }
  return ranks.recompute(ranks.localNsaId(), { ogMode: ranksCfg().ogMode !== false })
}
// Ensure the store is up when the feature is toggled on at runtime (not just boot).
async function ensureRanksReady () {
  if (ranks.isReady()) return true
  if (!ranksCfg().enabled) return false
  return ranks.init(app.getPath('userData')).catch(() => false)
}

// Estimate a community rank from any user's VRChat trust tags + join date (pure;
// works even when the feature is off — the renderer decides whether to display it).
ipcMain.handle('ranks:estimate', (e, { tags, dateJoined } = {}) =>
  ranks.engine.estimateFromTags(tags || [], { ogMode: ranksCfg().ogMode !== false, joinYear: ranks.engine.joinYearOf(dateJoined) }))
ipcMain.handle('ranks:config', () => ranksCfg())
ipcMain.handle('ranks:setConfig', async (e, cfg = {}) => {
  const cur = ranksCfg()
  const next = { ...cur, ...cfg, enabled: !!(cfg.enabled ?? cur.enabled), ogMode: !!(cfg.ogMode ?? cur.ogMode) }
  settings.set('communityRanks', next)
  if (next.enabled) { await ensureRanksReady(); await refreshSelfRank(); push('ranks:update', ranks.getRank(ranks.localNsaId(), { ogMode: next.ogMode })) }
  return next
})
// Current stored rank for the local user (no recompute unless first run).
ipcMain.handle('ranks:get', async () => {
  if (!(await ensureRanksReady())) return { enabled: false }
  return ranks.getRank(ranks.localNsaId(), { ogMode: ranksCfg().ogMode !== false }) || { enabled: true, rank: null }
})
// Force a fresh sync + recompute (the "Refresh my rank" button).
ipcMain.handle('ranks:refresh', async () => {
  if (!(await ensureRanksReady())) return { enabled: false }
  const r = await refreshSelfRank()
  push('ranks:update', r)
  return r
})
ipcMain.handle('ranks:leaderboard', async (e, limit) => {
  if (!(await ensureRanksReady())) return []
  return ranks.leaderboard(limit)
})
// Log a contribution for the local user (enters as 'pending' until verified).
ipcMain.handle('ranks:contribution', async (e, { type, description, evidenceUrl } = {}) => {
  if (!(await ensureRanksReady())) return { ok: false, error: 'disabled' }
  const user = ranks.db.getUser(ranks.localNsaId()) || (await ranks.syncSelf())
  if (!user) return { ok: false, error: 'no user' }
  const points = require('./modules/ranks/rankApi').CONTRIB_POINTS[type]
  if (points == null) return { ok: false, error: 'unknown type' }
  const id = ranks.db.addContribution(user.id, { type, points, description, evidenceUrl, status: 'pending' })
  return { ok: true, id, status: 'pending', provisionalPoints: points }
})
ipcMain.handle('ranks:history', async () => {
  if (!(await ensureRanksReady())) return []
  const user = ranks.db.getUser(ranks.localNsaId())
  return user ? ranks.db.history(user.id, 50) : []
})

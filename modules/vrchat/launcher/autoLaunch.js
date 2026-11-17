// modules/vrchat/launcher/autoLaunch.js
// Auto-launch apps with VRChat (like VRCX's "Auto App Launcher"): when
// VRChat.exe starts, start the user's chosen programs — all of them, or only
// in VR / only in Desktop mode — and optionally close them again when VRChat
// exits. Programs already running aren't started twice. Windows; MAIN process.
//
// App entry: { id, path, args: string[], mode: 'always'|'vr'|'desktop', closeWithVRChat, enabled }
// Paths are only ever added through the main-process file picker (see main.js).

const { execFile, spawn } = require('child_process')
const path = require('path')

const POLL_MS = 10000

// ---- default OS hooks (Windows) ----
function isVrchatRunning (cb) {
  execFile('tasklist', ['/FI', 'IMAGENAME eq VRChat.exe', '/NH'], { windowsHide: true }, (err, out) => cb(!err && /VRChat\.exe/i.test(out || '')))
}
function isExeRunning (exeName, cb) {
  execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true }, (err, out) => cb(!err && String(out || '').toLowerCase().includes(exeName.toLowerCase())))
}
function spawnApp (app) {
  // Shortcuts (.lnk / .url) and non-exe files go through the shell: no pid, so
  // they can't be closed with VRChat.
  if (!/\.exe$/i.test(app.path)) {
    try { require('electron').shell.openPath(app.path) } catch (_) {}
    return 0
  }
  const child = spawn(app.path, Array.isArray(app.args) ? app.args : [], { cwd: path.dirname(app.path), detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', err => console.warn('[autolaunch] failed to start', app.path, err.message))
  child.unref()
  return child.pid || 0
}
function killTree (pid) {
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
}

function createAutoLauncher ({
  getApps, detectMode = cb => cb(''), onLog,
  hooks = { isVrchatRunning, isExeRunning, spawnApp, killTree }
} = {}) {
  let timer = null
  let wasRunning = null // null = unknown (first tick doesn't launch for an already-running VRChat)
  let started = [] // { id, pid } launched for the current VRChat session
  const log = m => { if (typeof onLog === 'function') onLog(m) }

  function launchFor (mode) {
    const apps = (getApps() || []).filter(a => a && a.enabled !== false && a.path)
    for (const app of apps) {
      const want = app.mode || 'always'
      if (want !== 'always' && mode && want !== mode) continue
      if (want !== 'always' && !mode) continue // mode unknown: only "always" apps
      const exe = path.win32.basename(app.path)
      hooks.isExeRunning(exe, running => {
        if (running && /\.exe$/i.test(exe)) { log(`${exe} already running`); return }
        const pid = hooks.spawnApp(app)
        if (pid) started.push({ id: app.id, pid, close: !!app.closeWithVRChat })
        log(`Started ${exe}`)
      })
    }
  }

  function closeStarted () {
    for (const s of started) if (s.close) { hooks.killTree(s.pid); log(`Closed pid ${s.pid}`) }
    started = []
  }

  function tick () {
    hooks.isVrchatRunning(running => {
      if (wasRunning === false && running) detectMode(mode => launchFor(mode))
      if (wasRunning && !running) closeStarted()
      wasRunning = running
    })
  }

  return {
    start () { if (timer) return; if (process.platform !== 'win32' && hooks.isVrchatRunning === isVrchatRunning) return; tick(); timer = setInterval(tick, POLL_MS) },
    stop () { if (timer) { clearInterval(timer); timer = null } wasRunning = null },
    tick,
    launchNow: mode => launchFor(mode),
    _started: () => started.slice()
  }
}

module.exports = { createAutoLauncher }

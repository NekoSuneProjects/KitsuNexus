// modules/integrations/maintenance/updater.js
// Update checker + installer launcher for KitsuNexus - asks the GitHub
// Releases API for the latest release and compares it to the running
// version. The actual update is handled by a fully separate helper app
// (updater/ - its own little Electron app, packaged as updater.exe on
// Windows / bundled inside the .app on Mac / alongside the binary on Linux)
// with its own branded window: it downloads the release asset with a real
// progress bar, installs it, and relaunches KitsuNexus - all of it has to
// live outside this app's own files, since it's the thing replacing them.
// This module's only job is finding that helper and handing off to it.
// Runs in the MAIN process.

const axios = require('axios')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { spawn } = require('child_process')

const REPO = 'NekoSuneProjects/KitsuNexus'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`
const UPDATE_PAYLOAD_ENV = 'KITSUNEXUS_UPDATE_PAYLOAD'
const EXTERNAL_UPDATER_VERSION = '1.0.3'
const UPDATER_READY_TIMEOUT_MS = 30000

// Compare dotted versions; returns >0 if a>b, <0 if a<b, 0 if equal.
function cmp (a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

// The asset the standalone updater actually installs, one per platform.
// Windows: prefer the NSIS Setup installer because per-machine installs under
// Program Files require elevation. The zip remains a fallback for portable
// installs that live in a user-writable directory.
// MSI is intentionally avoided here — msiexec installs to its own default
// path and won't update an existing NSIS install, so the relaunch would
// re-open the old binary instead of the new one.
function pickUpdateAsset (assets) {
  const pick = re => assets.find(a => re.test(a.name || ''))
  if (process.platform === 'win32') return pick(/Setup.*\.exe$/i) || pick(/\.zip$/i) || pick(/\.exe$/i) || pick(/\.msi$/i)
  if (process.platform === 'darwin') return pick(/\.zip$/i)
  if (process.platform === 'linux') return pick(/\.appimage$/i) || pick(/\.deb$/i)
  return null
}

async function check (currentVersion) {
  try {
    const { data } = await axios.get(API, {
      timeout: 12000,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KitsuNexus-Updater' }
    })
    const latest = String(data.tag_name || data.name || '').replace(/^v/i, '')
    if (!latest) return { ok: true, available: false, current: currentVersion }
    const assets = Array.isArray(data.assets) ? data.assets : []
    // Manual open-in-browser fallback (used if the platform's update asset
    // wasn't published, or the standalone updater can't be found/launched).
    const pick = re => assets.find(a => re.test(a.name || ''))
    const installer = pick(/Setup.*\.exe$/i) || pick(/\.exe$/i) || pick(/\.msi$/i) || pick(/\.dmg$/i) || pick(/\.appimage$/i)
    const updateAsset = pickUpdateAsset(assets)
    return {
      ok: true,
      available: cmp(latest, currentVersion) > 0,
      current: currentVersion,
      latest,
      notes: String(data.body || '').slice(0, 4000),
      url: data.html_url || RELEASES_PAGE,
      installerUrl: installer ? installer.browser_download_url : (data.html_url || RELEASES_PAGE),
      updateAssetUrl: updateAsset ? updateAsset.browser_download_url : null,
      updateAssetName: updateAsset ? updateAsset.name : null,
      updateAssetSize: updateAsset ? updateAsset.size : null
    }
  } catch (err) {
    return { ok: false, error: err.message, current: currentVersion }
  }
}

function localAppDataRoot () {
  return process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || process.env.HOME || path.dirname(process.execPath), 'AppData', 'Local')
}

function externalUpdaterPath () {
  if (process.platform !== 'win32') return null
  return path.join(localAppDataRoot(), 'KitsuNexus', 'Update.exe')
}

function bundledUpdaterPath () {
  if (process.platform !== 'win32') return null
  const candidates = [
    path.join(process.resourcesPath || '', 'updater', 'updater.exe'),
    path.join(path.dirname(process.execPath), 'updater.exe')
  ]
  return candidates.find(p => p && fs.existsSync(p)) || null
}

// Install the updater outside the app install directory (Discord-style under
// %LOCALAPPDATA%) so normal app updates can replace Program Files/app-* content
// without touching the running helper. A sidecar version marker lets a newly
// installed KitsuNexus build refresh an older external helper before launching
// it. If the helper is still running, the copy fails safely and is retried the
// next time an update starts.
function ensureExternalUpdater () {
  if (process.platform !== 'win32') return null
  const target = externalUpdaterPath()
  const source = bundledUpdaterPath()
  if (!target) return null
  if (!source) return fs.existsSync(target) ? target : null

  const versionMarker = `${target}.version`
  let installedVersion = ''
  try { installedVersion = fs.readFileSync(versionMarker, 'utf8').trim() } catch (_) {}
  if (fs.existsSync(target) && installedVersion === EXTERNAL_UPDATER_VERSION) return target

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  fs.writeFileSync(versionMarker, `${EXTERNAL_UPDATER_VERSION}\n`, 'utf8')
  return target
}

// Where the standalone updater helper lives, per platform/build state. Dev
// (unpackaged) runs use the local electron binary pointed at the updater's
// own main.js directly, since there's no built updater.exe yet in that case.
function resolveUpdaterLaunch (appRootDir, isPackaged) {
  if (!isPackaged) {
    return { cmd: process.execPath, args: [path.join(appRootDir, 'updater', 'main.js')] }
  }
  if (process.platform === 'win32') {
    return { cmd: externalUpdaterPath(), args: [] }
  }
  if (process.platform === 'darwin') {
    const resourcesPath = process.resourcesPath
    return { cmd: path.join(resourcesPath, 'KitsuNexus Updater.app', 'Contents', 'MacOS', 'KitsuNexus Updater'), args: [] }
  }
  if (process.platform === 'linux') {
    return { cmd: path.join(process.resourcesPath, 'updater', 'KitsuNexus-updater'), args: [] }
  }
  return null
}

function updaterSignalPaths (token) {
  if (!/^[a-f0-9]{32}$/i.test(String(token || ''))) return null
  const base = path.join(os.tmpdir(), `kitsunexus-updater-${token}`)
  return { ready: `${base}.ready`, ack: `${base}.ack` }
}

function removeUpdaterSignals (signals) {
  if (!signals) return
  for (const file of [signals.ready, signals.ack]) {
    try { fs.unlinkSync(file) } catch (_) {}
  }
}

// Launches the standalone updater with everything it needs, then quits this
// process - it has to, since the updater is about to replace its files. The
// payload travels through the environment instead of launcher command-line
// switches, and Electron-only environment overrides are sanitized before the
// helper starts. A ready/ack file handshake also proves the real
// extracted updater window is alive before KitsuNexus exits (the Windows
// portable wrapper's own `spawn` event is not sufficient).
function startUpdate ({ url, name, version, appRootDir, isPackaged, execPath, pid }, quitApp) {
  const launch = resolveUpdaterLaunch(appRootDir, isPackaged)
  if (!launch) throw new Error(`No update helper available for platform "${process.platform}"`)
  if (isPackaged && process.platform === 'win32') ensureExternalUpdater()
  if (isPackaged && !fs.existsSync(launch.cmd)) {
    throw new Error('Update helper is missing from this install (Update.exe not found in LocalAppData)')
  }

  const readyToken = crypto.randomBytes(16).toString('hex')
  const signals = updaterSignalPaths(readyToken)
  removeUpdaterSignals(signals)
  const payload = JSON.stringify({
    url,
    exe: execPath,
    name: name || 'KitsuNexus-Update',
    version: version || '',
    pid,
    readyToken
  })

  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, [UPDATE_PAYLOAD_ENV]: payload }
    // Developer shells and automation can export this for Electron-based
    // tooling. If inherited, it turns Update.exe into plain Node and app.asar
    // never starts at all.
    delete childEnv.ELECTRON_RUN_AS_NODE
    const child = spawn(launch.cmd, launch.args, {
      detached: true,
      stdio: 'ignore',
      env: childEnv
    })
    let settled = false
    let readyTimer = null

    const fail = err => {
      if (settled) return
      settled = true
      if (readyTimer) clearTimeout(readyTimer)
      removeUpdaterSignals(signals)
      reject(err)
    }

    child.once('error', err => {
      if (!settled) fail(err)
      else console.warn('Updater process error after launch:', err.message)
    })
    child.once('spawn', () => {
      const deadline = Date.now() + UPDATER_READY_TIMEOUT_MS
      const checkReady = () => {
        if (settled) return
        if (signals && fs.existsSync(signals.ready)) {
          try {
            fs.writeFileSync(signals.ack, `${process.pid}\n`, 'utf8')
          } catch (err) {
            fail(new Error(`Could not acknowledge the update helper: ${err.message}`))
            return
          }
          settled = true
          child.unref()
          resolve(child.pid)
          quitApp()
          return
        }
        if (Date.now() >= deadline) {
          fail(new Error('Update.exe started but its updater window did not become ready. KitsuNexus was left open.'))
          return
        }
        readyTimer = setTimeout(checkReady, 100)
      }
      checkReady()
    })
  })
}

// Static collaborators who may not yet appear in GitHub's contributor API
// (e.g. contributors via fork/PR before merge, or invited collaborators).
const STATIC_COLLABORATORS = [
  { login: 'FumikoEcho', url: 'https://github.com/FumikoEcho', avatar: 'https://github.com/FumikoEcho.png', commits: 0 }
]

// Auto-detect contributors/collaborators from the GitHub repo (for the About page).
async function contributors () {
  try {
    const { data } = await axios.get(`https://api.github.com/repos/${REPO}/contributors?per_page=30`, {
      timeout: 12000, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KitsuNexus-About' }
    })
    if (!Array.isArray(data)) return { ok: true, contributors: STATIC_COLLABORATORS }
    const fromApi = data
      .filter(c => c.type === 'User' && !/\[bot\]$/i.test(c.login || ''))
      .map(c => ({ login: c.login, url: c.html_url, avatar: c.avatar_url, commits: c.contributions }))
    // Merge: keep API entries (authoritative commit count), append static ones not already present.
    const seen = new Set(fromApi.map(c => c.login.toLowerCase()))
    const merged = [...fromApi, ...STATIC_COLLABORATORS.filter(c => !seen.has(c.login.toLowerCase()))]
    return { ok: true, contributors: merged }
  } catch (err) {
    // Offline/error — still show static collaborators so the tab isn't empty.
    return { ok: true, contributors: STATIC_COLLABORATORS, error: err.message }
  }
}

module.exports = { check, cmp, contributors, startUpdate, resolveUpdaterLaunch, ensureExternalUpdater, externalUpdaterPath, updaterSignalPaths, UPDATE_PAYLOAD_ENV, EXTERNAL_UPDATER_VERSION, RELEASES_PAGE }

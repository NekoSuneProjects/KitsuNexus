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
const { spawn } = require('child_process')

const REPO = 'NekoSuneProjects/KitsuNexus'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`
const EXTERNAL_UPDATER_VERSION = '1.0.1'

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
// Windows: prefer the app zip when published, then the NSIS .exe Setup
// installer (runs with /S for a silent in-place upgrade to the same directory
// the user originally chose). The portable .exe is a manual fallback only.
// MSI is intentionally avoided here — msiexec installs to its own default
// path and won't update an existing NSIS install, so the relaunch would
// re-open the old binary instead of the new one.
function pickUpdateAsset (assets) {
  const pick = re => assets.find(a => re.test(a.name || ''))
  if (process.platform === 'win32') return pick(/\.zip$/i) || pick(/Setup.*\.exe$/i) || pick(/\.exe$/i) || pick(/\.msi$/i)
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

// Launches the standalone updater with everything it needs, then quits this
// process - it has to, since the updater is about to replace its files.
function startUpdate ({ url, name, version, appRootDir, isPackaged, execPath, pid }, quitApp) {
  const launch = resolveUpdaterLaunch(appRootDir, isPackaged)
  if (!launch) throw new Error(`No update helper available for platform "${process.platform}"`)
  if (isPackaged && process.platform === 'win32') ensureExternalUpdater()
  if (isPackaged && !fs.existsSync(launch.cmd)) {
    throw new Error('Update helper is missing from this install (Update.exe not found in LocalAppData)')
  }

  const cliArgs = [
    ...launch.args,
    `--url=${url}`,
    `--exe=${execPath}`,
    `--name=${name || 'KitsuNexus-Update'}`,
    `--version=${version || ''}`,
    `--pid=${pid}`
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(launch.cmd, cliArgs, { detached: true, stdio: 'ignore' })
    let launched = false
    child.once('error', err => {
      if (!launched) reject(err)
      else console.warn('Updater process error after launch:', err.message)
    })
    child.once('spawn', () => {
      launched = true
      child.unref()
      resolve(child.pid)
      quitApp()
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

module.exports = { check, cmp, contributors, startUpdate, resolveUpdaterLaunch, ensureExternalUpdater, externalUpdaterPath, EXTERNAL_UPDATER_VERSION, RELEASES_PAGE }

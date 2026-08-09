// modules/integrations/ton/tonManager.js
// Manage the external ToNSaveManager app from inside KitsuNexus — the same job
// as ChrisFeline's update.bat, but built in: download the latest release zip,
// extract it, run the exe in the background, stop it, and update it. We connect to
// it over its local WebSocket API (see tonModule.js); we do not modify the exe.
// Windows-only (ToNSaveManager is a Windows app). Runs in the MAIN process.

const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { spawn, execFile } = require('child_process')

const REPO = 'ChrisFeline/ToNSaveManager'
const ZIP = 'ToNSaveManager.zip'
const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/${ZIP}`
const EXE_NAME = 'ToNSaveManager.exe'

let baseDir = ''
let exePath = ''
let busy = false

const wait = ms => new Promise(r => setTimeout(r, ms))

function init (userDataDir) {
  baseDir = path.join(userDataDir || '.', 'ToNSaveManager')
  exePath = path.join(baseDir, EXE_NAME)
  try { fs.mkdirSync(baseDir, { recursive: true }) } catch (_) {}
}

// True if a ToNSaveManager.exe process is currently running (ours or the user's).
function isRunning () {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise(res => {
    try {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${EXE_NAME}`, '/NH'], (err, out) => res(!err && new RegExp(EXE_NAME, 'i').test(out || '')))
    } catch (_) { res(false) }
  })
}

// taskkill every ToNSaveManager.exe (mirrors the update.bat's first line).
function killAll () {
  if (process.platform !== 'win32') return Promise.resolve()
  return new Promise(res => { try { execFile('taskkill', ['/IM', EXE_NAME, '/F'], () => res()) } catch (_) { res() } })
}

function extract (zipPath, dest) {
  return new Promise((res, rej) => {
    execFile('powershell.exe',
      ['-NoLogo', '-NonInteractive', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${dest}' -Force`],
      { windowsHide: true, timeout: 300000 },
      err => err ? rej(err) : res())
  })
}

// Download (install or update) the latest release. Stops any running instance
// first so the exe can be overwritten, then optionally relaunches it.
async function install (url) {
  if (process.platform !== 'win32') return { ok: false, error: 'ToNSaveManager is Windows-only.' }
  if (busy) return { ok: false, error: 'Already downloading…' }
  busy = true
  try {
    const wasRunning = await isRunning()
    await killAll()
    await wait(800)
    fs.mkdirSync(baseDir, { recursive: true })
    const res = await axios.get(url || DOWNLOAD_URL, { responseType: 'arraybuffer', timeout: 600000, maxRedirects: 5, headers: { 'User-Agent': 'KitsuNexus' } })
    const zipPath = path.join(baseDir, ZIP)
    fs.writeFileSync(zipPath, Buffer.from(res.data))
    await extract(zipPath, baseDir)
    try { fs.unlinkSync(zipPath) } catch (_) {}
    const ok = fs.existsSync(exePath)
    if (ok && wasRunning) await start() // restore the running state after an update
    return { ok, path: exePath, bytes: res.data.byteLength }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    busy = false
  }
}

// Launch in the background (detached + unref so it keeps running independently;
// windowsHide keeps it from stealing focus — it lives in the tray per its own settings).
async function start () {
  if (process.platform !== 'win32') return { ok: false, error: 'ToNSaveManager is Windows-only.' }
  if (!fs.existsSync(exePath)) return { ok: false, error: 'Not installed — run Install first.' }
  if (await isRunning()) return { ok: true, already: true }
  try {
    const child = spawn(exePath, [], { cwd: baseDir, detached: true, windowsHide: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, pid: child.pid }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function stop () {
  await killAll()
  return { ok: true }
}

async function update () { return install() }

// Ensure it's installed (download if missing) and running — for auto-launch on app start.
async function ensureRunning () {
  if (!fs.existsSync(exePath)) { const r = await install(); if (!r.ok) return r }
  return start()
}

async function status () {
  return { ok: true, installed: fs.existsSync(exePath), running: await isRunning(), path: exePath, dir: baseDir }
}

module.exports = { init, install, update, start, stop, status, ensureRunning, isRunning }

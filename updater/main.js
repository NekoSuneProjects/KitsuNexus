// updater/main.js
// Standalone update helper — spawned by the main app just before it quits,
// runs entirely outside the main app's files so it can replace them.
// Downloads the release asset, cleanly uninstalls the old version, installs
// the new one, then relaunches. Each step is reported to the renderer window
// in real time.
//
// Windows: uses the NSIS Setup .exe.
//   - Install info (dir + uninstall path) is read from the registry BEFORE
//     uninstalling, then the uninstaller runs /S, then the new installer runs
//     /S /D=<originalDir> so it lands in exactly the same place.
//   - NSIS is launched with Windows ShellExecute semantics so its own manifest
//     owns UAC elevation. The helper watches installed files instead of
//     trusting the short-lived setup stub's exit event.
//
// Mac / Linux paths are implemented from documented platform behaviour but
// have NOT been verified on a real machine of either OS.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const { spawn, execFile } = require('child_process')

const UPDATE_PAYLOAD_ENV = 'KITSUNEXUS_UPDATE_PAYLOAD'
const UPDATER_ACK_TIMEOUT_MS = 45000
const NSIS_OPERATION_TIMEOUT_MS = 300000
const STARTUP_LOG = path.join(os.tmpdir(), 'KitsuNexus-updater-startup.log')

function startupLog (message) {
  try { fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} pid=${process.pid} ${message}\n`, 'utf8') } catch (_) {}
}

process.on('uncaughtException', err => startupLog(`uncaughtException: ${err && (err.stack || err.message)}`))
process.on('unhandledRejection', err => startupLog(`unhandledRejection: ${err && (err.stack || err.message || err)}`))
startupLog(`start packaged=${app.isPackaged} payload=${process.env[UPDATE_PAYLOAD_ENV] ? 'present' : 'missing'}`)

// Only one updater window at a time — a previous attempt that got stuck must
// not block a fresh one.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
startupLog(`singleInstanceLock=${hasSingleInstanceLock}`)
if (!hasSingleInstanceLock) app.quit()

function parseArgs (argv) {
  const out = {}
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function parseUpdatePayload (argv, env = process.env) {
  const legacyArgs = parseArgs(argv)
  const rawPayload = env[UPDATE_PAYLOAD_ENV]
  if (!rawPayload) return legacyArgs
  try {
    const payload = JSON.parse(rawPayload)
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...legacyArgs, ...payload }
      : legacyArgs
  } catch (_) {
    return legacyArgs
  }
}

const args = parseUpdatePayload(process.argv.slice(app.isPackaged ? 1 : 2))
delete process.env[UPDATE_PAYLOAD_ENV]
const { url, exe: exePath, name: fileName = 'KitsuNexus-Update.exe', version = '', pid, readyToken } = args
startupLog(`payloadParsed url=${!!url} exe=${!!exePath} readyToken=${!!readyToken}`)

let mainWindow = null

function send (channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function updaterSignalPaths (token) {
  if (!/^[a-f0-9]{32}$/i.test(String(token || ''))) return null
  const base = path.join(os.tmpdir(), `kitsunexus-updater-${token}`)
  return { ready: `${base}.ready`, ack: `${base}.ack` }
}

async function signalReadyAndWaitForAck () {
  if (!readyToken) return true // Backward-compatible direct/manual launch.
  const signals = updaterSignalPaths(readyToken)
  if (!signals) return false
  try {
    for (const file of [signals.ready, signals.ack]) {
      try { fs.unlinkSync(file) } catch (_) {}
    }
    fs.writeFileSync(signals.ready, `${process.pid}\n`, 'utf8')
  } catch (_) {
    return false
  }

  const deadline = Date.now() + UPDATER_ACK_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (fs.existsSync(signals.ack)) {
      for (const file of [signals.ready, signals.ack]) {
        try { fs.unlinkSync(file) } catch (_) {}
      }
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  for (const file of [signals.ready, signals.ack]) {
    try { fs.unlinkSync(file) } catch (_) {}
  }
  return false
}

function waitForPidExit (targetPid, timeoutMs = 30000) {
  if (!targetPid) return Promise.resolve()
  const pidNum = parseInt(targetPid, 10)
  if (!Number.isFinite(pidNum) || pidNum <= 0) return Promise.resolve()
  const start = Date.now()
  return new Promise(resolve => {
    const check = () => {
      let alive = true
      try { process.kill(pidNum, 0) } catch (_) { alive = false }
      if (!alive || Date.now() - start > timeoutMs) return resolve()
      setTimeout(check, 300)
    }
    check()
  })
}

// Polls the rename-to-self trick as a "is the file handle free yet" check.
// Even after the tracked PID exits, Windows can hold the exe open briefly
// (final handle teardown, AV scanning, etc.).
function waitUntilFileUnlocked (targetPath, attempts = 12, intervalMs = 300) {
  return new Promise(resolve => {
    if (!targetPath || !fs.existsSync(targetPath)) return resolve()
    let tries = 0
    const check = () => {
      try { fs.renameSync(targetPath, targetPath); resolve() }
      catch (_) {
        tries++
        if (tries >= attempts) return resolve()
        setTimeout(check, intervalMs)
      }
    }
    check()
  })
}

function download (fromUrl, toPath, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (u, redirectsLeft) => {
      https.get(u, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'))
          res.resume()
          return request(res.headers.location, redirectsLeft - 1)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        }
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        const writer = fs.createWriteStream(toPath)
        res.on('data', chunk => { received += chunk.length; onProgress({ received, total }) })
        res.pipe(writer)
        writer.on('finish', () => writer.close(resolve))
        writer.on('error', reject)
        res.on('error', reject)
      }).on('error', reject)
    }
    request(fromUrl, 5)
  })
}

// execFile wrapper — used for non-NSIS operations (Mac ditto/mv/rm, Linux
// AppImage copy, etc.) where elevation isn't involved.
function runFile (cmd, cmdArgs, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, cmdArgs, opts || {}, (err, _stdout, stderr) => {
      if (err) { err.stderrText = String(stderr || '').trim(); reject(err) }
      else resolve()
    })
  })
}

// ── Windows-only helpers ──────────────────────────────────────────────────────

// Returns only main-app process names. The standalone updater is deliberately
// excluded: it must stay alive after KitsuNexus exits so it can perform the
// download/install/relaunch flow.
function mainAppProcessNames (targetExePath) {
  const names = new Set(['NekoSuneAPPS', 'KitsuNexus'])
  const targetName = path.basename(targetExePath || '', path.extname(targetExePath || ''))
  if (targetName && !/updat(?:e|er)/i.test(targetName) && !/^electron$/i.test(targetName)) {
    names.add(targetName)
  }
  return [...names]
}

// Kills only exact KitsuNexus main-app image names so files aren't locked.
// The separate "KitsuNexus Updater.exe" image is deliberately not a match.
async function killRunningInstances (targetExePath = exePath) {
  if (process.platform !== 'win32') return
  await Promise.all(mainAppProcessNames(targetExePath).map(name =>
    new Promise(resolve => {
      execFile('taskkill.exe', ['/F', '/IM', `${name}.exe`], { timeout: 10000 }, () => resolve())
    })
  ))
  await new Promise(resolve => setTimeout(resolve, 500))
}

// `cmd start` uses Windows ShellExecute semantics, allowing the NSIS manifest
// to request UAC from this non-elevated Electron helper. The destination is
// kept as one quoted argument so a path such as C:\Program Files\KitsuNexus is
// not truncated to C:\Program.
function launchNsis (installerPath, nsisArgs) {
  const values = [installerPath, ...nsisArgs]
  if (values.some(value => /["\r\n]/.test(String(value)))) {
    return Promise.reject(new Error('The installer path contains unsupported command-line characters.'))
  }
  const commandArgs = nsisArgs.map(value => {
    const arg = String(value)
    return /^\/D=/i.test(arg) ? `"${arg}"` : arg
  })
  const command = `start "" "${installerPath}" ${commandArgs.join(' ')}`.trim()

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve(child)
      else reject(new Error(`Windows could not launch the installer (exit code ${code}).`))
    })
  })
}

async function waitForCondition (check, timeoutMs, errorMessage, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(errorMessage)
}

async function waitForUninstallComplete (uninstallExe, targetExePath) {
  await waitForCondition(
    () => !fs.existsSync(uninstallExe) && (!targetExePath || !fs.existsSync(targetExePath)),
    NSIS_OPERATION_TIMEOUT_MS,
    'The old version was not removed. Approve the Windows UAC prompt, then retry.'
  )
}

async function waitForInstallComplete (targetExePath) {
  // app.asar is the largest payload and the uninstaller is written near the
  // end. Requiring both to remain stable prevents a premature relaunch.
  const installDir = path.dirname(targetExePath)
  const appAsar = path.join(installDir, 'resources', 'app.asar')
  let previousSignature = ''
  let stablePolls = 0

  await waitForCondition(() => {
    if (!fs.existsSync(targetExePath) || !fs.existsSync(appAsar)) {
      previousSignature = ''
      stablePolls = 0
      return false
    }
    const uninstaller = fs.readdirSync(installDir)
      .find(name => /^Uninstall .+\.exe$/i.test(name))
    if (!uninstaller) return false

    const signature = [targetExePath, appAsar, path.join(installDir, uninstaller)]
      .map(file => {
        const stat = fs.statSync(file)
        return `${stat.size}:${stat.mtimeMs}`
      })
      .join('|')
    stablePolls = signature === previousSignature ? stablePolls + 1 : 0
    previousSignature = signature
    return stablePolls >= 5
  }, NSIS_OPERATION_TIMEOUT_MS, 'The new version did not finish installing. Approve the Windows UAC prompt, then retry.')

  await waitUntilFileUnlocked(targetExePath, 20, 250)
}

function parseUninstallCommand (rawValue) {
  const raw = String(rawValue || '').trim()
  const quotedExe = raw.match(/^"([^"]+\.exe)"/i)
  const plainExe = raw.match(/^(.+?\.exe)(?:\s|$)/i)
  const exe = (quotedExe && quotedExe[1]) || (plainExe && plainExe[1]) || ''
  const args = []
  if (/\s\/allusers(?:\s|$)/i.test(raw)) args.push('/allusers')
  else if (/\s\/currentuser(?:\s|$)/i.test(raw)) args.push('/currentuser')
  return { exe, args }
}

// Reads the current installation's directory and uninstall-string from the
// Windows registry in a single PowerShell call. Must be called BEFORE
// uninstalling (those keys are removed by the uninstaller).
async function findNsisInstallInfo () {
  if (process.platform !== 'win32') return {}
  try {
    const { stdout } = await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "@('HKLM','HKCU') | ForEach-Object {" +
        "  Get-ItemProperty" +
        "  \"${_}:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"," +
        "  \"${_}:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"" +
        "  -ErrorAction SilentlyContinue" +
        "} | Where-Object { $_.DisplayName -like '*NekoSuneAPPS*' -or $_.DisplayName -like '*KitsuNexus*' }" +
        " | Select-Object -First 1 -Property InstallLocation,UninstallString" +
        " | ConvertTo-Json -Compress"
      ], { timeout: 15000 }, (e, out) => e ? reject(e) : resolve({ stdout: out }))
    )
    const json = stdout.trim()
    if (!json) return {}
    const obj = JSON.parse(json)
    const registryInstallDir = (obj.InstallLocation || '').trim() || null
    // UninstallString can include a quoted path plus /allusers or /currentuser.
    const rawUninstall = (obj.UninstallString || '').trim()
    const parsedUninstall = parseUninstallCommand(rawUninstall)
    const uninstallExe = (parsedUninstall.exe && fs.existsSync(parsedUninstall.exe)) ? parsedUninstall.exe : null
    const uninstallArgs = parsedUninstall.args
    const installDir = registryInstallDir || (uninstallExe ? path.dirname(uninstallExe) : null)
    return { installDir, uninstallExe, uninstallArgs }
  } catch (_) {}
  return {}
}

// Safety fallback for relaunch: if exePath no longer exists (e.g. the
// uninstaller moved it), ask the registry where it is now.
async function findRelaunchExe (originalExePath) {
  if (originalExePath && fs.existsSync(originalExePath)) return originalExePath
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "@('HKLM','HKCU') | ForEach-Object {" +
        "  Get-ItemProperty" +
        "  \"${_}:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"," +
        "  \"${_}:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"" +
        "  -ErrorAction SilentlyContinue" +
        "} | Where-Object { $_.DisplayName -like '*NekoSuneAPPS*' -or $_.DisplayName -like '*KitsuNexus*' }" +
        " | Select-Object -First 1 -Property InstallLocation,UninstallString" +
        " | ConvertTo-Json -Compress"
      ], { timeout: 15000 }, (e, out) => e ? reject(e) : resolve({ stdout: out }))
    )
    const json = stdout.trim()
    if (!json) return null
    const obj = JSON.parse(json)
    const uninstall = parseUninstallCommand(obj.UninstallString)
    const dir = String(obj.InstallLocation || '').trim() || (uninstall.exe ? path.dirname(uninstall.exe) : '')
    if (dir) {
      const candidate = path.join(dir, 'KitsuNexus.exe')
      if (fs.existsSync(candidate)) return candidate
      const oldCandidate = path.join(dir, 'NekoSuneAPPS.exe')
      if (fs.existsSync(oldCandidate)) return oldCandidate
    }
  } catch (_) {}
  return null
}

// ── Mac helper ────────────────────────────────────────────────────────────────

function findAppBundle (fromPath) {
  let dir = path.dirname(fromPath)
  while (dir && dir !== path.dirname(dir)) {
    if (dir.toLowerCase().endsWith('.app')) return dir
    dir = path.dirname(dir)
  }
  return null
}

// ── Install orchestration ─────────────────────────────────────────────────────

async function applyInstaller (downloadedPath, targetExePath) {
  if (process.platform === 'win32') {
    if (/\.zip$/i.test(downloadedPath)) {
      const installDir = path.dirname(targetExePath)
      const extractDir = path.join(os.tmpdir(), `nekosune-update-${Date.now()}`)
      send('status', { phase: 'step', step: 'uninstall', label: 'Closing running instances…' })
      await killRunningInstances(targetExePath)
      send('status', { phase: 'step', step: 'install', label: 'Extracting app package…' })
      fs.mkdirSync(extractDir, { recursive: true })
      await new Promise((resolve, reject) =>
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${downloadedPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
        ], { timeout: 120000 }, (e) => e ? reject(e) : resolve())
      )
      send('status', { phase: 'step', step: 'install', label: 'Copying app files…' })
      await new Promise((resolve, reject) =>
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `$src='${extractDir.replace(/'/g, "''")}'; $dst='${installDir.replace(/'/g, "''")}'; ` +
          'Get-ChildItem -Path $src -Recurse -Force -ErrorAction SilentlyContinue | ' +
          "Where-Object { $_.Name -notin @('updater.exe','Update.exe') } | ForEach-Object { " +
          '$rel=$_.FullName.Substring($src.Length).TrimStart("\\"); $to=Join-Path $dst $rel; ' +
          'if ($_.PSIsContainer) { New-Item -ItemType Directory -Path $to -Force | Out-Null } ' +
          'else { New-Item -ItemType Directory -Path (Split-Path $to) -Force | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $to -Force } }'
        ], { timeout: 120000 }, (e) => e ? reject(e) : resolve())
      )
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch (_) {}
      return { relaunch: true }
    }

    // Read registry info BEFORE uninstalling — the uninstaller removes those keys.
    send('status', { phase: 'step', step: 'uninstall', label: 'Preparing…' })
    const { installDir, uninstallExe, uninstallArgs = [] } = await findNsisInstallInfo()
    const targetInstallDir = (installDir || path.dirname(targetExePath) || '').trim()

    // Kill any running instances so files aren't locked (most common cause of
    // uninstall failure / NSIS exit code 2).
    send('status', { phase: 'step', step: 'uninstall', label: 'Closing running instances…' })
    await killRunningInstances(targetExePath)

    // Step 1: clean uninstall of old files
    if (uninstallExe) {
      send('status', { phase: 'step', step: 'uninstall', label: 'Removing old version…' })
      await launchNsis(uninstallExe, [...uninstallArgs, '/S'])
      await waitForUninstallComplete(uninstallExe, targetExePath)
    }

    // Step 2: install new version to the same directory the user originally chose
    send('status', { phase: 'step', step: 'install', label: 'Installing new version…' })
    const installArgs = targetInstallDir
      ? ['/S', `/D=${targetInstallDir}`]
      : ['/S']

    await launchNsis(downloadedPath, installArgs)
    await waitForInstallComplete(targetExePath)
    return { relaunch: true }
  }

  if (process.platform === 'darwin') {
    const appBundle = findAppBundle(targetExePath)
    if (!appBundle) throw new Error('Could not locate the installed .app bundle to replace')
    const extractDir = path.join(os.tmpdir(), 'nekosune-update-extract')
    fs.mkdirSync(extractDir, { recursive: true })
    await runFile('ditto', ['-x', '-k', downloadedPath, extractDir])
    const extracted = fs.readdirSync(extractDir).find(f => f.toLowerCase().endsWith('.app'))
    if (!extracted) throw new Error('Downloaded update did not contain an .app bundle')
    await runFile('rm', ['-rf', appBundle])
    await runFile('mv', [path.join(extractDir, extracted), appBundle])
    return { relaunch: true }
  }

  if (process.platform === 'linux') {
    if (/\.appimage$/i.test(downloadedPath)) {
      fs.copyFileSync(downloadedPath, targetExePath)
      fs.chmodSync(targetExePath, 0o755)
      return { relaunch: true }
    }
    await runFile('xdg-open', [downloadedPath])
    return { relaunch: false, message: 'Finish the install in the window that just opened, then start KitsuNexus again.' }
  }

  throw new Error(`Unsupported platform: ${process.platform}`)
}

// Tracked so the Retry button can re-run just the install step.
let lastDownloadPath = null

async function performInstall (downloadPath) {
  send('status', { phase: 'installing', version })
  const result = await applyInstaller(downloadPath, exePath)

  try { fs.unlinkSync(downloadPath) } catch (_) {}
  lastDownloadPath = null

  send('status', { phase: 'done', version, message: result.message })
  await new Promise(r => setTimeout(r, result.relaunch ? 1500 : 4000))

  if (result.relaunch) {
    const launchExe = await findRelaunchExe(exePath)
    if (launchExe) spawn(launchExe, [], { detached: true, stdio: 'ignore' }).unref()
  }
  app.quit()
}

async function run () {
  if (!url || !exePath) {
    send('status', { phase: 'error', message: 'Missing required update parameters.' })
    setTimeout(() => app.quit(), 4000)
    return
  }

  // Wait for the main app to fully release its file handles
  await waitForPidExit(pid)
  await waitUntilFileUnlocked(exePath)

  const destDir = app.getPath('temp')
  const downloadPath = path.join(destDir, fileName)
  lastDownloadPath = downloadPath

  try {
    send('status', { phase: 'downloading', version })
    await download(url, downloadPath, progress => send('progress', progress))
  } catch (err) {
    try { fs.unlinkSync(downloadPath) } catch (_) {}
    lastDownloadPath = null
    send('status', { phase: 'error', message: err.message, canRetry: false })
    return
  }

  try {
    await performInstall(downloadPath)
  } catch (err) {
    send('status', { phase: 'error', message: err.message, canRetry: true, downloadPath })
  }
}

ipcMain.handle('updater:retryInstall', async () => {
  if (!lastDownloadPath || !fs.existsSync(lastDownloadPath)) {
    send('status', { phase: 'error', message: 'Nothing to retry — the downloaded installer is gone. Close this window and check for updates again.' })
    return
  }
  const downloadPath = lastDownloadPath
  try {
    await waitUntilFileUnlocked(exePath)
    await performInstall(downloadPath)
  } catch (err) {
    send('status', { phase: 'error', message: err.message, canRetry: fs.existsSync(downloadPath), downloadPath })
  }
})

ipcMain.handle('updater:openDownloadFolder', (e, targetPath) => {
  if (targetPath && fs.existsSync(targetPath)) shell.showItemInFolder(targetPath)
})

app.whenReady().then(() => {
  startupLog('appReady')
  mainWindow = new BrowserWindow({
    width: 420,
    height: 370,
    backgroundColor: '#0b0b14',
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'KitsuNexus Updater',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadFile('index.html')
  mainWindow.webContents.once('did-finish-load', async () => {
    startupLog('windowLoaded')
    send('status', { phase: 'starting', version })
    if (url && exePath && !await signalReadyAndWaitForAck()) {
      startupLog('readyHandshakeFailed')
      send('status', { phase: 'error', message: 'KitsuNexus did not acknowledge the separate updater. No files were changed.' })
      return
    }
    startupLog('readyHandshakeComplete')
    run()
  })
})

app.on('window-all-closed', () => app.quit())
ipcMain.handle('updater:retryQuit', () => app.quit())

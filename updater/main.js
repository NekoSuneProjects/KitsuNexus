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
//   - Install/uninstall are driven via PowerShell Start-Process -Wait, which
//     correctly blocks until the elevated child process finishes — Node's
//     execFile returns as soon as the NSIS stub launches (before the elevated
//     installer actually runs), which was the root cause of "claims it works
//     but nothing changed".
//
// Mac / Linux paths are implemented from documented platform behaviour but
// have NOT been verified on a real machine of either OS.

const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const https = require('https')
const { spawn, execFile } = require('child_process')

// Only one updater window at a time — a previous attempt that got stuck must
// not block a fresh one.
if (!app.requestSingleInstanceLock()) app.quit()

function parseArgs (argv) {
  const out = {}
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

const args = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2))
const { url, exe: exePath, name: fileName = 'KitsuNexus-Update.exe', version = '', pid } = args

let mainWindow = null

function send (channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
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

// Kills any running KitsuNexus processes so files aren't locked during
// uninstall/install. This is the most common cause of NSIS exit code 2.
async function killRunningInstances () {
  if (process.platform !== 'win32') return
  try {
    await new Promise((resolve, reject) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-Process -Name 'NekoSuneAPPS','NekoSuneAPPS Updater','KitsuNexus','KitsuNexus Updater' -ErrorAction SilentlyContinue |" +
        " Where-Object { $_.Id -ne $PID } | ForEach-Object { " +
        "  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue" +
        " }; Start-Sleep -Milliseconds 500"
      ], { timeout: 10000 }, (e) => e ? reject(e) : resolve())
    )
  } catch (_) { /* best effort */ }
}

// Runs an NSIS installer/uninstaller via PowerShell Start-Process -Wait.
//
// WHY NOT execFile directly:
//   Node's execFile() calls CreateProcess() and waits for that specific PID.
//   When NSIS needs elevation it launches a UAC-elevated child and the outer
//   stub exits immediately — CreateProcess sees exit code 0 before the actual
//   installer has done anything. Start-Process -Wait waits on the elevated
//   process itself, so we don't return until the install is truly done.
async function runNsisInstaller (installerPath, nsisArgs) {
  // Build a PowerShell -ArgumentList from the args array.
  // /D=<path> must be LAST and must not be quoted — NSIS parses it specially.
  const escapedExe = installerPath.replace(/'/g, "''")
  const argStr = nsisArgs.map(a => {
    const s = String(a)
    // /D= args: pass unquoted so NSIS sees the raw path
    if (/^\/D=/i.test(s)) return s
    return `'${s.replace(/'/g, "''")}'`
  }).join(',')
  const cmd = argStr
    ? `Start-Process -FilePath '${escapedExe}' -ArgumentList ${argStr} -Wait`
    : `Start-Process -FilePath '${escapedExe}' -Wait`

  return new Promise((resolve, reject) =>
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', cmd],
      { timeout: 120000 },
      (err, _out, stderr) => {
        if (err) { err.stderrText = String(stderr || '').trim(); reject(err) }
        else resolve()
      }
    )
  )
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
        "  \"$_:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"," +
        "  \"$_:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"" +
        "  -ErrorAction SilentlyContinue" +
        "} | Where-Object { $_.DisplayName -like '*NekoSuneAPPS*' -or $_.DisplayName -like '*KitsuNexus*' }" +
        " | Select-Object -First 1 -Property InstallLocation,UninstallString" +
        " | ConvertTo-Json -Compress"
      ], { timeout: 15000 }, (e, out) => e ? reject(e) : resolve({ stdout: out }))
    )
    const json = stdout.trim()
    if (!json) return {}
    const obj = JSON.parse(json)
    const installDir = (obj.InstallLocation || '').trim() || null
    // UninstallString can be quoted: "C:\path\Uninstall.exe" — strip outer quotes
    const rawUninstall = (obj.UninstallString || '').trim().replace(/^"(.*)"$/, '$1').trim()
    const uninstallExe = (rawUninstall && fs.existsSync(rawUninstall)) ? rawUninstall : null
    return { installDir, uninstallExe }
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
        "  \"$_:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"," +
        "  \"$_:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\"" +
        "  -ErrorAction SilentlyContinue" +
        "} | Where-Object { $_.DisplayName -like '*NekoSuneAPPS*' -or $_.DisplayName -like '*KitsuNexus*' }" +
        " | Select-Object -ExpandProperty InstallLocation -First 1"
      ], { timeout: 15000 }, (e, out) => e ? reject(e) : resolve({ stdout: out }))
    )
    const dir = stdout.trim()
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
      await killRunningInstances()
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
    const { installDir, uninstallExe } = await findNsisInstallInfo()

    // Kill any running instances so files aren't locked (most common cause of
    // uninstall failure / NSIS exit code 2).
    send('status', { phase: 'step', step: 'uninstall', label: 'Closing running instances…' })
    await killRunningInstances()

    // Step 1: clean uninstall of old files
    if (uninstallExe) {
      send('status', { phase: 'step', step: 'uninstall', label: 'Removing old version…' })
      try {
        await runNsisInstaller(uninstallExe, ['/S'])
      } catch (uninstallErr) {
        // If the uninstaller fails (exit code 2 = files locked), try to
        // manually remove the install directory so the new installer can
        // proceed.  This is the most common path for the "exit code 2" error.
        if (installDir && fs.existsSync(installDir)) {
          send('status', { phase: 'step', step: 'uninstall', label: 'Cleaning up leftover files…' })
          try {
            // Remove read-only attributes first (NSIS uninstaller sets these)
            await new Promise((resolve, reject) =>
              execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                `Get-ChildItem -Path '${installDir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue |` +
                ' Set-ItemProperty -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue;' +
                ` Remove-Item -Path '${installDir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`
              ], { timeout: 30000 }, (e) => e ? reject(e) : resolve())
            )
          } catch (_) {
            // If manual cleanup fails, we'll let the installer try anyway —
            // it may still succeed in overwriting what it can.
          }
        }
      }
    }

    // Step 2: install new version to the same directory the user originally chose
    send('status', { phase: 'step', step: 'install', label: 'Installing new version…' })
    const installArgs = (installDir && installDir.trim())
      ? ['/S', `/D=${installDir.trim()}`]
      : ['/S']

    const attempts = 3
    let lastErr = null
    for (let i = 1; i <= attempts; i++) {
      try {
        await runNsisInstaller(downloadedPath, installArgs)
        return { relaunch: true }
      } catch (err) {
        lastErr = err
        if (i < attempts) {
          // Wait a bit and kill any lingering processes before retrying
          await killRunningInstances()
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
    const detail = lastErr.stderrText
      ? `: ${lastErr.stderrText}`
      : (lastErr.code !== undefined ? ` (exit code ${lastErr.code})` : '')
    throw new Error(`Installer failed after ${attempts} attempts${detail}. Try running the installer manually as Administrator.`)
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
  mainWindow.webContents.once('did-finish-load', () => {
    send('status', { phase: 'starting', version })
    run()
  })
})

app.on('window-all-closed', () => app.quit())
ipcMain.handle('updater:retryQuit', () => app.quit())

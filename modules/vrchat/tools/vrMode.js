// modules/vrchat/tools/vrMode.js
// Tells whether VRChat is running in VR or Desktop mode, from VRChat.exe's own
// command line ("--no-vr" = Desktop) — the same signal VRCX uses for its
// "(VR)" / "(Desktop)" Rich Presence label. Windows only; MAIN process.
// Result: 'vr' | 'desktop' | '' (not running / unknown).

const { execFile } = require('child_process')

function modeFromCommandLine (cmd) {
  if (!cmd) return ''
  return /(^|\s)--no-vr(\s|$)/i.test(cmd) ? 'desktop' : 'vr'
}

function detectVrMode (cb) {
  if (process.platform !== 'win32') return cb('')
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='VRChat.exe'\" | Select-Object -First 1 -ExpandProperty CommandLine"
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
    cb(err ? '' : modeFromCommandLine(String(out || '').trim()))
  })
}

module.exports = { detectVrMode, modeFromCommandLine }

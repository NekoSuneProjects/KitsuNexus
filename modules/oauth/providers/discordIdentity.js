// modules/oauth/providers/discordIdentity.js
// "Log in with Discord" for the official NekoSuneAPPSVRC backend features (Activity
// status push, official shared bot). Modeled on twitch.js's loopback pattern, but
// simpler: Electron never talks to Discord's token endpoint or holds a client
// secret. The NekoSuneAPPSVRC backend (server/, deployed separately) does the whole
// code->token exchange and hands back only its own short-lived session token.
//
// Flow: Electron opens a BrowserWindow at <backend>/oauth2/discord/authorize ->
// user approves on Discord's own page -> Discord redirects to the BACKEND's
// registered callback (not localhost) -> backend exchanges the code and
// redirects the browser to this same shared loopback port with its session
// token in the query string -> we catch that and resolve.
//
// ONE-TIME SETUP: none needed here — the backend's redirect_uri is what's
// registered in the Discord Developer Portal, not this loopback.

const http = require('http')
const { BrowserWindow } = require('electron')

// Same shared OAuth port as twitch.js, namespaced by path.
const PORT = 3737
const CALLBACK_PATH = '/oauth2/discord/callback'
const LOOPBACK_REDIRECT = `http://localhost:${PORT}${CALLBACK_PATH}`

const okPage = '<!doctype html><meta charset="utf-8"><title>NekoSuneAPPSVRC</title>' +
  '<body style="font-family:sans-serif;background:#12121d;color:#fff;text-align:center;padding-top:48px">' +
  '<h2>✅ Logged in — you can close this window</h2><script>setTimeout(function(){window.close()},400)</script></body>'

function loginDiscordIdentity (backendBaseUrl) {
  return new Promise((resolve, reject) => {
    if (!backendBaseUrl) return reject(new Error('No NekoSuneAPPSVRC backend configured'))

    let settled = false
    let server = null
    let win = null
    const finish = (err, data) => {
      if (settled) return
      settled = true
      try { if (server) server.close() } catch (_) {}
      try { if (win && !win.isDestroyed()) win.close() } catch (_) {}
      err ? reject(err) : resolve(data)
    }

    server = http.createServer((req, res) => {
      const u = new URL(req.url, LOOPBACK_REDIRECT)
      if (u.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return }

      const token = u.searchParams.get('token')
      const err = u.searchParams.get('error_description') || u.searchParams.get('error')
      if (!token) {
        res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h2>Login failed</h2>')
        return finish(new Error(err || 'No session token returned'))
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(okPage)
      finish(null, { sessionToken: token })
    })

    server.on('error', e => finish(new Error(
      e.code === 'EADDRINUSE' ? `Port ${PORT} in use — close the other login and retry` : 'OAuth server failed: ' + e.message
    )))

    server.listen(PORT, () => {
      win = new BrowserWindow({
        width: 520, height: 760, title: 'Login with Discord', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      win.on('closed', () => finish(new Error('Login window closed before finishing')))
      win.loadURL(`${backendBaseUrl}/oauth2/discord/authorize`)
    })
  })
}

module.exports = { loginDiscordIdentity, DISCORD_IDENTITY_LOOPBACK_REDIRECT: LOOPBACK_REDIRECT }

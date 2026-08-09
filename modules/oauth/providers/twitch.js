// modules/oauth/providers/twitch.js
// Twitch OAuth2 via a loopback redirect. Supports BOTH:
//   • No client secret  -> implicit grant (response_type=token). Simplest; the
//     access token comes back in the URL fragment. No refresh token (re-login when
//     it expires, ~4h).
//   • With client secret -> authorization code grant. Returns a REFRESH TOKEN so the
//     login persists and renews automatically.
//
// ONE-TIME SETUP in https://dev.twitch.tv/console -> your app -> OAuth Redirect URLs:
//   add exactly:  http://localhost:3737/oauth2/twitch/callback

const http = require('http')
const axios = require('axios')
const { BrowserWindow } = require('electron')

// One shared OAuth port for every service, namespaced by path.
const PORT = 3737
const REDIRECT = `http://localhost:${PORT}/oauth2/twitch/callback`
const TOKEN_PATH = '/oauth2/twitch/token'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

const okPage = '<!doctype html><meta charset="utf-8"><title>KitsuNexus</title>' +
  '<body style="font-family:sans-serif;background:#12121d;color:#fff;text-align:center;padding-top:48px">' +
  '<h2>✅ Logged in — you can close this window</h2><script>setTimeout(function(){window.close()},400)</script></body>'

// Implicit grant: the token is in the URL fragment, which the browser keeps client-side.
// This page reads it and forwards it to /token.
const forwardPage = '<!doctype html><meta charset="utf-8"><title>KitsuNexus</title>' +
  '<body style="font-family:sans-serif;background:#12121d;color:#fff;text-align:center;padding-top:48px">' +
  '<h2>✅ Logged in — you can close this window</h2>' +
  `<script>fetch("${TOKEN_PATH}?"+location.hash.slice(1)).then(function(){setTimeout(function(){window.close()},300)})</script></body>`

function loginTwitch (clientId, clientSecret, scopes = 'moderator:read:followers chat:read channel:read:redemptions') {
  return new Promise((resolve, reject) => {
    if (!clientId) return reject(new Error('Enter your Twitch Client ID first'))

    const implicit = !clientSecret // no secret -> implicit grant (no refresh token)
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

    server = http.createServer(async (req, res) => {
      const u = new URL(req.url, REDIRECT)

      if (u.pathname === '/oauth2/twitch/callback') {
        const err = u.searchParams.get('error_description') || u.searchParams.get('error')
        if (err) {
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h2>Login failed</h2>')
          return finish(new Error(err))
        }
        if (implicit) {
          // token is in the fragment -> serve the page that forwards it to /token
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(forwardPage)
          return
        }
        // authorization code grant -> exchange the code for tokens server-side
        const code = u.searchParams.get('code')
        if (!code) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h2>Login failed</h2>'); return finish(new Error('No authorization code returned')) }
        try {
          const body = new URLSearchParams({
            client_id: clientId, client_secret: clientSecret, code,
            grant_type: 'authorization_code', redirect_uri: REDIRECT
          }).toString()
          const tok = await axios.post(TOKEN_URL, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 })
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(okPage)
          finish(null, { accessToken: tok.data.access_token, refreshToken: tok.data.refresh_token, expiresIn: tok.data.expires_in })
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h2>Token exchange failed</h2>')
          finish(new Error('Token exchange failed: ' + (e.response?.data?.message || e.message)))
        }
        return
      }

      if (u.pathname === TOKEN_PATH) { // implicit: fragment forwarded here
        const token = u.searchParams.get('access_token')
        const err = u.searchParams.get('error_description') || u.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok')
        token
          ? finish(null, { accessToken: token, refreshToken: '', expiresIn: Number(u.searchParams.get('expires_in')) || 0 })
          : finish(new Error(err || 'No token returned'))
        return
      }

      res.writeHead(404); res.end()
    })

    server.on('error', e => finish(new Error(
      e.code === 'EADDRINUSE' ? `Port ${PORT} in use — close the other login and retry` : 'OAuth server failed: ' + e.message
    )))

    server.listen(PORT, () => {
      const authUrl = 'https://id.twitch.tv/oauth2/authorize' +
        `?response_type=${implicit ? 'token' : 'code'}&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
        `&scope=${encodeURIComponent(scopes)}&force_verify=true`
      win = new BrowserWindow({
        width: 520, height: 760, title: 'Login with Twitch', autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      win.on('closed', () => finish(new Error('Login window closed before finishing')))
      win.loadURL(authUrl)
    })
  })
}

async function refreshTwitch (clientId, clientSecret, refreshToken) {
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing client id/secret/refresh token')
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: 'refresh_token', refresh_token: refreshToken
  }).toString()
  const res = await axios.post(TOKEN_URL, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 })
  return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token || refreshToken, expiresIn: res.data.expires_in }
}

module.exports = { loginTwitch, refreshTwitch, TWITCH_REDIRECT: REDIRECT }

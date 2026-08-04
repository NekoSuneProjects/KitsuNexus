// A minimal, server-rendered web dashboard: log in with Discord, then invite
// the official bot to a server you manage. This is the intended way to add
// the bot — see authorizedGuilds.js / discordBotGateway.js for why a bot
// invite link handed out any other way doesn't actually stick.

const express = require('express')
const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config')
const authorizedGuilds = require('../authorizedGuilds')

const router = express.Router()

function readSession (req) {
  const token = req.cookies && req.cookies.session
  if (!token) return null
  try { return jwt.verify(token, jwtSecret).sub } catch (_) { return null }
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function page (bodyHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>NekoSuneAPPS</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{background:#0b0b14;color:#e8e8f0;font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}
  a.btn{display:inline-block;background:#5865F2;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin:12px 12px 0 0}
  a.btn.secondary{background:#23233a}
  .card{background:#16161f;border:1px solid #23233a;border-radius:10px;padding:16px;margin-top:16px}
  code{background:#23233a;padding:2px 6px;border-radius:4px}
  ul{padding-left:20px}
</style></head>
<body><h2>NekoSuneAPPS</h2>${bodyHtml}</body></html>`
}

router.get('/dashboard', (req, res) => {
  const discordUserId = readSession(req)
  if (!discordUserId) {
    return res.send(page(`
      <p>Log in with Discord to add the official shared bot to a server you manage.</p>
      <a class="btn" href="/oauth2/discord/authorize-dashboard">Login with Discord</a>
    `))
  }
  const myGuilds = Object.entries(authorizedGuilds.all()).filter(([, v]) => v.authorizedBy === discordUserId)
  res.send(page(`
    <p>Logged in as Discord user <code>${escapeHtml(discordUserId)}</code>.</p>
    <div class="card">
      <h3>Servers you've authorized</h3>
      ${myGuilds.length
        ? '<ul>' + myGuilds.map(([id, v]) => `<li><code>${escapeHtml(id)}</code> — ${escapeHtml(v.at)}</li>`).join('') + '</ul>'
        : '<p>None yet.</p>'}
    </div>
    <a class="btn" href="/oauth2/discord/authorize-bot">Add bot to another server</a>
    <a class="btn secondary" href="/dashboard/logout">Log out</a>
  `))
})

router.get('/dashboard/logout', (req, res) => {
  res.clearCookie('session')
  res.redirect('/dashboard')
})

module.exports = router

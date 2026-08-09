// A minimal, server-rendered web dashboard: log in with Discord, then invite
// the official bot to a server you manage. This is the intended way to add
// the bot — see authorizedGuilds.js / discordBotGateway.js for why a bot
// invite link handed out any other way doesn't actually stick.

const express = require('express')
const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config')
const authorizedGuilds = require('../authorizedGuilds')
const botGateway = require('../discordBotGateway')

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
<html><head><meta charset="utf-8"><title>KitsuNexus</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{background:#0b0b14;color:#e8e8f0;font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px}
  a.btn{display:inline-block;background:#5865F2;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin:12px 12px 0 0}
  a.btn.secondary{background:#23233a}
  .card{background:#16161f;border:1px solid #23233a;border-radius:10px;padding:16px;margin-top:16px}
  code{background:#23233a;padding:2px 6px;border-radius:4px}
  ul{padding-left:20px}
  .muted{color:#8a8aa0}
</style></head>
<body><h2>KitsuNexus</h2>${bodyHtml}</body></html>`
}

router.get('/dashboard', async (req, res) => {
  const discordUserId = readSession(req)
  if (!discordUserId) {
    return res.send(page(`
      <p>Log in with Discord to add the official shared bot to a server you manage.</p>
      <a class="btn" href="/oauth2/discord/authorize-dashboard">Login with Discord</a>
    `))
  }
  const myGuilds = Object.entries(authorizedGuilds.all()).filter(([, v]) => v.authorizedBy === discordUserId)
  // Live per-guild check — admin rights are a property of the server right
  // now, not of who happened to authorize it originally. Someone who no
  // longer has Manage Server there only gets to view, not remove.
  const rows = await Promise.all(myGuilds.map(async ([id, v]) => {
    const canManage = await botGateway.hasManagePermission(id, discordUserId)
    const removeControl = canManage
      ? `<form style="display:inline" method="POST" action="/dashboard/revoke/${encodeURIComponent(id)}" onsubmit="return confirm('Remove the bot from this server?')"><button class="btn secondary" style="padding:2px 10px;font-size:.8rem;margin-left:8px" type="submit">Remove</button></form>`
      : '<span class="muted" style="font-size:.8rem;margin-left:8px">(view only — no Manage Server permission here)</span>'
    return `<li><code>${escapeHtml(id)}</code> — ${escapeHtml(v.at)} ${removeControl}</li>`
  }))
  res.send(page(`
    <p>Logged in as Discord user <code>${escapeHtml(discordUserId)}</code>.</p>
    <div class="card">
      <h3>Servers you've authorized</h3>
      ${rows.length ? '<ul>' + rows.join('') + '</ul>' : '<p>None yet.</p>'}
    </div>
    <a class="btn" href="/oauth2/discord/authorize-bot">Add bot to another server</a>
    <a class="btn secondary" href="/dashboard/logout">Log out</a>
  `))
})

router.get('/dashboard/logout', (req, res) => {
  res.clearCookie('session')
  res.redirect('/dashboard')
})

// Removing the bot from a guild. Re-checks Manage Server live server-side —
// never trust that the "Remove" button was correctly hidden client-side.
router.post('/dashboard/revoke/:guildId', express.urlencoded({ extended: false }), async (req, res) => {
  const discordUserId = readSession(req)
  if (!discordUserId) return res.redirect('/dashboard')
  const { guildId } = req.params
  if (await botGateway.hasManagePermission(guildId, discordUserId)) {
    authorizedGuilds.revoke(guildId)
    await botGateway.leaveGuild(guildId)
  }
  res.redirect('/dashboard')
})

module.exports = router

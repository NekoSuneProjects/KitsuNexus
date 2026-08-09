// Discord Activity iframe — live, read-only VRChat status panel for whoever's
// in this voice channel. No build step: imports the Embedded App SDK straight
// from esm.sh so this stays plain static files (swap for a vendored/bundled
// copy later if you'd rather not depend on a CDN at runtime).
import { DiscordSDK } from 'https://esm.sh/@discord/embedded-app-sdk'

// Must match DEFAULT_DISCORD_APP_ID (renderer.js) / DISCORD_APP_ID (main.js) in
// the Electron app, and DISCORD_CLIENT_ID in this backend's .env.
const CLIENT_ID = '1534208250046578790'

const discordSdk = new DiscordSDK(CLIENT_ID)
let sessionToken = null
let channelId = null

async function setup () {
  await discordSdk.ready()
  channelId = discordSdk.channelId

  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify']
  })

  const res = await fetch('/api/activity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  if (!res.ok) throw new Error('Token exchange failed')
  const { access_token: accessToken, token } = await res.json()
  sessionToken = token

  await discordSdk.commands.authenticate({ access_token: accessToken })

  await refresh()
  setInterval(refresh, 8000)
}

async function refresh () {
  const app = document.getElementById('app')
  try {
    const res = await fetch(`/api/channel/${channelId}/status`, {
      headers: { Authorization: `Bearer ${sessionToken}` }
    })
    if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`)
    render(await res.json())
  } catch (err) {
    app.innerHTML = `<p id="error">${escapeHtml(err.message)}</p>`
  }
}

function render (data) {
  const app = document.getElementById('app')
  const visible = data.members.filter(m => m.visible)
  if (!visible.length) {
    app.innerHTML = '<p id="loading">No one here has KitsuNexus open right now (or their status is hidden).</p>'
    return
  }
  app.innerHTML = visible.map(m => `
    <div class="member">
      ${m.worldName ? `<div class="world">${escapeHtml(m.worldName)}</div>` : ''}
      <div class="meta">${[
        m.hrBpm ? `❤️ ${m.hrBpm} bpm` : '',
        m.nowPlaying ? `🎵 ${escapeHtml(m.nowPlaying)}` : ''
      ].filter(Boolean).join(' · ') || 'In VRChat'}</div>
    </div>
  `).join('')
}

function escapeHtml (s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

setup().catch(err => {
  document.getElementById('app').innerHTML = `<p id="error">Failed to start: ${escapeHtml(err.message)}</p>`
})

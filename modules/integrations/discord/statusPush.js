// modules/integrations/discord/statusPush.js
// Periodically pushes the live VRChat status (already assembled in discord.js
// for Rich Presence — see getVrcContextSnapshot()) to the NekoSuneAPPSVRC backend
// (server/, deployed separately), so the Discord Activity panel and anyone
// viewing this user's shared voice channel can see it. Independent opt-in from
// Rich Presence/voice bot — only runs once the user has logged in with Discord.

const PUSH_INTERVAL_MS = 20_000

let timer = null

async function pushOnce (backendBaseUrl, sessionToken, getContext) {
  try {
    const res = await fetch(`${backendBaseUrl}/api/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(getContext())
    })
    if (!res.ok) console.warn('[statusPush] backend rejected status push:', res.status)
  } catch (err) {
    console.warn('[statusPush] failed to reach backend:', err.message)
  }
}

function startStatusPush (backendBaseUrl, sessionToken, getContext) {
  stopStatusPush()
  if (!backendBaseUrl || !sessionToken) return
  pushOnce(backendBaseUrl, sessionToken, getContext)
  timer = setInterval(() => pushOnce(backendBaseUrl, sessionToken, getContext), PUSH_INTERVAL_MS)
}

function stopStatusPush () {
  if (timer) { clearInterval(timer); timer = null }
}

module.exports = { startStatusPush, stopStatusPush }

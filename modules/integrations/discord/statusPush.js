// modules/integrations/discord/statusPush.js
// Periodically pushes the live VRChat status (already assembled in discord.js
// for Rich Presence — see getVrcContextSnapshot()) to the KitsuNexus backend
// (server/, deployed separately), so the Discord Activity panel and anyone
// viewing this user's shared voice channel can see it. Independent opt-in from
// Rich Presence/voice bot — only runs once the user has logged in with Discord.

const PUSH_INTERVAL_MS = 20_000

let timer = null

async function pushOnce (backendBaseUrl, sessionToken, getContext, onUnauthorized) {
  try {
    const res = await fetch(`${backendBaseUrl}/api/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(getContext())
    })
    if (res.status === 401) {
      // The session token is invalid/expired — it's never going to start working again on its
      // own, so stop hammering the backend every 20s (previously this just logged "rejected:
      // 401" forever until the app was restarted or the user manually logged out). Let the
      // caller know so it can clear the stored token and prompt the user to log in again.
      console.warn('[statusPush] session rejected (401) — stopping status push until re-login')
      stopStatusPush()
      if (onUnauthorized) onUnauthorized()
      return
    }
    if (!res.ok) console.warn('[statusPush] backend rejected status push:', res.status)
  } catch (err) {
    console.warn('[statusPush] failed to reach backend:', err.message)
  }
}

function startStatusPush (backendBaseUrl, sessionToken, getContext, onUnauthorized) {
  stopStatusPush()
  if (!backendBaseUrl || !sessionToken) return
  pushOnce(backendBaseUrl, sessionToken, getContext, onUnauthorized)
  timer = setInterval(() => pushOnce(backendBaseUrl, sessionToken, getContext, onUnauthorized), PUSH_INTERVAL_MS)
}

function stopStatusPush () {
  if (timer) { clearInterval(timer); timer = null }
}

module.exports = { startStatusPush, stopStatusPush }

// modules/vrchat/status/serverStatus.js
// VRChat service status (status.vrchat.com, Atlassian Statuspage API) — the
// same source VRCX uses for its outage banner. Polls every few minutes and
// reports changes: an alert when something degrades, another when it's back.
// MAIN process.

const https = require('https')

const BASE = 'https://status.vrchat.com/api/v2'
const POLL_MS = 5 * 60 * 1000

function getJson (url, timeout = 8000) {
  return new Promise(resolve => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'KitsuNexus' } }, res => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null) }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', c => { body += c; if (body.length > 512 * 1024) req.destroy() })
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (_) { resolve(null) } })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

// summary.json -> { ok, indicator, description, components: [names not operational], incidents: [names] }
function parseSummary (data) {
  if (!data || !data.status) return null
  const indicator = String(data.status.indicator || 'none')
  const components = (Array.isArray(data.components) ? data.components : [])
    .filter(c => c && c.status && c.status !== 'operational' && !c.group)
    .map(c => String(c.name || '').trim()).filter(Boolean)
  const incidents = (Array.isArray(data.incidents) ? data.incidents : [])
    .filter(i => i && i.status !== 'resolved' && i.status !== 'postmortem')
    .map(i => String(i.name || '').trim()).filter(Boolean)
  return { ok: indicator === 'none' && !components.length, indicator, description: String(data.status.description || ''), components, incidents }
}

function createServerStatus ({ onChange, fetchJson = getJson } = {}) {
  let timer = null
  let last = null

  async function poll () {
    const s = parseSummary(await fetchJson(`${BASE}/summary.json`))
    if (!s) return last
    const key = JSON.stringify([s.ok, s.indicator, s.components, s.incidents])
    const prevKey = last ? JSON.stringify([last.ok, last.indicator, last.components, last.incidents]) : null
    const prev = last
    last = { ...s, checkedAt: Date.now() }
    if (key !== prevKey && typeof onChange === 'function') onChange(last, prev)
    return last
  }

  return {
    start () { if (timer) return; poll(); timer = setInterval(poll, POLL_MS); if (timer.unref) timer.unref() },
    stop () { if (timer) { clearInterval(timer); timer = null } },
    poll,
    current: () => last
  }
}

module.exports = { createServerStatus, parseSummary }

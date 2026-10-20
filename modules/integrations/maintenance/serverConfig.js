'use strict'

const axios = require('axios')

const FALLBACK_DISCORD_APP_ID = '1536095795667795998'
const DISCORD_ID_PATTERN = /^\d{17,20}$/
const CACHE_MS = 5 * 60 * 1000
let cached = null

function desktopEndpoint (baseUrl, endpoint) {
  const url = new URL(String(baseUrl || '').trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid KitsuNexus server URL')
  }
  // The server may be deployed under a URL with a trailing slash, but desktop
  // API paths are rooted at the origin just like the other KitsuNexus APIs.
  return new URL(endpoint, url.origin).href
}

async function getDiscordAppId (baseUrl, http = axios) {
  if (cached && cached.baseUrl === baseUrl && Date.now() < cached.until && http === axios) return cached.id
  let id = FALLBACK_DISCORD_APP_ID
  try {
    const { data } = await http.get(desktopEndpoint(baseUrl, '/api/desktop/config'), { timeout: 8000 })
    if (data?.ok === true && DISCORD_ID_PATTERN.test(String(data.discordAppId || ''))) {
      id = String(data.discordAppId)
    }
  } catch (_) {
    // Older/self-hosted deployments may not have this endpoint yet; Rich
    // Presence should still work with the built-in official app ID offline.
  }
  if (http === axios) cached = { baseUrl, id, until: Date.now() + (id === FALLBACK_DISCORD_APP_ID ? 30000 : CACHE_MS) }
  return id
}

module.exports = { desktopEndpoint, getDiscordAppId, FALLBACK_DISCORD_APP_ID }

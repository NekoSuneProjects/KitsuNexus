const express = require('express')
const config = require('../config')

const router = express.Router()
const RELEASE_API = 'https://api.github.com/repos/NekoSuneProjects/KitsuNexus/releases/latest'
const CACHE_MS = 5 * 60 * 1000
let cachedRelease = null
let cacheUntil = 0
let pending = null

// Only publish desktop settings; Discord OAuth secrets, bot tokens and server
// credentials must never be included in this unauthenticated response.
router.get('/api/desktop/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60')
  res.json({ ok: true, discordAppId: config.discordRichPresenceAppId })
})

async function latestRelease () {
  if (cachedRelease && Date.now() < cacheUntil) return cachedRelease
  if (!pending) {
    pending = (async () => {
      const response = await fetch(RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KitsuNexus-Server' },
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
      const data = await response.json()
      if (!data || typeof data.tag_name !== 'string' || !Array.isArray(data.assets)) {
        throw new Error('GitHub returned an invalid release')
      }
      const release = {
        tag_name: data.tag_name,
        name: data.name,
        body: String(data.body || '').slice(0, 4000),
        html_url: data.html_url,
        assets: data.assets.slice(0, 100).map(asset => ({
          name: asset.name,
          browser_download_url: asset.browser_download_url,
          size: asset.size,
          digest: asset.digest || ''
        }))
      }
      cachedRelease = release
      cacheUntil = Date.now() + CACHE_MS
      return release
    })().finally(() => { pending = null })
  }
  return pending
}

// The desktop checks this endpoint first; updates still download from verified
// official GitHub release URLs via its separate updater helper.
router.get('/api/desktop/updates/latest', async (req, res) => {
  try {
    const release = await latestRelease()
    res.set('Cache-Control', 'public, max-age=60')
    res.json({ ok: true, release })
  } catch (err) {
    console.warn('[desktop updates]', err.message)
    res.status(503).json({ ok: false, error: 'Could not retrieve the latest release' })
  }
})

module.exports = router

// modules/ai/webSearch.js
// Web search for the voice assistant, two selectable providers:
//   - searxng: any SearXNG-compatible JSON API (real web search results).
//     Default is NekoSune Search (https://search.nekosunevr.co.uk/api/search);
//     a self-hosted SearXNG works too (needs `formats: [json]` in settings.yml).
//   - duckduckgo: DuckDuckGo's public "Instant Answer" API. This is NOT a
//     full web search API - no API key needed, but it only returns an
//     abstract/infobox-style answer and related topics, and returns nothing
//     at all for a large fraction of ordinary queries. It's offered as a
//     no-setup fallback, not a like-for-like replacement for SearXNG.
// Runs in the MAIN process.

const axios = require('axios')

// Default instance: NekoSune Search (degoog), SearXNG-compatible JSON at /api/search.
const DEFAULT_SEARCH_ENDPOINT = 'https://search.nekosunevr.co.uk/api/search'
// The previous default, so saved configs still on it get moved to the new one.
const LEGACY_SEARCH_ENDPOINTS = ['https://searxng.nekosunevr.co.uk/', 'https://searxng.nekosunevr.co.uk']

// Accepts a bare instance URL ("https://host/" → https://host/search, the
// SearXNG layout), a URL that already ends in /search or /api/search, or a
// full pasted example URL (its ?format=…&q=… is dropped; we set our own).
function searchUrl (endpoint) {
  const raw = String(endpoint || '').trim()
  if (!raw) return ''
  let u
  try { u = new URL(raw) } catch (_) { return '' }
  u.search = ''; u.hash = ''
  const path = u.pathname.replace(/\/+$/, '')
  u.pathname = /\/search$/i.test(path) ? path : `${path}/search`
  return u.toString()
}

async function searchSearxng (query, endpoint) {
  const url = searchUrl(LEGACY_SEARCH_ENDPOINTS.includes(String(endpoint || '').trim()) ? DEFAULT_SEARCH_ENDPOINT : endpoint)
  if (!url) throw new Error('No search endpoint configured')

  const res = await axios.get(url, {
    params: { q: query, format: 'json' },
    timeout: 15000
  })

  const results = Array.isArray(res.data?.results) ? res.data.results : []
  return results.slice(0, 5).map(r => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || ''
  }))
}

async function searchDuckDuckGo (query) {
  const res = await axios.get('https://api.duckduckgo.com/', {
    params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
    timeout: 15000
  })

  const data = res.data || {}
  const results = []

  if (data.AbstractText) {
    results.push({ title: data.Heading || query, url: data.AbstractURL || '', content: data.AbstractText })
  }

  const flattenTopics = (topics) => {
    for (const t of topics || []) {
      if (results.length >= 5) return
      if (t.Text) results.push({ title: t.Text.split(' - ')[0] || '', url: t.FirstURL || '', content: t.Text })
      else if (Array.isArray(t.Topics)) flattenTopics(t.Topics)
    }
  }
  flattenTopics(data.RelatedTopics)

  return results.slice(0, 5)
}

async function searchWeb (query, opts = {}) {
  const q = String(query || '').trim()
  if (!q) return []

  // Back-compat: opts used to just be the SearXNG endpoint string.
  const { provider, endpoint } = typeof opts === 'string' ? { provider: 'searxng', endpoint: opts } : opts

  if (provider === 'duckduckgo') return searchDuckDuckGo(q)
  return searchSearxng(q, endpoint)
}

module.exports = { searchWeb, searchUrl, DEFAULT_SEARCH_ENDPOINT, LEGACY_SEARCH_ENDPOINTS }

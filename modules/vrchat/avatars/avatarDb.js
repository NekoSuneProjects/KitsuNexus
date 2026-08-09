// modules/vrchat/avatars/avatarDb.js
// Configurable avatar-browse provider — searches an external avatar database
// (avtrdb.com by default, like VRCNext) and supports CUSTOM endpoints so you can
// point at any VRCX-style avatar data server. A provider URL is a template with
// {query} and {page} placeholders returning JSON. Runs in the MAIN process.

const axios = require('axios')

const REQ = { validateStatus: () => true, timeout: 15000, headers: { 'User-Agent': 'KitsuNexus/1.0.0' } }

// Built-in default. Users can add their own in Settings → Avatar providers.
const DEFAULT_PROVIDERS = [
  { name: 'avtrdb', url: 'https://api.avtrdb.com/v2/avatar/search/{query}?page={page}&page_size=30' },
  { name: 'VRCX vrcdb', url: 'https://vrcx.vrcdb.com/avatars/Avatar/VRCX?search={query}&page={page}' },
  { name: 'Paw API VRCX', url: 'https://paw-api.amelia.fun/vrcx_search?search={query}&page={page}' },
  { name: 'NekoSuneVR Avatar Search', url: 'https://vrcavatarsearch.nekosunevr.co.uk/vrcx_search?search={query}&page={page}' },
  { name: 'avtr.zip VRCX', url: 'https://vrcx.avtr.zip/?search={query}&page={page}' },
  { name: 'avtrdb VRCX', url: 'https://api.avtrdb.com/v1/avatar/search/vrcx?search={query}&page={page}' },
  { name: 'WorldBalancer VRCX', url: 'https://avatarwbvrcxsearch.worldbalancer.com/vrcx_search?search={query}&page={page}' }
]

// Flexible parser — handles avtrdb / VRCX / generic shapes.
function extractAvatars (data) {
  let arr = []
  if (Array.isArray(data)) arr = data
  else if (data && Array.isArray(data.avatars)) arr = data.avatars
  else if (data && Array.isArray(data.results)) arr = data.results
  else if (data && Array.isArray(data.data)) arr = data.data
  else if (data && Array.isArray(data.docs)) arr = data.docs
  else if (data && Array.isArray(data.items)) arr = data.items
  return arr.map(a => {
    const id = a.vrc_id || a.avatarId || a.AvatarId || a.avatar_id || a.id || ''
    return {
      id,
      name: a.name || a.avatar_name || a.Name || 'Avatar',
      image: a.thumbnail_url || a.thumbnailImageUrl || a.imageUrl || a.image || a.Thumbnail || a.thumbnail || a.iconUrl || '',
      author: a.author_name || a.authorName || a.AuthorName || a.author || '',
      performance: a.performance || null
    }
  }).filter(a => /^avtr_/.test(a.id))
}

async function search (providerUrl, query, page = 1) {
  if (!providerUrl) return { ok: false, error: 'No provider URL' }
  const url = providerUrl.replace('{query}', encodeURIComponent(query || '')).replace('{page}', String(page))
  try {
    const res = await axios.get(url, REQ)
    if (res.status === 200) return { ok: true, avatars: extractAvatars(res.data) }
    return { ok: false, error: 'HTTP ' + res.status }
  } catch (e) { return { ok: false, error: e.message } }
}

module.exports = { search, DEFAULT_PROVIDERS }

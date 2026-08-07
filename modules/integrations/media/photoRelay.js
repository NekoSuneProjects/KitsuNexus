// modules/integrations/media/photoRelay.js
// Watches your VRChat photos folder and auto-uploads new screenshots to a Discord
// channel via webhook. Local-only; nothing else leaves your PC. Runs in MAIN.

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { resolvePhotosDir } = require('../../vrchat/tools/vrcTools')
const screenshotMetadata = require('../../vrchat/tools/screenshotMetadata')

const MAX_FIELD_LENGTH = 1024

let watcher = null
let cfg = { enabled: false, webhook: '' }
const seen = new Set()
let onEvent = null

// Splits a list of "[Name](url)" links into <=1024-char groups so each fits
// a single Discord embed field (same convention the old relay server used).
function chunkPlayers (players, maxLen) {
  const chunks = []
  let current = ''
  for (const name of players) {
    const next = current.length ? `${current} | ${name}` : name
    if (next.length > maxLen) { chunks.push(current); current = name } else { current = next }
  }
  if (current) chunks.push(current)
  return chunks
}

// Builds the VRCX-metadata-driven embed: world name links to the world page,
// each player links to their profile, image renders inside the embed itself
// (via attachment://<fileName>, matched to the multipart file part below).
function buildEmbed (metadata, fileName) {
  const world = metadata.world || {}
  const worldLink = world.id ? `[${world.name || 'Unknown World'}](https://vrchat.com/home/world/${world.id})` : (world.name || 'Unknown World')
  const playerLinks = (metadata.players || []).map(p => (p.id ? `[${p.displayName}](https://vrchat.com/home/user/${p.id})` : p.displayName))
  const chunks = chunkPlayers(playerLinks, MAX_FIELD_LENGTH)

  return {
    title: 'VRChat Photo Log Entry',
    description: `**World:** ${worldLink}`,
    color: 0x5865f2,
    timestamp: new Date().toISOString(),
    fields: chunks.length
      ? chunks.map((c, i) => ({ name: i === 0 ? 'Players' : `Players (${i + 1})`, value: c, inline: false }))
      : [{ name: 'Players', value: '_None detected_', inline: false }],
    image: { url: `attachment://${fileName}` }
  }
}

function start (opts = {}, listener) {
  if (listener) onEvent = listener
  cfg = { enabled: !!opts.enabled, webhook: String(opts.webhook || '').trim() }
  stop()
  seen.clear()
  if (!cfg.enabled || !cfg.webhook) return
  const photosDir = resolvePhotosDir()
  if (!fs.existsSync(photosDir)) { if (onEvent) onEvent({ error: 'VRChat photos folder not found' }); return }
  try {
    // Pre-scan existing files so the watcher doesn't re-upload old images on
    // startup (fs.watch on Windows can fire spurious events for existing files).
    try {
      const existing = fs.readdirSync(photosDir).filter(f => /\.png$/i.test(f))
      for (const f of existing) seen.add(path.join(photosDir, f))
    } catch (_) { /* best effort */ }
    watcher = fs.watch(photosDir, { recursive: true }, (evt, fname) => {
      if (fname && /\.png$/i.test(fname)) queue(path.join(photosDir, String(fname)))
    })
    if (onEvent) onEvent({ watching: true })
  } catch (e) { console.warn('photoRelay watch:', e.message); if (onEvent) onEvent({ error: e.message }) }
}

function queue (file) {
  if (seen.has(file)) return
  seen.add(file)
  // Give VRChat time to finish writing the file before uploading.
  setTimeout(() => send(file), 2500)
}

async function send (file) {
  try {
    if (!fs.existsSync(file)) return

    // Embed world/instance/players into the file FIRST (if that toggle is on),
    // then read the file back so we both upload and link the same content -
    // avoids racing the file against screenshotMetadata's own watcher.
    const metadata = screenshotMetadata.isEnabled() ? await screenshotMetadata.embedForFile(file) : null

    const fileName = path.basename(file)
    const buf = fs.readFileSync(file)
    const fd = new FormData()
    if (metadata) {
      fd.append('payload_json', JSON.stringify({ embeds: [buildEmbed(metadata, fileName)] }))
      fd.append('files[0]', new Blob([buf]), fileName)
    } else {
      fd.append('file', new Blob([buf]), fileName)
    }
    await axios.post(cfg.webhook, fd)
    if (onEvent) onEvent({ sent: fileName })
  } catch (e) {
    console.warn('photoRelay send:', e.message)
    if (onEvent) onEvent({ error: e.message })
  }
}

function stop () { if (watcher) { try { watcher.close() } catch (_) {} watcher = null } }

module.exports = { start, stop }

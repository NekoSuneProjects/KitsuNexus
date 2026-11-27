// modules/vrchat/tools/screenshotMetadata.js
// VRCX-compatible screenshot metadata: watches the VRChat photos folder and, for
// every new screenshot, embeds the current world/instance and the players who
// were in it as a PNG "Description" chunk - the same iTXt chunk format and JSON
// shape VRCX itself writes (github.com/vrcx-team/VRCX,
// Dotnet/ScreenshotMetadata/PNGHelper.cs + src/stores/vrcx.js processScreenshot),
// so tools built to read VRCX's metadata can read files this app writes too.
// External/file-based only - nothing leaves this PC. Runs in the MAIN process.

const fs = require('fs')
const path = require('path')
const { resolvePhotosDir } = require('./vrcTools')
const { getVrcWorld } = require('../world/vrchatWorld')

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Standard PNG CRC32 table, used to checksum the chunk we insert.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32 (buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// Matches VRCX's PNGHelper.GenerateTextChunk exactly: uncompressed iTXt, empty
// language tag, empty translated keyword, UTF-8 text.
function makeITxtChunk (keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'), Buffer.from([0]), // keyword + null separator
    Buffer.from([0, 0]), // compression flag (0) + compression method (0)
    Buffer.from([0]), // empty language tag + null separator
    Buffer.from([0]), // empty translated keyword + null separator
    Buffer.from(text, 'utf8')
  ])
  const type = Buffer.from('iTXt', 'ascii')
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0)
  return Buffer.concat([length, type, data, crc])
}

function parseChunks (buf) {
  const chunks = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + len
    const end = dataEnd + 4
    chunks.push({ type, start: offset, dataStart, dataEnd, end })
    offset = end
    if (type === 'IEND') break
  }
  return chunks
}

// Strips any existing "Description" iTXt chunk (so re-processing a file never
// stacks duplicates) and inserts a fresh one right before IEND. Written to a
// temp file and swapped in, so a crash mid-write can't corrupt the photo.
function writeDescriptionChunk (filePath, jsonText) {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('Not a PNG file')

  const chunks = parseChunks(buf)
  const iend = chunks.find(c => c.type === 'IEND')
  if (!iend) { const e = new Error('IEND chunk not found'); e.code = 'INCOMPLETE'; throw e }

  const keep = []
  let cursor = 8
  for (const c of chunks) {
    if (c.type !== 'iTXt') continue
    const nul = buf.indexOf(0, c.dataStart)
    const keywordEnd = (nul === -1 || nul > c.dataEnd) ? c.dataStart : nul
    const keyword = buf.toString('latin1', c.dataStart, keywordEnd)
    if (keyword === 'Description') {
      keep.push(buf.subarray(cursor, c.start))
      cursor = c.end
    }
  }
  keep.push(buf.subarray(cursor, iend.start))
  keep.push(makeITxtChunk('Description', jsonText))
  keep.push(buf.subarray(iend.start))

  const tmp = filePath + '.kntmp'
  fs.writeFileSync(tmp, Buffer.concat([buf.subarray(0, 8), ...keep]))
  try { fs.renameSync(tmp, filePath) } catch (err) { try { fs.rmSync(tmp, { force: true }) } catch (_) {} throw err }
}

// ---- Reading metadata back (gallery) --------------------------------------
// Walks the chunk headers with small reads and skips the image data (IDAT),
// so reading a 4K screenshot's metadata costs a few KB, not the whole file.
// Understands three sources, best first:
//   1. "Description" iTXt JSON: written by KitsuNexus or VRCX (same shape),
//      with players + full instance id
//   2. VRChat's own XMP ("XML:com.adobe.xmp", vrc:WorldID/WorldDisplayName/AuthorID)
//   3. the file name: VRChat_<date>_<time>_<WxH>[_wrld_…].png
// Decode one tEXt/iTXt chunk's data → { keyword, text }.
function decodeTextChunk (type, data) {
  const nul = data.indexOf(0)
  if (nul <= 0) return null
  const keyword = data.toString('latin1', 0, nul)
  if (type === 'tEXt') return { keyword, text: data.toString('latin1', nul + 1) }
  // iTXt: keyword\0 compFlag compMethod lang\0 translated\0 text
  const compressed = data[nul + 1] === 1
  let p = nul + 3
  p = data.indexOf(0, p) + 1 // language tag
  if (p <= 0) return null
  p = data.indexOf(0, p) + 1 // translated keyword
  if (p <= 0) return null
  const body = data.subarray(p)
  try { return { keyword, text: compressed ? require('zlib').inflateSync(body).toString('utf8') : body.toString('utf8') } } catch (_) { return null }
}

// Text chunks live in two places: before the image data (VRChat's XMP) and
// after it, right before IEND (where VRCX and KitsuNexus insert "Description").
// A screenshot has hundreds of IDAT chunks, so walking every header cost
// ~130 ms per 4K photo on a hard disk. So: walk headers only until the first
// IDAT, then read the file's tail once and find chunks there, checking each
// one's CRC so stray bytes in the image data can't pass for a text chunk.
const TAIL_BYTES = 256 * 1024
function readTextChunks (filePath, wanted = ['Description', 'XML:com.adobe.xmp']) {
  const out = {}
  const take = (type, data) => { const t = decodeTextChunk(type, data); if (t && wanted.includes(t.keyword) && !(t.keyword in out)) out[t.keyword] = t.text }
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const size = fs.fstatSync(fd).size
    const head = Buffer.alloc(8)
    if (fs.readSync(fd, head, 0, 8, 0) < 8 || !head.equals(PNG_SIG)) return out
    // 1. Leading chunks, up to the image data.
    let pos = 8
    const hdr = Buffer.alloc(8)
    for (let guard = 0; guard < 64 && pos + 8 <= size; guard++) {
      if (fs.readSync(fd, hdr, 0, 8, pos) < 8) break
      const len = hdr.readUInt32BE(0)
      const type = hdr.toString('ascii', 4, 8)
      if (type === 'IDAT' || type === 'IEND') break
      if ((type === 'iTXt' || type === 'tEXt') && len < 4 * 1024 * 1024) {
        const data = Buffer.alloc(len)
        fs.readSync(fd, data, 0, len, pos + 8)
        take(type, data)
      }
      pos += 12 + len
    }
    // 2. Trailing chunks, from the last TAIL_BYTES of the file.
    const tailStart = Math.max(pos, size - TAIL_BYTES)
    const tail = Buffer.alloc(size - tailStart)
    fs.readSync(fd, tail, 0, tail.length, tailStart)
    for (const type of ['iTXt', 'tEXt']) {
      const marker = Buffer.from(type, 'ascii')
      for (let i = tail.indexOf(marker, 4); i !== -1; i = tail.indexOf(marker, i + 1)) {
        const len = tail.readUInt32BE(i - 4)
        if (i + 4 + len + 4 > tail.length) continue
        const typeAndData = tail.subarray(i, i + 4 + len)
        if (crc32(typeAndData) !== tail.readUInt32BE(i + 4 + len)) continue
        take(type, tail.subarray(i + 4, i + 4 + len))
      }
    }
  } catch (_) {
    /* unreadable / vanished file: no metadata */
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch (_) {}
  }
  return out
}

const xmpTag = (xml, tag) => { const m = String(xml || '').match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : '' }
const decodeXml = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// VRChat has used several layouts over the years, e.g.
//   "VRChat_2026-11-26_21-25-25.936_1920x1080_wrld_a0b6….png"  (current)
//   "VRChat_2022-07-23_12-34-19.635.png"                         (no resolution)
//   "VRChat_1920x1080_2022-01-02_22-10-05.123.png"               (resolution first)
// so each part is found independently. The time is the PC's local time.
function parseFileName (name) {
  const s = String(name)
  if (!/^VRChat_/i.test(s)) return {}
  const out = {}
  const d = s.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.(\d{1,3}))?/)
  if (d) out.takenAt = new Date(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6], +(d[7] || 0)).getTime()
  const r = s.match(/_(\d{3,5})x(\d{3,5})(?=[_.])/)
  if (r) { out.width = +r[1]; out.height = +r[2] }
  const w = s.match(/(wrld_[0-9a-f-]{36})/i)
  out.worldId = w ? w[1] : ''
  return out
}

// Same as readTextChunks, but non-blocking (the gallery reads hundreds of
// files from the main process, which must not freeze while it does).
async function readTextChunksAsync (filePath, wanted = ['Description', 'XML:com.adobe.xmp']) {
  const out = {}
  const take = (type, data) => { const t = decodeTextChunk(type, data); if (t && wanted.includes(t.keyword) && !(t.keyword in out)) out[t.keyword] = t.text }
  let fh
  try {
    fh = await fs.promises.open(filePath, 'r')
    const size = (await fh.stat()).size
    const head = Buffer.alloc(Math.min(size, 16384))
    await fh.read(head, 0, head.length, 0)
    if (head.length < 8 || !head.subarray(0, 8).equals(PNG_SIG)) return out
    let pos = 8
    for (let guard = 0; guard < 64 && pos + 8 <= size; guard++) {
      let hdr
      if (pos + 8 <= head.length) hdr = head.subarray(pos, pos + 8)
      else { hdr = Buffer.alloc(8); await fh.read(hdr, 0, 8, pos) }
      const len = hdr.readUInt32BE(0)
      const type = hdr.toString('ascii', 4, 8)
      if (type === 'IDAT' || type === 'IEND') break
      if ((type === 'iTXt' || type === 'tEXt') && len < 4 * 1024 * 1024) {
        let data
        if (pos + 8 + len <= head.length) data = head.subarray(pos + 8, pos + 8 + len)
        else { data = Buffer.alloc(len); await fh.read(data, 0, len, pos + 8) }
        take(type, data)
      }
      pos += 12 + len
    }
    const tailStart = Math.max(pos, size - TAIL_BYTES)
    const tail = Buffer.alloc(Math.max(0, size - tailStart))
    if (tail.length) await fh.read(tail, 0, tail.length, tailStart)
    for (const type of ['iTXt', 'tEXt']) {
      const marker = Buffer.from(type, 'ascii')
      for (let i = tail.indexOf(marker, 4); i !== -1; i = tail.indexOf(marker, i + 1)) {
        const len = tail.readUInt32BE(i - 4)
        if (i + 4 + len + 4 > tail.length) continue
        if (crc32(tail.subarray(i, i + 4 + len)) !== tail.readUInt32BE(i + 4 + len)) continue
        take(type, tail.subarray(i + 4, i + 4 + len))
      }
    }
  } catch (_) {
    /* unreadable / vanished file */
  } finally {
    if (fh) try { await fh.close() } catch (_) {}
  }
  return out
}

function readMetadata (filePath) { return metaFromChunks(filePath, readTextChunks(filePath)) }
async function readMetadataAsync (filePath) { return metaFromChunks(filePath, await readTextChunksAsync(filePath)) }

function metaFromChunks (filePath, chunks) {
  const fromName = parseFileName(path.basename(filePath))
  const meta = { source: '', author: { id: '', displayName: '' }, world: { name: '', id: fromName.worldId || '', instanceId: '' }, players: [], takenAt: fromName.takenAt || 0, width: fromName.width || 0, height: fromName.height || 0 }
  if (chunks['XML:com.adobe.xmp']) {
    const x = chunks['XML:com.adobe.xmp']
    meta.source = 'VRChat'
    meta.world.id = xmpTag(x, 'vrc:WorldID') || meta.world.id
    meta.world.name = decodeXml(xmpTag(x, 'vrc:WorldDisplayName'))
    meta.author.id = xmpTag(x, 'vrc:AuthorID')
    meta.author.displayName = decodeXml(xmpTag(x, 'xmp:Author'))
    const created = Date.parse(xmpTag(x, 'xmp:CreateDate'))
    if (Number.isFinite(created)) meta.takenAt = created
  }
  if (chunks.Description) {
    try {
      const j = JSON.parse(chunks.Description)
      if (j && typeof j === 'object') {
        meta.source = String(j.application || 'Description')
        if (j.author) meta.author = { id: String(j.author.id || meta.author.id), displayName: String(j.author.displayName || meta.author.displayName) }
        if (j.world) meta.world = { name: String(j.world.name || meta.world.name), id: String(j.world.id || meta.world.id), instanceId: String(j.world.instanceId || '') }
        if (Array.isArray(j.players)) meta.players = j.players.filter(p => p && p.displayName).map(p => ({ id: String(p.id || ''), displayName: String(p.displayName) })).slice(0, 100)
      }
    } catch (_) { /* not JSON: someone else's plain-text description */ }
  }
  return meta
}

// ---- Gallery listing ------------------------------------------------------
// Metadata cache keyed by path + mtime + size, persisted to userData so each
// photo is only ever read from disk once. A cold read is a couple of disk seeks
// (~15 ms on a hard drive), so a 1600-photo library costs ~25 s once, then nothing.
const metaCache = new Map()
let cacheFile = ''
let cacheDirty = false
let cacheSaveTimer = null
function setCacheFile (file) {
  cacheFile = file || ''
  try {
    const obj = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (obj && obj.v === 1 && obj.entries && typeof obj.entries === 'object') for (const [k, m] of Object.entries(obj.entries)) metaCache.set(k, m)
  } catch (_) { /* no cache yet / unreadable: start empty */ }
}
function scheduleCacheSave () {
  if (!cacheFile) return
  cacheDirty = true
  clearTimeout(cacheSaveTimer)
  cacheSaveTimer = setTimeout(flushCache, 3000)
}
function flushCache () {
  if (!cacheFile || !cacheDirty) return
  cacheDirty = false
  try {
    const tmp = cacheFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries: Object.fromEntries(metaCache) }))
    fs.renameSync(tmp, cacheFile)
  } catch (err) { console.warn('screenshot meta cache save:', err.message) }
}

async function metaFor (file) {
  let st
  try { st = await fs.promises.stat(file.path) } catch (_) { return null }
  const key = `${file.path}|${Math.round(st.mtimeMs)}|${st.size}`
  let m = metaCache.get(key)
  if (!m) {
    m = await readMetadataAsync(file.path)
    if (metaCache.size > 20000) metaCache.clear()
    metaCache.set(key, m)
    scheduleCacheSave()
  }
  return { ...file, mtimeMs: st.mtimeMs, size: st.size, meta: m }
}

// Newest first. Sorted by the time in the file name (no per-file stat: that
// alone took ~400 ms for 1600 photos), falling back to name order.
async function listScreenshotFiles (dir = resolvePhotosDir()) {
  const files = []
  const walk = async (d, depth) => {
    let entries
    try { entries = await fs.promises.readdir(d, { withFileTypes: true }) } catch (_) { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (depth < 2) await walk(p, depth + 1) } else if (isScreenshot(e.name)) {
        files.push({ path: p, name: e.name, takenAt: parseFileName(e.name).takenAt || 0 })
      }
    }
  }
  await walk(dir, 0)
  return files.sort((a, b) => (b.takenAt - a.takenAt) || (a.name < b.name ? 1 : -1))
}

// Run fn over items with limited concurrency (keeps the disk queue short).
async function mapLimit (items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const matches = (m, q) => [m.world.name, m.world.id, m.author.displayName, ...m.players.map(p => p.displayName)]
  .some(v => String(v || '').toLowerCase().includes(q))

// { items: [{ path, name, takenAt, mtimeMs, size, meta }], total, dir }
// query matches world name/id, player names and author, case-insensitive.
// onProgress(done, total) is called while a search reads uncached photos.
async function listScreenshots ({ offset = 0, limit = 48, query = '' } = {}, onProgress) {
  const dir = resolvePhotosDir()
  let files = await listScreenshotFiles(dir)
  const q = String(query || '').trim().toLowerCase()
  const start = Math.max(0, Number(offset) || 0)
  const count = Math.min(200, Math.max(1, Number(limit) || 48))
  if (q) {
    let done = 0
    const withMeta = await mapLimit(files, 8, async f => {
      const r = await metaFor(f)
      if (onProgress && ++done % 50 === 0) onProgress(done, files.length)
      return r
    })
    files = withMeta.filter(f => f && matches(f.meta, q))
    return { dir, total: files.length, items: files.slice(start, start + count) }
  }
  const page = (await mapLimit(files.slice(start, start + count), 8, metaFor)).filter(Boolean)
  return { dir, total: files.length, items: page }
}

// Gallery IPC must only ever touch files inside the photos folder.
function isInPhotosDir (filePath) {
  const dir = path.resolve(resolvePhotosDir())
  const p = path.resolve(String(filePath || ''))
  return p.toLowerCase().startsWith(dir.toLowerCase() + path.sep) && isScreenshot(path.basename(p))
}

// Builds the same JSON shape VRCX's processScreenshot() writes: application/
// version/author{id,displayName}/world{name,id,instanceId}/players[{id,displayName}].
function buildMetadata () {
  const w = getVrcWorld()
  const instanceId = (w.worldId && w.instanceId) ? `${w.worldId}:${w.instanceId}` : ''
  return {
    application: 'KitsuNexus',
    version: 1,
    author: { id: w.userId || '', displayName: w.userDisplayName || '' },
    world: { name: w.worldName || '', id: w.worldId || '', instanceId },
    players: (w.playersDetailed || []).map(p => ({ id: p.id || '', displayName: p.displayName }))
  }
}

let watcher = null
let enabled = false
const pending = new Set()

// Only touch actual VRChat screenshots (not Prints/Stickers/Emoji subfolders,
// which VRChat also writes PNGs into) - same filename convention VRCX checks.
function isScreenshot (fileName) {
  return /^VRChat_.*\.png$/i.test(fileName)
}

// Embeds metadata into a single file right now and returns what was written
// (or null on failure) - used by our own watcher below, and callable directly
// by Photo Relay so it can embed-then-upload in one sequence instead of racing
// two independent watchers on the same file.
//
// A file that already carries a "Description" (VRCX's, or ours from an earlier
// pass) is left alone. Before, every existing Description was replaced, which
// caused two problems:
//  - Our own write fired the folder watcher again, so each new screenshot was
//    rewritten every ~2.5 s for as long as the app ran, each time with
//    whoever was in the instance *now*.
//  - With VRCX also running, the two apps overwrote each other's metadata.
// force=true re-embeds anyway (e.g. an explicit "re-tag" action).
async function embedForFile (filePath, { force = false } = {}) {
  try {
    if (!fs.existsSync(filePath)) return null
    if (!force && readTextChunks(filePath, ['Description']).Description) return null
    const metadata = buildMetadata()
    writeDescriptionChunk(filePath, JSON.stringify(metadata))
    return metadata
  } catch (err) {
    if (err.code === 'INCOMPLETE') throw err // caller retries: VRChat still writing
    console.warn('screenshotMetadata write:', err.message)
    return null
  }
}

// Files handled recently: the watcher reports several events per file (and one
// for our own write); each screenshot is processed once.
const handled = new Map() // path -> ts
const HANDLED_TTL = 10 * 60 * 1000

function processFile (filePath, attempt = 0) {
  if (attempt === 0) {
    const t = handled.get(filePath)
    if (pending.has(filePath) || (t && Date.now() - t < HANDLED_TTL)) return
    if (handled.size > 500) for (const [p, ts] of handled) if (Date.now() - ts > HANDLED_TTL) handled.delete(p)
  }
  pending.add(filePath)
  // Give VRChat time to finish writing the file before we touch it.
  setTimeout(async () => {
    try {
      await embedForFile(filePath)
      pending.delete(filePath)
      handled.set(filePath, Date.now())
    } catch (err) {
      // Still being written (no IEND yet): try again a few times.
      if (err.code === 'INCOMPLETE' && attempt < 4 && enabled) return processFile(filePath, attempt + 1)
      pending.delete(filePath)
      handled.set(filePath, Date.now())
    }
  }, 2500)
}

function start () {
  stop()
  enabled = true
  const dir = resolvePhotosDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
    watcher = fs.watch(dir, { recursive: true }, (evt, fname) => {
      // fname is relative ("2026-11\VRChat_….png"); test only the file name part.
      if (fname && isScreenshot(path.basename(String(fname)))) processFile(path.join(dir, String(fname)))
    })
  } catch (err) {
    console.warn('screenshotMetadata watch:', err.message)
  }
}

function stop () {
  enabled = false
  if (watcher) { try { watcher.close() } catch (_) {} watcher = null }
  pending.clear()
}

function isEnabled () { return enabled }

module.exports = {
  start, stop, isEnabled, buildMetadata, writeDescriptionChunk, embedForFile,
  readTextChunks, readTextChunksAsync, readMetadata, readMetadataAsync, parseFileName,
  listScreenshots, isInPhotosDir, setCacheFile, flushCache
}

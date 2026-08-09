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
// stacks duplicates) and inserts a fresh one right before IEND.
function writeDescriptionChunk (filePath, jsonText) {
  const buf = fs.readFileSync(filePath)
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('Not a PNG file')

  const chunks = parseChunks(buf)
  const iend = chunks.find(c => c.type === 'IEND')
  if (!iend) throw new Error('IEND chunk not found')

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

  fs.writeFileSync(filePath, Buffer.concat([buf.subarray(0, 8), ...keep]))
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
async function embedForFile (filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const metadata = buildMetadata()
    writeDescriptionChunk(filePath, JSON.stringify(metadata))
    return metadata
  } catch (err) {
    console.warn('screenshotMetadata write:', err.message)
    return null
  }
}

function processFile (filePath) {
  if (pending.has(filePath)) return
  pending.add(filePath)
  // Give VRChat time to finish writing the file before we touch it.
  setTimeout(() => {
    pending.delete(filePath)
    embedForFile(filePath)
  }, 2500)
}

function start () {
  stop()
  enabled = true
  const dir = resolvePhotosDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
    watcher = fs.watch(dir, { recursive: true }, (evt, fname) => {
      if (fname && isScreenshot(String(fname))) processFile(path.join(dir, String(fname)))
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

module.exports = { start, stop, isEnabled, buildMetadata, writeDescriptionChunk, embedForFile }

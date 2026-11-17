// modules/vrchat/tracking/models.js
// MediaPipe model files for webcam tracking (Google, Apache-2.0). Downloaded
// once from Google's official MediaPipe model storage into
// <userData>/tracking-models, or picked from disk, and checked before use:
// size range, the .task bundle's expected inner files, and (face model) the
// SHA-256 of Google's published file. MAIN process.

const fs = require('fs')
const path = require('path')
const https = require('https')
const crypto = require('crypto')

const MODELS = {
  face: {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    // SHA-256 of Google's face_landmarker.task (float16/1) — same file FoxyFace bundles.
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    minBytes: 2_000_000,
    maxBytes: 8_000_000,
    entries: ['face_blendshapes.tflite', 'face_landmarks_detector.tflite', 'face_detector.tflite']
  },
  hand: {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    sha256: null, // no pinned hash available; checked by size + bundle contents
    minBytes: 3_000_000,
    maxBytes: 20_000_000,
    entries: ['hand_landmarks_detector.tflite', 'hand_detector.tflite']
  },
  pose: {
    file: 'pose_landmarker_full.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    sha256: null, // no pinned hash available; checked by size + bundle contents
    minBytes: 3_000_000,
    maxBytes: 30_000_000,
    entries: ['pose_landmarks_detector.tflite', 'pose_detector.tflite']
  }
}

// A .task file is a zip; check the expected model files are inside it.
function zipEntryNames (buf) {
  const names = []
  // central directory records: signature 0x02014b50
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) continue
    const nameLen = buf.readUInt16LE(i + 28)
    const extraLen = buf.readUInt16LE(i + 30)
    const commentLen = buf.readUInt16LE(i + 32)
    names.push(buf.toString('utf8', i + 46, i + 46 + nameLen))
    i += 45 + nameLen + extraLen + commentLen
  }
  return names
}

function verify (kind, buf) {
  const m = MODELS[kind]
  if (!m) return { ok: false, error: 'Unknown model' }
  if (!Buffer.isBuffer(buf) || buf.length < m.minBytes || buf.length > m.maxBytes) return { ok: false, error: `Unexpected file size for ${m.file}` }
  // zip "end of central directory" record within the last 64 KB (.task files may have leading padding)
  const tail = buf.subarray(Math.max(0, buf.length - 65557))
  if (tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) === -1) return { ok: false, error: `${m.file} isn't a MediaPipe .task bundle` }
  const names = zipEntryNames(buf)
  const missing = m.entries.filter(e => !names.includes(e))
  if (missing.length) return { ok: false, error: `${m.file} is missing ${missing.join(', ')}` }
  if (m.sha256) {
    const h = crypto.createHash('sha256').update(buf).digest('hex')
    if (h !== m.sha256) return { ok: false, error: `${m.file} doesn't match Google's published model (SHA-256)` }
  }
  return { ok: true }
}

function createModelStore (dir) {
  const file = kind => path.join(dir, MODELS[kind].file)
  function status () {
    const out = {}
    for (const k of Object.keys(MODELS)) { let size = 0; try { size = fs.statSync(file(k)).size } catch (_) {} out[k] = { ready: size > 0, size } }
    return out
  }
  function load (kind) {
    const buf = fs.readFileSync(file(kind))
    const v = verify(kind, buf)
    if (!v.ok) throw new Error(v.error)
    return buf
  }
  function save (kind, buf) {
    const v = verify(kind, buf); if (!v.ok) return v
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file(kind) + '.tmp', buf); fs.renameSync(file(kind) + '.tmp', file(kind))
    return { ok: true }
  }
  function importFile (kind, src) {
    let buf; try { buf = fs.readFileSync(src) } catch (e) { return { ok: false, error: e.message } }
    return save(kind, buf)
  }
  function download (kind, onProgress) {
    const m = MODELS[kind]
    if (!m) return Promise.resolve({ ok: false, error: 'Unknown model' })
    return new Promise(resolve => {
      const req = https.get(m.url, { timeout: 30000, headers: { 'User-Agent': 'KitsuNexus' } }, res => {
        if (res.statusCode !== 200) { res.resume(); return resolve({ ok: false, error: `Download failed (HTTP ${res.statusCode})` }) }
        const total = parseInt(res.headers['content-length'], 10) || 0
        if (total > m.maxBytes) { res.resume(); return resolve({ ok: false, error: 'Model file is larger than expected' }) }
        const chunks = []; let got = 0
        res.on('data', c => {
          got += c.length; chunks.push(c)
          if (got > m.maxBytes) { req.destroy(); resolve({ ok: false, error: 'Model file is larger than expected' }) }
          if (typeof onProgress === 'function' && total) onProgress(got / total)
        })
        res.on('end', () => resolve(save(kind, Buffer.concat(chunks))))
      })
      req.on('timeout', () => req.destroy(new Error('timed out')))
      req.on('error', e => resolve({ ok: false, error: 'Download failed: ' + e.message }))
    })
  }
  return { status, load, importFile, download, save, dir }
}

module.exports = { MODELS, createModelStore, verify, zipEntryNames }

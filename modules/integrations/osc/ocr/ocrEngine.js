'use strict'

// modules/integrations/osc/ocr/ocrEngine.js  (MAIN process)
// Tesseract OCR, run in the main process. In the renderer it can't work:
// tesseract.js sees `document` and treats the page as a browser, turning its
// worker path into a file:// URL - but Electron's require() loads its Node
// worker code, and Node's Worker refuses URLs ("must be an absolute path …
// Received file:///…"). So OCR never started. Here in plain Node it works as
// designed, and heavy recognition no longer competes with the UI.

const path = require('path')

let tesseract = null
const workers = new Map() // lang -> Promise<worker>
let cacheDir = ''

function setCacheDir (dir) { cacheDir = dir || '' }

// In a packaged build tesseract.js sits in app.asar.unpacked (see package.json
// asarUnpack); worker_threads can only load a real file from disk.
function workerPath () {
  try {
    const p = require('tesseract.js/src/worker/node/defaultOptions.js').workerPath
    return String(p).replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
  } catch (_) { return undefined }
}

async function getWorker (lang) {
  const key = String(lang || 'eng')
  if (!workers.has(key)) {
    if (!tesseract) tesseract = require('tesseract.js')
    const opts = {}
    const wp = workerPath()
    if (wp) opts.workerPath = wp
    // Language data downloads once; keep it in userData (the default is the
    // current folder, which in an installed app is Program Files).
    // tesseract.js writes <cachePath>/<lang>.traineddata but doesn't create the
    // folder, and a failed write is silent - so without this every start
    // re-downloaded the language data.
    if (cacheDir) {
      opts.cachePath = path.join(cacheDir, 'tesseract')
      try { require('fs').mkdirSync(opts.cachePath, { recursive: true }) } catch (_) {}
    }
    const p = tesseract.createWorker(key, undefined, opts).catch(err => { workers.delete(key); throw err })
    workers.set(key, p)
  }
  return workers.get(key)
}

// Flatten Tesseract's block -> paragraph -> line tree into lines with
// confidence and position (bbox, in image pixels) - the position is what lets
// the on-screen overlay put a translation right above the text it came from.
function linesOf (data) {
  const out = []
  for (const b of data?.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        const box = bb => ({ x0: (bb && bb.x0) | 0, y0: (bb && bb.y0) | 0, x1: (bb && bb.x1) | 0, y1: (bb && bb.y1) | 0 })
        // Word boxes too: trimming a stray edge character (e.g. a bright light
        // read as "©") must also shrink the line's box, or the overlay label
        // is centred between the text and the light.
        const words = (l.words || []).map(w => ({ text: String(w.text || ''), confidence: Number(w.confidence) || 0, bbox: box(w.bbox) }))
        out.push({ text: String(l.text || '').trim(), confidence: Number(l.confidence) || 0, bbox: box(l.bbox), words })
      }
    }
  }
  return out
}

// image: Buffer (PNG/JPEG) or data URL. Returns { text, confidence, lines }.
async function recognize (lang, image) {
  const buf = Buffer.isBuffer(image) ? image : Buffer.from(String(image || '').replace(/^data:image\/\w+;base64,/, ''), 'base64')
  if (!buf.length) throw new Error('No image to read')
  const worker = await getWorker(lang)
  const { data } = await worker.recognize(buf, {}, { text: true, blocks: true })
  return { text: String(data?.text || ''), confidence: Number(data?.confidence) || 0, lines: linesOf(data) }
}

async function shutdown () {
  const all = [...workers.values()]
  workers.clear()
  for (const p of all) { try { (await p).terminate() } catch (_) {} }
}

module.exports = { recognize, setCacheDir, shutdown, linesOf }

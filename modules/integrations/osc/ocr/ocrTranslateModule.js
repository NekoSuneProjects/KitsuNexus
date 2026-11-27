'use strict'

// OCR screen-translate: reads text from a shared screen/window (VRChat's
// own window, typically) via Tesseract.js, then optionally translates it
// and pushes it to the chatbox. Reuses the same getDisplayMedia -> video ->
// canvas -> pixel-data capture scaffolding as OscQrController, swapping
// jsQR for Tesseract's recognize(). Runs in the RENDERER process.

const { createWorker } = require('tesseract.js')
const { parseGiftScreenText, describe: describeGift } = require('../../../vrchat/world/giftEvents')

// tesseract.js computes its worker script path internally via its own
// __dirname, which resolves to a path inside app.asar in a packaged build.
// Unlike require()/fs, worker_threads can't load a script from inside an
// asar archive at all (confirmed by a real "worker script...must be an
// absolute path" failure) - tesseract.js IS in asarUnpack (package.json),
// so the real file exists on disk, just not at this computed path. Patch
// it to the unpacked copy; a no-op in dev where there's no asar at all.
//
// The default can also be a file:// URL, which Node's Worker rejects ("must be
// an absolute path ... Received file:///D:/…/worker-script/node/index.js") -
// that made OCR fail to start at all. Convert it to a plain path first.
function getWorkerPath () {
  try {
    let p = require('tesseract.js/src/worker/node/defaultOptions.js').workerPath
    if (!p) return null
    if (/^file:/i.test(String(p))) p = require('url').fileURLToPath(p)
    return String(p).replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked')
  } catch (_) {
    return null
  }
}

// "Auto" reading modes load several Tesseract languages at once, so text in
// any of them is read; the translator then detects which one it actually is.
const OCR_LANG_PRESETS = {
  // Fastest useful mode (~1-2 s per 1080p frame vs ~3-8 s for all eight):
  // Spanish adds ñ ¿ ¡ and accents, and the English model still reads other
  // Latin-alphabet languages (accents may drop, translation copes).
  fast_latin: 'eng+spa',
  auto_latin: 'eng+spa+fra+deu+ita+por+nld+pol',
  auto_latin_cyrillic: 'eng+spa+fra+deu+rus+ukr',
  auto_asian: 'eng+jpn+chi_sim+kor'
}
const resolveOcrLang = l => OCR_LANG_PRESETS[l] || l || 'eng'

// Part of the screen to read (fractions of width / height). Reading only where
// the text is (a chatbox, subtitles) is faster and far less noisy.
const OCR_REGIONS = {
  full: [0, 0, 1, 1],
  center: [0.15, 0.2, 0.7, 0.6],
  bottom_half: [0, 0.5, 1, 0.5],
  bottom_third: [0, 0.66, 1, 0.34],
  top_half: [0, 0, 1, 0.5]
}

/// OCR output varies a little between frames (spacing, a stray character);
// compare a normalised form so the same line isn't re-translated.
const normalizeText = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
function similar (a, b) {
  const x = normalizeText(a); const y = normalizeText(b)
  if (!x || !y) return false
  if (x === y) return true
  const wa = new Set(x.split(' ')); const wb = new Set(y.split(' '))
  const inter = [...wa].filter(w => wb.has(w)).length
  return inter / Math.max(wa.size, wb.size) >= 0.85
}

// Keep lines Tesseract is reasonably sure about, so random UI noise isn't sent
// off for translation.
function cleanOcrText (data, minConfidence = 55) {
  const lines = Array.isArray(data?.lines) && data.lines.length
    ? data.lines.filter(l => (l.confidence ?? 100) >= minConfidence).map(l => String(l.text || '').trim())
    : String(data?.text || '').split(/\r?\n/).map(l => l.trim())
  return lines
    .filter(l => (l.match(/\p{L}/gu) || []).length >= 2) // at least two letters
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

// ---- "Light text" mode (VRChat chatbox) --------------------------------------
// VRChat's chatbox text is near-white and colourless on a dark bubble, while the
// scene around it is coloured, nameplates are yellow and the player list is
// grey. Keeping only bright, colourless pixels (as black text on white) removed
// almost all scene noise and cut OCR time ~3-5x on real VRChat screenshots
// ("Hola" read cleanly instead of "i ) NI / Hola"; 2.8 s instead of 14.4 s).
// Thresholds picked on those screenshots.
const LIGHT_TEXT = { minLum: 215, maxSat: 30, minConfidence: 75 }
function brightTextFilter (rgba, minLum = LIGHT_TEXT.minLum, maxSat = LIGHT_TEXT.maxSat) {
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]; const g = rgba[i + 1]; const b = rgba[i + 2]
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b)
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b)
    const v = (mx >= minLum && mx - mn <= maxSat) ? 0 : 255
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v
    rgba[i + 3] = 255
  }
  return rgba
}

// Drop stray characters OCR picks up at the edges of a line ("Hola ©",
// "e Twice", "7 Listening to…"): leading/trailing tokens that are a single
// character or contain no letters. Returns '' for lines that are mostly junk.
function trimLine (text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean)
  const isTime = t => /^\d{1,2}:\d{2}$/.test(t)
  // Edge junk: single characters, tokens without letters, and icon fragments
  // like "Lo)" / "O)" (an avatar icon read as text before a gift banner).
  const junk = t => !isTime(t) && (t.length <= 1 || !/\p{L}/u.test(t) || /^[^\p{L}]*\p{L}{1,2}[()[\]{}|]+[^\p{L}]*$/u.test(t))
  while (tokens.length && junk(tokens[0])) tokens.shift()
  while (tokens.length && junk(tokens[tokens.length - 1])) tokens.pop()
  const out = tokens.join(' ')
  const letters = (out.match(/\p{L}/gu) || []).length
  const visible = out.replace(/\s/g, '').length
  if (letters < 2 || (visible && letters / visible < 0.5)) return ''
  return out
}

// Tesseract joins things that merely share a row into one line - e.g. the Hype
// Train counter at the top-left and a gift banner in the middle ("VRC+ gifts
// Salsa Shark has gifted"). Split a line wherever the gap between two words is
// much wider than the text is tall: those are separate on-screen elements.
function splitLineByGaps (line) {
  const words = Array.isArray(line.words) ? line.words.filter(w => String(w.text).trim()) : []
  if (words.length < 2) return [line]
  const h = Math.max(1, line.bbox ? line.bbox.y1 - line.bbox.y0 : 20)
  const parts = [[words[0]]]
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > h * 2) parts.push([])
    parts[parts.length - 1].push(words[i])
  }
  if (parts.length === 1) return [line]
  return parts.map(ws => ({
    ...line,
    words: ws,
    text: ws.map(w => String(w.text).trim()).join(' '),
    bbox: ws.reduce((b, w) => ({ x0: Math.min(b.x0, w.bbox.x0), y0: Math.min(b.y0, w.bbox.y0), x1: Math.max(b.x1, w.bbox.x1), y1: Math.max(b.y1, w.bbox.y1) }), { ...ws[0].bbox })
  }))
}

// trimLine for a line with word boxes. Words are filtered by their OWN
// confidence first - a line's average is dragged down by one junk word (a
// light read as "©"), which dropped real text like "Hola" - and the line's box
// is rebuilt from only the words that are kept.
function trimLineWithBox (line, minWordConf = 0) {
  const hasWords = Array.isArray(line.words) && line.words.length
  const confident = hasWords ? line.words.filter(w => (w.confidence ?? 100) >= minWordConf && String(w.text).trim()) : []
  const text = trimLine(hasWords ? confident.map(w => String(w.text).trim()).join(' ') : line.text)
  if (!text || !hasWords) return { ...line, text }
  const keep = new Set(text.split(/\s+/))
  const kept = confident.filter(w => keep.has(String(w.text).trim()))
  if (!kept.length) return { ...line, text }
  const bbox = kept.reduce((b, w) => ({ x0: Math.min(b.x0, w.bbox.x0), y0: Math.min(b.y0, w.bbox.y0), x1: Math.max(b.x1, w.bbox.x1), y1: Math.max(b.y1, w.bbox.y1) }), { ...kept[0].bbox })
  return { ...line, text, bbox }
}

// Group OCR lines into chatbox bubbles: lines stacked closely on top of each
// other with overlapping horizontal extents belong to the same bubble.
// lines: [{ text, bbox: { x0, y0, x1, y1 } }] -> [{ text, bbox }]
function groupBubbles (lines) {
  const sorted = lines.filter(l => l.text && l.bbox).slice().sort((a, b) => a.bbox.y0 - b.bbox.y0)
  const bubbles = []
  for (const l of sorted) {
    const h = Math.max(1, l.bbox.y1 - l.bbox.y0)
    // Same bubble: directly below the previous line (small gap, no real
    // vertical overlap) and centred with it - VRChat centres chatbox lines.
    const owner = bubbles.find(b => {
      const gap = l.bbox.y0 - b.bbox.y1
      const cxLine = (l.bbox.x0 + l.bbox.x1) / 2
      const cxBubble = (b.bbox.x0 + b.bbox.x1) / 2
      const width = Math.max(l.bbox.x1 - l.bbox.x0, b.bbox.x1 - b.bbox.x0)
      return gap >= -h * 0.3 && gap <= h * 1.2 && Math.abs(cxLine - cxBubble) <= width * 0.25 + h
    })
    if (owner) {
      owner.text += '\n' + l.text
      owner.bbox = { x0: Math.min(owner.bbox.x0, l.bbox.x0), y0: Math.min(owner.bbox.y0, l.bbox.y0), x1: Math.max(owner.bbox.x1, l.bbox.x1), y1: Math.max(owner.bbox.y1, l.bbox.y1) }
    } else {
      bubbles.push({ text: l.text, bbox: { ...l.bbox } })
    }
  }
  return bubbles
}

class OcrTranslateController {
  constructor ({ translate, sendChatboxMessage, onUpdate = () => {}, getDisplayMedia, recognize, onOverlay, onGift, getExcludeRects } = {}) {
    // getExcludeRects(frameWidth, frameHeight) -> [{ x0, y0, x1, y1 }]: our own
    // windows (HUD etc.) in frame pixels, blanked out before OCR.
    this.getExcludeRects = typeof getExcludeRects === 'function' ? getExcludeRects : null
    // onGift({ name, detail, from, amount }): a VRC+ gift banner was read on screen.
    this.onGift = typeof onGift === 'function' ? onGift : null
    this.recentGifts = new Map() // gift key -> time, so each banner alerts once
    // onOverlay({ labels, frameWidth, frameHeight }): positioned translations
    // for the on-screen overlay (labels in captured-frame pixels).
    this.onOverlay = typeof onOverlay === 'function' ? onOverlay : null
    this.bubbleCache = new Map() // normalised bubble text -> translation ('' = none needed)
    // recognize(lang, pngDataUrl) -> { text, lines } runs OCR in the main process;
    // the in-renderer Tesseract worker is only a fallback.
    this.recognizeRemote = typeof recognize === 'function' ? recognize : null
    this.translate = typeof translate === 'function' ? translate : null
    this.sendChatboxMessage = typeof sendChatboxMessage === 'function' ? sendChatboxMessage : null
    this.onUpdate = onUpdate
    this.getDisplayMedia = getDisplayMedia || (constraints => navigator.mediaDevices.getDisplayMedia(constraints))

    this.config = { intervalMs: 3000, tesseractLang: 'eng', toChatbox: false, region: 'full', minConfidence: 55, textStyle: 'light' }
    this.enabled = false
    this.stream = null
    this.video = null
    this.canvas = null
    this.context = null
    this.timer = null
    this.worker = null
    this.workerLang = null
    this.busy = false
    this.lastText = ''
    this.lastTranslated = ''
    this.status = 'Stopped'
    this.error = ''
  }

  configure (config = {}) {
    this.config = {
      intervalMs: Math.max(1000, Math.min(15000, Number(config.intervalMs) || 3000)),
      tesseractLang: String(config.tesseractLang || 'eng'),
      toChatbox: !!config.toChatbox,
      region: OCR_REGIONS[config.region] ? config.region : 'full',
      textStyle: config.textStyle === 'any' ? 'any' : 'light',
      minConfidence: Math.max(0, Math.min(95, Number(config.minConfidence) || 55))
    }
    if (this.enabled) this.startTimer()
    return this.getState()
  }

  async ensureWorker () {
    if (this.recognizeRemote) return null
    const lang = resolveOcrLang(this.config.tesseractLang)
    if (this.worker && this.workerLang === lang) return this.worker
    if (this.worker) { try { await this.worker.terminate() } catch (_) {} }
    const workerPath = getWorkerPath()
    this.worker = await createWorker(lang, undefined, workerPath ? { workerPath } : {})
    this.workerLang = lang
    return this.worker
  }

  async start () {
    if (this.enabled && this.stream) return this.getState()
    this.status = 'Choose the screen or window to read…'
    this.error = ''
    this.emit('starting')
    try {
      this.stream = await this.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      this.video = document.createElement('video')
      this.video.muted = true
      this.video.playsInline = true
      this.video.srcObject = this.stream
      await this.video.play()
      this.canvas = document.createElement('canvas')
      this.context = this.canvas.getContext('2d', { willReadFrequently: true })
      this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop())
      this.status = 'Loading OCR model…'
      this.emit('loading')
      if (!this.recognizeRemote) await this.ensureWorker()
      this.enabled = true
      this.status = 'Reading the shared screen'
      this.startTimer()
      this.emit('started')
    } catch (err) {
      this.error = err.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : err.message
      this.status = 'Could not start screen capture'
      this.enabled = false
      this.emit('error')
    }
    return this.getState()
  }

  stop () {
    this.stopTimer()
    if (this.stream) this.stream.getTracks().forEach(track => track.stop())
    this.stream = null
    this.video = null
    this.canvas = null
    this.context = null
    this.enabled = false
    this.status = 'Stopped'
    if (this.onOverlay) { try { this.onOverlay({ labels: [], frameWidth: 0, frameHeight: 0, stopped: true }) } catch (_) {} }
    this.emit('stopped')
    return this.getState()
  }

  startTimer () {
    this.stopTimer()
    this.timer = setInterval(() => this.scanFrame(), this.config.intervalMs)
  }

  stopTimer () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async scanFrame () {
    if (this.busy || !this.enabled || !this.video || this.video.readyState < 2 || !this.context || (!this.worker && !this.recognizeRemote)) return
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (!vw || !vh) return
    // Busy for the whole scan: looking up our own window positions can take a
    // moment (window capture asks Windows), and the next tick must not overlap.
    this.busy = true
    try {
      await this.scanCurrentFrame(vw, vh)
    } catch (err) {
      this.error = err.message
      this.emit('error')
    } finally {
      this.busy = false
    }
  }

  async scanCurrentFrame (vw, vh) {
    const [rx, ry, rw, rh] = OCR_REGIONS[this.config.region] || OCR_REGIONS.full
    const sx = Math.round(vw * rx); const sy = Math.round(vh * ry)
    const sw = Math.max(1, Math.round(vw * rw)); const sh = Math.max(1, Math.round(vh * rh))
    if (this.canvas.width !== sw || this.canvas.height !== sh) {
      this.canvas.width = sw
      this.canvas.height = sh
    }
    this.context.drawImage(this.video, sx, sy, sw, sh, 0, 0, sw, sh)
    if (this.config.textStyle === 'light') {
      const img = this.context.getImageData(0, 0, sw, sh)
      brightTextFilter(img.data)
      this.context.putImageData(img, 0, 0)
    }
    // Blank out KitsuNexus' own windows (HUD, widgets) so they're never read back.
    if (this.getExcludeRects) {
      try {
        const rects = await this.getExcludeRects(vw, vh)
        this.context.fillStyle = '#ffffff'
        for (const r of rects || []) this.context.fillRect(r.x0 - sx, r.y0 - sy, r.x1 - r.x0, r.y1 - r.y0)
      } catch (_) {}
    }
    await this.recognizeCanvas(this.canvas, { vw, vh, sx, sy })
  }

  // OCR one canvas (a captured frame, or any image) and handle its text.
  // frame: where this canvas sits in the full captured frame ({ vw, vh, sx, sy })
  // so on-screen labels can be placed over the right spot.
  async recognizeCanvas (canvas, frame = { vw: canvas.width, vh: canvas.height, sx: 0, sy: 0 }) {
    const light = this.config.textStyle === 'light'
    const minConf = light ? Math.max(this.config.minConfidence, LIGHT_TEXT.minConfidence) : this.config.minConfidence
    let r
    if (this.recognizeRemote) {
      r = await this.recognizeRemote(resolveOcrLang(this.config.tesseractLang), canvas.toDataURL('image/png'))
      if (!r || r.ok === false) throw new Error((r && r.error) || 'OCR failed')
    } else {
      await this.ensureWorker()
      const { data } = await this.worker.recognize(canvas)
      r = data
    }
    // Lines with a position (main-process engine): clean each, group into
    // bubbles, translate per bubble.
    const lines = Array.isArray(r.lines) ? r.lines : []
    if (lines.length && lines[0].bbox) {
      // With word confidences, filter per word; otherwise per line.
      const perWord = lines.some(l => Array.isArray(l.words) && l.words.length)
      const kept = lines
        .filter(l => perWord || (l.confidence ?? 100) >= minConf)
        .flatMap(splitLineByGaps)
        .map(l => trimLineWithBox(l, minConf))
        .filter(l => l.text)
      return this.handleBubbles(groupBubbles(kept), frame)
    }
    return this.handleText(cleanOcrText(r, minConf))
  }

  // Per-bubble translation. Each bubble is translated once (bubbleCache), the
  // combined text goes to the chatbox / HUD when it changes, and the positioned
  // labels are re-sent on every scan so a label stays over its bubble while the
  // bubble is on screen and disappears with it.
  async handleBubbles (bubbles, frame) {
    const labels = []
    const translations = []
    for (const b of bubbles) {
      const key = normalizeText(b.text)
      if (!key) continue
      // VRC+ gift banner ("Sent From Space gifted VRC+ 1"): label it on screen
      // and alert once - VRChat doesn't log who gifted, the screen is the only source.
      const gift = parseGiftScreenText(b.text.replace(/\n/g, ' '))
      if (gift) {
        const d = describeGift(gift)
        labels.push({ text: `🎁 ${d.name} - ${d.detail}`, original: b.text, x0: b.bbox.x0 + frame.sx, y0: b.bbox.y0 + frame.sy, x1: b.bbox.x1 + frame.sx, y1: b.bbox.y1 + frame.sy })
        const gk = `${gift.from}|${gift.to || ''}|${gift.amount || ''}`
        const now = Date.now()
        // Gifts to YOU are in VRChat's log (type: vrcplus, with the gifter's
        // name and id) and alerted from there - label the banner, don't alert twice.
        if (gift.to !== 'you' && now - (this.recentGifts.get(gk) || 0) > 60000) {
          this.recentGifts.set(gk, now)
          if (this.onGift) { try { this.onGift({ ...d, from: gift.from, to: gift.to, amount: gift.amount }) } catch (_) {} }
        }
        continue
      }
      let tr = this.bubbleCache.get(key)
      if (tr === undefined) {
        tr = ''
        if (this.translate) { try { tr = (await this.translate(b.text)) || '' } catch (_) { tr = '' } }
        if (this.bubbleCache.size > 200) this.bubbleCache.clear()
        this.bubbleCache.set(key, tr)
      }
      if (tr) {
        translations.push(tr)
        labels.push({ text: tr, original: b.text, x0: b.bbox.x0 + frame.sx, y0: b.bbox.y0 + frame.sy, x1: b.bbox.x1 + frame.sx, y1: b.bbox.y1 + frame.sy })
      }
    }
    if (this.onOverlay) { try { this.onOverlay({ labels, frameWidth: frame.vw, frameHeight: frame.vh }) } catch (_) {} }

    const text = bubbles.map(b => b.text).join('\n')
    if (!text || text === this.lastText || similar(text, this.lastText)) return
    this.lastText = text
    this.lastTranslated = translations.join('\n')
    this.status = bubbles.length > 1 ? `Text detected (${bubbles.length} bubbles)` : 'Text detected'
    if (this.config.toChatbox && this.sendChatboxMessage) this.sendChatboxMessage((this.lastTranslated || text).slice(0, 144), false)
    this.emit('detected')
  }

  async handleText (text) {
    if (!text || text === this.lastText || similar(text, this.lastText)) return
    this.lastText = text
    this.status = 'Text detected'

    let translated = ''
    if (this.translate) {
      try { translated = await this.translate(text) } catch (_) { translated = '' }
    }
    this.lastTranslated = translated

    if (this.config.toChatbox && this.sendChatboxMessage) {
      this.sendChatboxMessage((translated || text).slice(0, 144), false)
    }
    this.emit('detected')
  }

  emit (event) { this.onUpdate(this.getState(event)) }

  getState (event = '') {
    return {
      event,
      enabled: this.enabled,
      status: this.status,
      error: this.error,
      lastText: this.lastText,
      lastTranslated: this.lastTranslated,
      config: { ...this.config }
    }
  }

  async destroy () {
    this.stop()
    if (this.worker) { try { await this.worker.terminate() } catch (_) {} }
    this.worker = null
  }
}

module.exports = { OcrTranslateController, OCR_LANG_PRESETS, OCR_REGIONS, LIGHT_TEXT, resolveOcrLang, cleanOcrText, similar, brightTextFilter, trimLine, groupBubbles }

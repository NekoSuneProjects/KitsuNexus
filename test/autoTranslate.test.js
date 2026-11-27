'use strict'
// Translator providers, offline language detection and the OCR text helpers.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { detectLanguageLocal } = require('../modules/ai/langDetect')
const tp = require('../modules/ai/translateProviders')
const ocr = require('../modules/integrations/osc/ocr/ocrTranslateModule')
const { linesOf } = require('../modules/integrations/osc/ocr/ocrEngine')

test('offline detector recognises common languages and stays unsure on slang', () => {
  const cases = {
    'Hola amigos, ¿cómo están todos hoy?': 'es', 'Good morning everyone, how are you?': 'en',
    'Bonjour tout le monde, comment ça va?': 'fr', 'Hallo zusammen, wie geht es euch?': 'de',
    'Olá pessoal, tudo bem com vocês?': 'pt', 'Cześć wszystkim, jak się macie?': 'pl',
    'こんにちは、元気ですか': 'ja', '你好，你今天怎么样': 'zh', '안녕하세요 잘 지내세요': 'ko',
    'Привет всем, как дела?': 'ru', 'Привіт усім, як справи?': 'uk', 'مرحبا كيف حالك': 'ar'
  }
  for (const [text, lang] of Object.entries(cases)) assert.equal(detectLanguageLocal(text).lang, lang, text)
  assert.equal(detectLanguageLocal('lol gg').lang, '')
})

test('text already in the target language is skipped without any network call', async () => {
  const r = await tp.translateText({ provider: 'deepl', source: 'auto', target: 'en', text: 'Good morning everyone, how are you?' })
  assert.equal(r.sameLanguage, true)
  assert.equal(r.provider, 'local')
  assert.equal(r.translatedText, 'Good morning everyone, how are you?')
})

test('providers are grouped by cost and include free, free-tier, paid and self-hosted', () => {
  const tiers = new Set(Object.values(tp.TRANSLATE_PROVIDERS).map(p => p.tier))
  for (const t of ['free', 'free-key', 'paid', 'selfhost']) assert.ok(tiers.has(t), t)
  for (const k of ['google_free', 'mymemory', 'deepl', 'microsoft', 'ai', 'lingva', 'libretranslate_custom']) assert.ok(tp.TRANSLATE_PROVIDERS[k], k)
})

test('self-hosted LibreTranslate: detected language is passed through and results are cached', async () => {
  let hits = 0
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c }); req.on('end', () => {
      hits++
      const j = JSON.parse(b)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ translatedText: `[${j.target}] ${j.q}`, detectedLanguage: { language: 'es', confidence: 90 } }))
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const endpoint = `http://127.0.0.1:${srv.address().port}/translate`
  try {
    const a = await tp.translateText({ provider: 'libretranslate_custom', endpoint, source: 'auto', target: 'en', text: 'Necesito ayuda por favor' })
    assert.equal(a.translatedText, '[en] Necesito ayuda por favor')
    assert.equal(a.detectedSourceLang, 'es')
    assert.equal(a.sameLanguage, false)
    const b = await tp.translateText({ provider: 'libretranslate_custom', endpoint, source: 'auto', target: 'en', text: 'Necesito ayuda por favor' })
    assert.equal(b.cached, true)
    assert.equal(hits, 1, 'second identical request came from the cache')
  } finally { srv.close() }
})

test('OCR helpers: auto modes, noise filtering and near-duplicate detection', () => {
  assert.equal(ocr.resolveOcrLang('auto_latin'), 'eng+spa+fra+deu+ita+por+nld+pol')
  assert.equal(ocr.resolveOcrLang('auto_asian'), 'eng+jpn+chi_sim+kor')
  assert.equal(ocr.resolveOcrLang('jpn'), 'jpn')
  assert.equal(ocr.cleanOcrText({ lines: [{ text: 'Hola amigos', confidence: 91 }, { text: '|| ~ .', confidence: 30 }, { text: 'x', confidence: 99 }] }), 'Hola amigos')
  assert.equal(ocr.similar('Hola amigos, como estan', 'hola  amigos como estan!'), true)
  assert.equal(ocr.similar('Hola amigos', 'Adios'), false)
  assert.deepEqual(Object.keys(ocr.OCR_REGIONS).sort(), ['bottom_half', 'bottom_third', 'center', 'full', 'top_half'])
})

test('OCR engine flattens Tesseract blocks into lines with confidence, position and words', () => {
  const lines = linesOf({ blocks: [{ paragraphs: [{ lines: [
    { text: 'Hola ', confidence: 90, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 }, words: [{ text: 'Hola', confidence: 91, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } }] },
    { text: 'amigos', confidence: 70 }
  ] }] }] })
  assert.equal(lines[0].text, 'Hola')
  assert.deepEqual(lines[0].bbox, { x0: 10, y0: 20, x1: 60, y1: 40 })
  assert.deepEqual(lines[0].words, [{ text: 'Hola', confidence: 91, bbox: { x0: 10, y0: 20, x1: 60, y1: 40 } }])
  assert.equal(lines[1].confidence, 70)
  assert.deepEqual(lines[1].words, [])
})

test('removed NekoSuneVR servers: saved settings move to free working providers', () => {
  const ai = require('../modules/ai/aiProviders')
  assert.equal(ai.AI_PROVIDERS.nekosune_ollama, undefined)
  const a = ai.migrateAiConfig({ provider: 'nekosune_ollama', baseUrl: 'https://ollama.nekosunevr.co.uk/v1', model: 'llama3.1', key: '' })
  assert.equal(a.changed, true); assert.equal(a.cfg.provider, 'pollinations'); assert.equal(a.cfg.baseUrl, ai.AI_PROVIDERS.pollinations.baseUrl)
  const custom = ai.migrateAiConfig({ provider: 'custom', baseUrl: 'https://ollama.nekosunevr.co.uk/v1' })
  assert.equal(custom.cfg.provider, 'pollinations', 'a custom entry pointing at the dead server moves too')
  assert.equal(ai.migrateAiConfig({ provider: 'groq', baseUrl: ai.AI_PROVIDERS.groq.baseUrl }).changed, false)

  assert.equal(tp.TRANSLATE_PROVIDERS.libretranslate, undefined)
  const t = tp.migrateTranslatorConfig({ provider: 'libretranslate', endpoint: 'https://translator.nekosunevr.co.uk/translate' })
  assert.equal(t.cfg.provider, 'google_free')
  const own = tp.migrateTranslatorConfig({ provider: 'libretranslate', endpoint: 'http://my-server:5000/translate' })
  assert.equal(own.cfg.provider, 'libretranslate_custom', 'someone\'s own LibreTranslate keeps working')
  assert.equal(own.cfg.endpoint, 'http://my-server:5000/translate')
})

test('VRChat chatbox mode: bright-text filter, edge trimming and bubble grouping', () => {
  // bright colourless pixel -> black text; coloured / dark pixel -> white
  const px = Buffer.from([240, 240, 240, 255, 240, 200, 40, 255, 30, 30, 35, 255])
  ocr.brightTextFilter(px)
  assert.deepEqual([...px], [0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255])
  assert.equal(ocr.trimLine('Hola ©'), 'Hola')
  assert.equal(ocr.trimLine('e Twice'), 'Twice')
  assert.equal(ocr.trimLine('7 Listening to Shaboozey - Blink'), 'Listening to Shaboozey - Blink')
  assert.equal(ocr.trimLine('| ~ .'), '')
  const bubbles = ocr.groupBubbles([
    { text: 'Listening to Shaboozey - Blink', bbox: { x0: 550, y0: 175, x1: 1140, y1: 230 } },
    { text: 'Twice', bbox: { x0: 800, y0: 235, x1: 910, y1: 275 } },
    { text: 'Hola', bbox: { x0: 940, y0: 255, x1: 985, y1: 280 } } // another person's bubble overlapping on screen
  ])
  assert.equal(bubbles.length, 2)
  assert.equal(bubbles[0].text, 'Listening to Shaboozey - Blink\nTwice')
  assert.equal(bubbles[1].text, 'Hola')
})

test('per-bubble translation sends positioned labels (word boxes, not the junk-inflated line box)', async () => {
  let overlay = null
  const c = new ocr.OcrTranslateController({
    recognize: async () => ({
      lines: [{ text: 'Hola ©', confidence: 60, bbox: { x0: 941, y0: 259, x1: 1187, y1: 290 },
        words: [{ text: 'Hola', confidence: 92, bbox: { x0: 941, y0: 259, x1: 981, y1: 285 } }, { text: '©', confidence: 20, bbox: { x0: 1140, y0: 240, x1: 1187, y1: 290 } }] },
      { text: 'Good morning', confidence: 95, bbox: { x0: 100, y0: 600, x1: 300, y1: 630 }, words: [{ text: 'Good', confidence: 95, bbox: { x0: 100, y0: 600, x1: 180, y1: 630 } }, { text: 'morning', confidence: 95, bbox: { x0: 190, y0: 600, x1: 300, y1: 630 } }] }]
    }),
    translate: async t => (/hola/i.test(t) ? 'Hello' : ''), // '' = already in the target language
    onOverlay: p => { overlay = p }
  })
  c.configure({ tesseractLang: 'fast_latin', textStyle: 'light' })
  await c.recognizeCanvas({ width: 1920, height: 1080, toDataURL: () => '' }, { vw: 1920, vh: 1080, sx: 0, sy: 0 })
  assert.equal(c.lastText, 'Hola\nGood morning')
  assert.deepEqual(overlay.labels.map(l => [l.text, l.x0, l.x1]), [['Hello', 941, 981]])
})

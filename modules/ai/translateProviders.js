// modules/ai/translateProviders.js
// Multi-provider text translation, grouped by cost (free / free tier / paid /
// self-hosted). Every provider returns { translatedText, detectedSourceLang },
// so callers (Translator card, OCR screen translate, desktop overlay) can
// auto-detect the language and skip text that's already in the target
// language. Runs in the MAIN process.

const axios = require('axios')
const { chatOnce, explainError } = require('./aiProviders')
const { detectLanguageLocal } = require('./langDetect')

// tier: 'free' (no key) | 'free-key' (free tier with a free key) | 'paid' | 'selfhost'
const TRANSLATE_PROVIDERS = {
  google_free: { label: 'Google Translate (free, no key)', tier: 'free', needsEndpoint: false, needsKey: false },
  mymemory: { label: 'MyMemory (free, no key)', tier: 'free', needsEndpoint: false, needsKey: false },
  deepl: { label: 'DeepL (free tier key, or Pro)', tier: 'free-key', needsEndpoint: false, needsKey: true },
  microsoft: { label: 'Microsoft Translator (Azure, free tier)', tier: 'free-key', needsEndpoint: false, needsKey: true, needsRegion: true },
  google: { label: 'Google Cloud Translation (free tier key)', tier: 'free-key', needsEndpoint: false, needsKey: true },
  ai: { label: 'AI translation (uses your AI provider: free OpenRouter, Gemini, Groq…)', tier: 'free-key', needsEndpoint: false, needsKey: false },
  libretranslate_com: { label: 'LibreTranslate.com (paid key)', tier: 'paid', needsEndpoint: false, needsKey: true, endpoint: 'https://libretranslate.com/translate' },
  libretranslate_custom: { label: 'LibreTranslate (self-hosted)', tier: 'selfhost', needsEndpoint: true, needsKey: false, endpoint: 'http://localhost:5000/translate' },
  lingva: { label: 'Lingva Translate (self-hosted)', tier: 'selfhost', needsEndpoint: true, needsKey: false, endpoint: 'http://localhost:3000' }
}

const TRANSLATE_TIER_LABELS = { free: 'Free — no key', 'free-key': 'Free tier — free account / key', paid: 'Paid', selfhost: 'Self-hosted — free, on your PC / server' }

// "zh-CN" / "pt_BR" / "EN-GB" -> "zh" / "pt" / "en", for comparing languages.
const baseLang = l => String(l || '').toLowerCase().replace('_', '-').split('-')[0]

// ---- Google Translate (free web endpoint, no key) ----------------------------
// The endpoint Google's own lightweight clients use. Unofficial but stable for
// years; it also returns the detected source language.
async function translateGoogleFree ({ source, target, text }) {
  const res = await axios.get('https://translate.googleapis.com/translate_a/single', {
    params: { client: 'gtx', sl: source && source !== 'auto' ? source : 'auto', tl: target || 'en', dt: 't', q: text },
    timeout: 20000
  })
  const d = res.data
  const translatedText = Array.isArray(d?.[0]) ? d[0].map(seg => (Array.isArray(seg) ? seg[0] : '')).join('') : ''
  return { translatedText: translatedText || text, detectedSourceLang: typeof d?.[2] === 'string' ? d[2] : '' }
}

// Language detection only (free): used where a provider can't auto-detect.
async function detectLanguage (text) {
  const local = detectLanguageLocal(text)
  if (local.lang && local.confidence >= 0.5) return local.lang
  try {
    const r = await translateGoogleFree({ source: 'auto', target: 'en', text: String(text).slice(0, 300) })
    return r.detectedSourceLang || ''
  } catch (_) { return '' }
}

// ---- MyMemory (free, no key) -------------------------------------------------
// MyMemory rejects source "auto" - and returns that error AS the translated
// text ("'AUTO' IS AN INVALID SOURCE LANGUAGE"), which the app used to show as
// the translation. Detect the language first instead.
async function translateMyMemory ({ source, target, text }) {
  let src = source && source !== 'auto' ? source : await detectLanguage(text)
  if (!src) throw new Error('MyMemory needs a source language and it could not be detected - pick one instead of Auto-detect')
  if (baseLang(src) === baseLang(target)) return { translatedText: text, detectedSourceLang: src }
  const res = await axios.get('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `${src}|${target || 'en'}` }, timeout: 20000 })
  const out = res.data?.responseData?.translatedText || ''
  if (res.data?.responseStatus && Number(res.data.responseStatus) !== 200) throw new Error(out || `MyMemory error ${res.data.responseStatus}`)
  if (/INVALID (SOURCE|TARGET) LANGUAGE|QUERY LENGTH LIMIT|MYMEMORY WARNING/i.test(out)) throw new Error(out)
  return { translatedText: out || text, detectedSourceLang: src }
}

// ---- LibreTranslate (NekoSuneVR / self-hosted / libretranslate.com) ----------
async function translateLibreTranslate ({ endpoint, apiKey, source, target, text }) {
  const url = String(endpoint || '').trim()
  if (!url) throw new Error('LibreTranslate endpoint is required')
  const res = await axios.post(url, {
    q: text, source: source || 'auto', target, format: 'text', api_key: apiKey || ''
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
  const det = res.data?.detectedLanguage
  return {
    translatedText: res.data?.translatedText || text,
    detectedSourceLang: (det && (det.language || det[0]?.language)) || (source && source !== 'auto' ? source : ''),
    alternatives: res.data?.alternatives || []
  }
}

// ---- Lingva (self-hosted Google Translate front-end) -------------------------
async function translateLingva ({ endpoint, source, target, text }) {
  const base = String(endpoint || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('Lingva URL is required (e.g. http://localhost:3000)')
  const src = source && source !== 'auto' ? source : 'auto'
  const res = await axios.get(`${base}/api/v1/${encodeURIComponent(src)}/${encodeURIComponent(target || 'en')}/${encodeURIComponent(text)}`, { timeout: 20000 })
  if (res.data?.error) throw new Error(res.data.error)
  return { translatedText: res.data?.translation || text, detectedSourceLang: res.data?.info?.detectedSource || (src !== 'auto' ? src : '') }
}

// ---- DeepL (free "api-free" key or Pro) --------------------------------------
async function translateDeepl ({ apiKey, apiType, source, target, text }) {
  if (!apiKey) throw new Error('DeepL API key is required')
  // Free keys end in ":fx"; pick the right host even if the type was left on default.
  const pro = apiType === 'pro' || (apiType !== 'free' && !/:fx$/.test(String(apiKey).trim()))
  const base = pro ? 'https://api.deepl.com' : 'https://api-free.deepl.com'
  const params = new URLSearchParams()
  params.set('text', text)
  // DeepL wants EN-GB/EN-US and PT-PT/PT-BR for those targets.
  const t = String(target || 'EN').toUpperCase()
  params.set('target_lang', t === 'EN' ? 'EN-GB' : t === 'PT' ? 'PT-PT' : t === 'ZH' ? 'ZH-HANS' : t)
  if (source && source !== 'auto') params.set('source_lang', String(source).toUpperCase().split('-')[0])
  const res = await axios.post(`${base}/v2/translate`, params, {
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000
  })
  const translation = res.data?.translations?.[0]
  return { translatedText: translation?.text || text, detectedSourceLang: String(translation?.detected_source_language || '').toLowerCase() }
}

// ---- Google Cloud Translation (official, key) --------------------------------
async function translateGoogle ({ apiKey, source, target, text }) {
  if (!apiKey) throw new Error('Google Translate API key is required')
  const res = await axios.post(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    q: text, target, source: source && source !== 'auto' ? source : undefined, format: 'text'
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 20000 })
  const translation = res.data?.data?.translations?.[0]
  return { translatedText: translation?.translatedText || text, detectedSourceLang: translation?.detectedSourceLanguage || '' }
}

// ---- Microsoft Translator (Azure; free F0 tier) -------------------------------
async function translateMicrosoft ({ apiKey, region, source, target, text }) {
  if (!apiKey) throw new Error('Microsoft Translator key is required (Azure portal → Translator resource → Keys)')
  const params = { 'api-version': '3.0', to: target || 'en' }
  if (source && source !== 'auto') params.from = source
  const headers = { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'application/json' }
  if (region && String(region).trim()) headers['Ocp-Apim-Subscription-Region'] = String(region).trim()
  const res = await axios.post('https://api.cognitive.microsofttranslator.com/translate', [{ Text: text }], { params, headers, timeout: 20000 })
  const r = res.data?.[0]
  return { translatedText: r?.translations?.[0]?.text || text, detectedSourceLang: r?.detectedLanguage?.language || (params.from || '') }
}

// ---- AI translation (any provider from the AI tab) ---------------------------
const AI_TRANSLATE_PROMPT = target => `You are a translator. Detect the language of the user's text and translate it into ${target}. Keep names, emojis and VRChat slang. Reply with ONLY a JSON object: {"detected":"<ISO 639-1 code of the original language>","text":"<the translation>"}. If the text is already in ${target}, return it unchanged.`
async function translateAi ({ aiSettings, target, text }) {
  const ai = aiSettings || {}
  if (!ai.baseUrl) throw new Error('Set up an AI provider in the AI tab first (free options: OpenRouter, Gemini, Groq, Pollinations…)')
  const raw = await chatOnce({
    baseUrl: ai.baseUrl, apiKey: ai.apiKey || ai.key, model: ai.model,
    messages: [{ role: 'system', content: AI_TRANSLATE_PROMPT(target || 'en') }, { role: 'user', content: text }],
    maxTokens: 400, temperature: 0.2, timeout: 30000
  })
  try {
    const j = JSON.parse((raw.match(/\{[\s\S]*\}/) || [raw])[0])
    return { translatedText: String(j.text || '').trim() || text, detectedSourceLang: String(j.detected || '').toLowerCase() }
  } catch (_) {
    return { translatedText: raw || text, detectedSourceLang: '' }
  }
}

async function runProvider (provider, args) {
  switch (provider) {
    case 'google_free': return translateGoogleFree(args)
    case 'deepl': return translateDeepl(args)
    case 'google': return translateGoogle(args)
    case 'microsoft': return translateMicrosoft(args)
    case 'mymemory': return translateMyMemory(args)
    case 'libretranslate':
    case 'libretranslate_custom':
    case 'libretranslate_com': return translateLibreTranslate(args)
    case 'lingva': return translateLingva(args)
    case 'ai': return translateAi(args)
    default: throw new Error(`Unknown translation provider: ${provider}`)
  }
}

// The free no-key services fall back to each other when one is rate-limited
// (Google's free endpoint 429s after bursts) or down (5xx / network).
const FREE_CHAIN = ['google_free', 'mymemory']
const isTransient = err => { const st = err?.response?.status; return !st || st === 408 || st === 429 || st >= 500 }

// Same text is translated once: OCR and speech-to-text see repeats constantly.
const cache = new Map()
const CACHE_MAX = 500

// The NekoSuneVR LibreTranslate server was taken down. Settings that still
// point at it (provider "libretranslate" with its URL or no URL) use Google's
// free endpoint instead; a "libretranslate" with someone's own URL keeps working.
function migrateTranslatorConfig (cfg) {
  if (!cfg || typeof cfg !== 'object') return { cfg, changed: false }
  const url = String(cfg.endpoint || '')
  if (cfg.provider === 'libretranslate' && (!url || /translator\.nekosunevr\.co\.uk/i.test(url))) return { cfg: { ...cfg, provider: 'google_free', endpoint: '' }, changed: true }
  if (cfg.provider === 'libretranslate') return { cfg: { ...cfg, provider: 'libretranslate_custom' }, changed: true }
  return { cfg, changed: false }
}

async function translateText (rawOpts = {}) {
  const opts = migrateTranslatorConfig(rawOpts).cfg
  const { provider, text } = opts
  const input = String(text || '').trim()
  if (!input) throw new Error('Nothing to translate')
  const target = opts.target || 'en'
  const key = `${provider}|${opts.source || 'auto'}|${target}|${input}`
  if (cache.has(key)) return { ...cache.get(key), cached: true }

  // Auto-detect: if it's clearly already in the target language, skip the
  // network entirely.
  if (!opts.source || opts.source === 'auto') {
    const local = detectLanguageLocal(input)
    if (local.lang && local.confidence >= 0.5 && baseLang(local.lang) === baseLang(target)) {
      return { translatedText: input, detectedSourceLang: local.lang, sameLanguage: true, provider: 'local' }
    }
  }

  const chain = [provider, ...(FREE_CHAIN.includes(provider) && opts.fallback !== false ? FREE_CHAIN.filter(p => p !== provider) : [])]
  let lastErr
  for (const prov of chain) {
    const p = TRANSLATE_PROVIDERS[prov]
    const args = { ...opts, provider: prov, text: input, target, endpoint: prov === provider ? (opts.endpoint || (p && p.endpoint) || '') : ((p && p.endpoint) || '') }
    try {
      const result = await runProvider(prov, args)
      const detected = result.detectedSourceLang || ''
      result.sameLanguage = !!detected && baseLang(detected) === baseLang(target)
      result.provider = prov
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
      cache.set(key, result)
      return result
    } catch (err) {
      lastErr = err
      if (!isTransient(err)) break
    }
  }
  const err = lastErr
  const detail = err?.response?.data?.error?.message || (typeof err?.response?.data?.error === 'string' ? err.response.data.error : '') || (err?.response?.status ? explainError(err) : err?.message)
  throw new Error(`Translation failed: ${detail}`)
}

module.exports = { migrateTranslatorConfig, translateText, detectLanguage, detectLanguageLocal, TRANSLATE_PROVIDERS, TRANSLATE_TIER_LABELS, baseLang }

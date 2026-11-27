'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const ai = require('../modules/ai/aiProviders')
const { interpretCommand } = require('../modules/ai/assistantBrain')
const tts = require('../modules/ai/ttsProviders')

// Tiny OpenAI-compatible mock: /ok (answers), /limited (429), /models, /audio/speech.
let server, base
const seen = []
test.before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || '', referer: req.headers['http-referer'] || '', body })
      if (req.url.startsWith('/limited/')) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'free quota exceeded' } })) }
      if (req.url === '/ok/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ data: [{ id: 'paid/model', pricing: { prompt: '0.000001', completion: '0.000002' } }, { id: 'meta-llama/llama-3.3-70b-instruct:free' }, { id: 'zero/model', pricing: { prompt: '0', completion: '0' } }] }))
      }
      if (req.url === '/ok/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ choices: [{ message: { content: '{"action":"chat","reply":"hi from backup"}' } }] }))
      }
      if (req.url === '/ok/v1/audio/speech') {
        const j = JSON.parse(body || '{}')
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
        return res.end(Buffer.from(`MP3:${j.model}:${j.voice}:${j.input}`))
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(() => server.close())

test('catalog: every provider has a tier and a usable base URL (except custom)', () => {
  const entries = Object.entries(ai.AI_PROVIDERS)
  assert.ok(entries.length >= 25)
  for (const [k, p] of entries) {
    assert.ok(['free', 'free-key', 'local', 'gateway', 'paid', 'custom'].includes(p.tier), k)
    if (k !== 'custom') assert.match(p.baseUrl, /^https?:\/\//, k)
  }
  assert.ok(entries.filter(([, p]) => p.tier === 'free' || p.tier === 'free-key').length >= 10, 'lots of free options')
})

test('falls back to the backup provider when the first is rate-limited', async () => {
  const r = await ai.chatWithFallback([
    { baseUrl: `${base}/limited/v1`, apiKey: 'k1', model: 'x' },
    { baseUrl: `${base}/ok/v1`, apiKey: 'k2', model: 'y' }
  ], { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(r.used, 1)
  assert.match(r.attempts[0], /rate limited/)
  assert.match(r.text, /hi from backup/)
})

test('Jarvis interprets with the config list and explains failures plainly', async () => {
  const ok = await interpretCommand({ text: 'hello', configs: [{ baseUrl: `${base}/limited/v1` }, { baseUrl: `${base}/ok/v1` }] })
  assert.deepEqual(ok, { action: 'chat', reply: 'hi from backup' })
  const bad = await interpretCommand({ text: 'hello', configs: [{ baseUrl: `${base}/limited/v1` }] })
  assert.match(bad.reply, /rate limited \/ free quota used up/)
})

test('listModels flags free models (":free" or zero price) and sorts them first', async () => {
  const r = await ai.listModels({ baseUrl: `${base}/ok/v1`, apiKey: 'k' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.models.filter(m => m.free).map(m => m.id).sort(), ['meta-llama/llama-3.3-70b-instruct:free', 'zero/model'])
  assert.equal(r.models[r.models.length - 1].id, 'paid/model')
})

test('OpenRouter requests carry the attribution headers', () => {
  const h = ai.headersFor({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' })
  assert.equal(h.Authorization, 'Bearer sk-or')
  assert.ok(h['HTTP-Referer'] && h['X-Title'])
})

test('Cloudflare placeholder account id gives a clear error', async () => {
  await assert.rejects(() => ai.chatOnce({ baseUrl: ai.AI_PROVIDERS.cloudflare.baseUrl, messages: [] }), /Replace YOUR_ACCOUNT_ID/)
})

test('OpenAI-compatible TTS engine posts model/voice/input to /audio/speech', async () => {
  const r = await tts.speak({ engine: 'openaicompat', text: 'hello there', baseUrl: `${base}/ok/v1`, model: 'kokoro', voice: 'af_bella' })
  assert.equal(r.mime, 'audio/mpeg')
  assert.equal(Buffer.from(r.audio, 'base64').toString(), 'MP3:kokoro:af_bella:hello there')
})

test('long text is split for the Google Translate voice at word boundaries', () => {
  const parts = tts.splitForTts('This is a sentence. '.repeat(30))
  assert.ok(parts.length > 1)
  assert.ok(parts.every(p => p.length <= 191))
  assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), 'This is a sentence. '.repeat(30).trim())
})

test('Gemini PCM audio is wrapped in a valid WAV header', () => {
  const wav = tts.pcmToWav(Buffer.alloc(4800), 24000)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt32LE(24), 24000)
  assert.equal(wav.readUInt32LE(40), 4800)
  assert.equal(wav.length, 4844)
})

test('new cloud TTS engines are registered and fail clearly without a key', async () => {
  for (const engine of ['geminitts', 'unrealspeech', 'cartesia', 'fishaudio', 'lmnt', 'speechify', 'hume', 'murf']) {
    assert.ok(tts.TTS_PROVIDERS[engine], engine)
    await assert.rejects(() => tts.speak({ engine, text: 'hi' }), /key is required/i, engine)
  }
})

test('gateways (OmniRoute, LiteLLM, Portkey…) and free no-key providers are in the catalog', () => {
  for (const k of ['omniroute', 'litellm', 'portkey', 'oneapi', 'openwebui', 'anythingllm']) assert.equal(ai.AI_PROVIDERS[k].tier, 'gateway', k)
  assert.equal(ai.AI_PROVIDERS.omniroute.baseUrl, 'http://localhost:20128/v1')
  for (const k of ['pollinations', 'ovh']) assert.equal(ai.AI_PROVIDERS[k].needsKey, false, k)
})

test('self-hosted TTS servers (Coqui, Piper, MaryTTS) are called with their own API shapes', async () => {
  const hits = []
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { hits.push({ m: req.method, u: req.url, b }); res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.from('RIFFxxxx')) }) })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${srv.address().port}`
  try {
    for (const engine of ['coqui', 'piper', 'marytts']) {
      const r = await tts.speak({ engine, text: 'hello there', endpoint: url, voice: 'v1', language: 'en_GB' })
      assert.equal(r.mime, 'audio/wav', engine)
    }
    assert.match(hits[0].u, /^\/api\/tts\?text=hello\+there&speaker_id=v1&language_id=en_GB$/)
    assert.equal(hits[1].m, 'POST'); assert.deepEqual(JSON.parse(hits[1].b), { text: 'hello there', voice: 'v1' })
    assert.match(hits[2].u, /^\/process\?INPUT_TEXT=hello\+there.*LOCALE=en_GB&VOICE=v1$/)
  } finally { srv.close() }
})

test('TikTok voice list is the verified set and StreamElements explains the token it now needs', async () => {
  const { TIKTOK_VOICES } = require('../modules/live/tiktokTts')
  assert.ok(TIKTOK_VOICES.length >= 70)
  const ids = TIKTOK_VOICES.map(v => v.apiName)
  assert.equal(new Set(ids).size, ids.length, 'no duplicate voices')
  for (const id of ['en_us_001', 'en_us_ghostface', 'en_male_narration', 'jp_001']) assert.ok(ids.includes(id), id)
  assert.ok(tts.TTS_PROVIDERS.streamelements)
  // No network: a fake fetch stands in for StreamElements.
  const calls = []
  const fake = status => async (url, init) => {
    calls.push({ url, auth: init && init.headers && init.headers.Authorization })
    return new Response(status === 200 ? Buffer.from('ID3audio') : '{}', { status, headers: { 'Content-Type': status === 200 ? 'audio/mp3' : 'application/json' } })
  }
  await assert.rejects(() => tts.speakStreamElements({ text: 'new text', voice: 'Brian' }, fake(401)), /JWT token/)
  assert.equal(calls[0].auth, undefined, 'no token: tried anonymously first (cached phrases still play)')
  const ok = await tts.speakStreamElements({ text: 'hello', voice: 'Brian', apiKey: 'jwt123' }, fake(200))
  assert.equal(calls[1].auth, 'Bearer jwt123')
  assert.match(calls[1].url, /voice=Brian&text=hello$/)
  assert.equal(Buffer.from(ok.audio, 'base64').toString(), 'ID3audio')
  await assert.rejects(() => tts.speakStreamElements({ text: 'x', apiKey: 'bad' }, fake(401)), /rejected the token/)
})

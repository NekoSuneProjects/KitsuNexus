// modules/ai/ttsProviders.js
// Multi-engine text-to-speech. Engines and request shapes were ported from
// the TTS-Voice-Wizard reference (github.com/VRCWizard/TTS-Voice-Wizard) for
// feature parity, with two deliberate differences:
//   - Where that project proxies an engine through its own paid backend
//     (Google, IBM Watson, Deepgram all go through their Heroku gateway
//     there), this calls the real vendor API directly with the user's own
//     credentials instead - no third-party paywall in between.
//   - VoiceForge's reference client used a hardcoded shared API key; that's
//     not republished here, so it's a normal user-supplied key field.
// Runs in the MAIN process.
//
// SAPI shells out to PowerShell's System.Speech (managed .NET, no P/Invoke
// needed) - same no-native-dependency approach as mediaKeys.js/keyHookPs.js.
// Text is piped over stdin rather than interpolated into the command
// string, so spoken text can never break out of the PowerShell command.

const { spawn } = require('child_process')
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly')
const { getTikTokTtsAudio } = require('../live/tiktokTts')

const TTS_PROVIDERS = {
  sapi: { label: 'Windows built-in (SAPI)' },
  googletranslate: { label: 'Google Translate voice (free, no key)' },
  tiktok: { label: 'TikTok TTS (free, 73 voices)' },
  streamelements: { label: 'StreamElements (Brian etc., free account token)', needsKey: true },
  openaicompat: { label: 'OpenAI-compatible TTS (Groq free tier, Kokoro, LocalAI…)', needsEndpoint: true },
  geminitts: { label: 'Google Gemini TTS (free tier key)', needsKey: true },
  unrealspeech: { label: 'Unreal Speech (free monthly allowance)', needsKey: true },
  elevenlabs: { label: 'ElevenLabs (cloud, free tier)', needsKey: true },
  cartesia: { label: 'Cartesia Sonic (cloud)', needsKey: true },
  fishaudio: { label: 'Fish Audio (cloud)', needsKey: true },
  lmnt: { label: 'LMNT (cloud)', needsKey: true },
  speechify: { label: 'Speechify (cloud)', needsKey: true },
  hume: { label: 'Hume Octave (cloud)', needsKey: true },
  murf: { label: 'Murf AI (cloud)', needsKey: true },
  openai: { label: 'OpenAI TTS (cloud)', needsKey: true },
  google: { label: 'Google Cloud TTS (cloud)', needsKey: true },
  azure: { label: 'Azure Cognitive Speech (cloud)', needsKey: true },
  polly: { label: 'Amazon Polly (cloud)', needsKey: true },
  ibmwatson: { label: 'IBM Watson TTS (cloud)', needsKey: true },
  deepgram: { label: 'Deepgram Aura (cloud, free credit)', needsKey: true },
  voiceforge: { label: 'VoiceForge (cloud)', needsKey: true },
  uberduck: { label: 'UberDuck (cloud)', needsKey: true },
  ttsmonster: { label: 'TTS Monster (cloud)', needsKey: true },
  glados: { label: 'GLaDOS TTS (self-hosted)', needsEndpoint: true },
  moonbase: { label: 'Moonbase Voices (local app)', needsEndpoint: true },
  selfhosted: { label: 'Self-hosted (Piper / XTTS / other)', needsEndpoint: true },
  coqui: { label: 'Coqui TTS server (self-hosted, XTTS / VITS)', needsEndpoint: true },
  piper: { label: 'Piper HTTP server (self-hosted)', needsEndpoint: true },
  marytts: { label: 'MaryTTS (self-hosted)', needsEndpoint: true }
}

function speakSapi ({ text, voice, rate, volume }) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('Windows built-in TTS is only available on Windows'))
      return
    }

    const psLines = [
      'Add-Type -AssemblyName System.Speech;',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;'
    ]
    if (voice) psLines.push(`try { $s.SelectVoice('${String(voice).replace(/'/g, "''")}') } catch {};`)
    if (Number.isFinite(rate)) psLines.push(`$s.Rate = ${Math.max(-10, Math.min(10, Math.round(rate)))};`)
    if (Number.isFinite(volume)) psLines.push(`$s.Volume = ${Math.max(0, Math.min(100, Math.round(volume)))};`)
    psLines.push('$t = [Console]::In.ReadToEnd();', '$s.Speak($t);')

    // stdout is unused here - 'ignore' it so its pipe doesn't linger and keep
    // this process (or its parent) referenced after the child exits.
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psLines.join(' ')], {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = ''
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('error', reject)
    proc.on('exit', code => {
      if (code === 0) resolve({ playedLocally: true })
      else reject(new Error(`SAPI speech failed (exit ${code}): ${stderr.trim().slice(0, 300)}`))
    })
    proc.stdin.write(String(text || ''))
    proc.stdin.end()
  })
}

function listSapiVoices () {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { resolve([]); return }
    const ps = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }"
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let out = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.on('error', () => resolve([]))
    proc.on('exit', () => resolve(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)))
  })
}

async function speakElevenLabs ({ text, apiKey, voiceId, modelId }) {
  if (!apiKey) throw new Error('ElevenLabs API key is required')
  if (!voiceId) throw new Error('ElevenLabs voice ID is required')

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: modelId || 'eleven_multilingual_v2' })
  })
  if (!res.ok) throw new Error(`ElevenLabs request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

async function speakOpenAi ({ text, apiKey, model, voice }) {
  if (!apiKey) throw new Error('OpenAI API key is required')

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'gpt-4o-mini-tts', input: text, voice: voice || 'alloy' })
  })
  if (!res.ok) throw new Error(`OpenAI TTS request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

// Real Google Cloud Text-to-Speech API (not the reference project's paid
// gateway) - needs the user's own Google Cloud API key with the
// Text-to-Speech API enabled.
async function speakGoogle ({ text, apiKey, languageCode, voiceName }) {
  if (!apiKey) throw new Error('Google Cloud API key is required')

  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: languageCode || 'en-US', name: voiceName || 'en-US-Standard-A' },
      audioConfig: { audioEncoding: 'MP3' }
    })
  })
  if (!res.ok) throw new Error(`Google TTS request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const data = await res.json()
  if (!data.audioContent) throw new Error('Google TTS returned no audio')
  return { audio: data.audioContent, mime: 'audio/mpeg' }
}

// Real Azure Cognitive Services Speech REST endpoint (the SDK the reference
// project uses just wraps this same call).
async function speakAzure ({ text, apiKey, region, voiceName }) {
  if (!apiKey) throw new Error('Azure Speech subscription key is required')
  if (!region) throw new Error('Azure region is required (e.g. eastus)')

  const voice = voiceName || 'en-US-AvaMultilingualNeural'
  const locale = voice.split('-').slice(0, 2).join('-') || 'en-US'
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`

  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
    },
    body: ssml
  })
  if (!res.ok) throw new Error(`Azure Speech request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

// Amazon Polly needs correctly-signed AWS SigV4 requests - that's what
// @aws-sdk/client-polly (official, pure JS, no native binary) handles; hand
// -rolling SigV4 is not worth the risk of getting it subtly wrong.
async function speakPolly ({ text, accessKeyId, secretAccessKey, region, voiceId, engine }) {
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS access key ID and secret access key are required')

  const client = new PollyClient({ region: region || 'us-east-1', credentials: { accessKeyId, secretAccessKey } })
  const command = new SynthesizeSpeechCommand({
    OutputFormat: 'mp3',
    Text: text,
    VoiceId: voiceId || 'Joanna',
    Engine: engine || 'neural'
  })
  const response = await client.send(command)
  const buf = Buffer.from(await response.AudioStream.transformToByteArray())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

// Real IBM Watson Text to Speech API (not the reference project's paid
// gateway) - needs the user's own Watson TTS instance API key + region +
// instance ID from the IBM Cloud dashboard.
async function speakIbmWatson ({ text, apiKey, region, instanceId, voice }) {
  if (!apiKey) throw new Error('IBM Watson API key is required')
  if (!instanceId) throw new Error('IBM Watson instance ID is required')

  const base = `https://api.${region || 'us-south'}.text-to-speech.watson.cloud.ibm.com/instances/${instanceId}`
  const auth = Buffer.from(`apikey:${apiKey}`).toString('base64')

  const res = await fetch(`${base}/v1/synthesize?voice=${encodeURIComponent(voice || 'en-US_AllisonV3Voice')}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'audio/mp3' },
    body: JSON.stringify({ text })
  })
  if (!res.ok) throw new Error(`IBM Watson TTS request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

// Real Deepgram Aura API (not the reference project's paid gateway).
async function speakDeepgram ({ text, apiKey, model }) {
  if (!apiKey) throw new Error('Deepgram API key is required')

  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model || 'aura-asteria-en')}`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  if (!res.ok) throw new Error(`Deepgram TTS request failed: ${res.status} ${await res.text().catch(() => '')}`.trim())

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

async function speakVoiceForge ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('VoiceForge API key is required')

  const url = `https://api.voiceforge.com/swift_engine?voice=${encodeURIComponent(voice || 'Susan')}&msg=${encodeURIComponent(text)}&email=-`
  const res = await fetch(url, { headers: { HTTP_X_API_KEY: apiKey } })
  if (!res.ok) throw new Error(`VoiceForge request failed: ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/wav' }
}

// Multi-step: submit the line, then poll until UberDuck reports a finished
// audio path, then download the actual bytes.
async function speakUberDuck ({ text, apiKey, apiSecret, voiceId }) {
  if (!apiKey || !apiSecret) throw new Error('UberDuck API key and secret are required')
  const auth = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`

  const submit = await fetch('https://api.uberduck.ai/speak', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ speech: text, voicemodel_uuid: voiceId })
  })
  if (!submit.ok) throw new Error(`UberDuck request failed: ${submit.status}`)
  const { uuid } = await submit.json()
  if (!uuid) throw new Error('UberDuck did not return a job id')

  let path = null
  for (let i = 0; i < 10 && !path; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    const statusRes = await fetch(`https://api.uberduck.ai/speak-status?uuid=${encodeURIComponent(uuid)}`, {
      headers: { Authorization: auth }
    })
    if (!statusRes.ok) continue
    const statusData = await statusRes.json()
    if (statusData.path) path = statusData.path
  }
  if (!path) throw new Error('UberDuck did not finish rendering in time')

  const audioRes = await fetch(path)
  if (!audioRes.ok) throw new Error('Could not download UberDuck audio')
  const buf = Buffer.from(await audioRes.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/mpeg' }
}

// Submits the line, then downloads the resulting audio URL.
async function speakTtsMonster ({ text, apiKey, voiceId }) {
  if (!apiKey) throw new Error('TTS Monster API key is required')
  if (!voiceId) throw new Error('TTS Monster voice ID is required')

  const res = await fetch('https://api.console.tts.monster/generate', {
    method: 'POST',
    headers: { Authorization: apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_id: voiceId, message: text, return_usage: 'false' })
  })
  if (!res.ok) throw new Error(`TTS Monster request failed: ${res.status}`)
  const { url } = await res.json()
  if (!url) throw new Error('TTS Monster did not return an audio URL')

  const audioRes = await fetch(url)
  if (!audioRes.ok) throw new Error('Could not download TTS Monster audio')
  const buf = Buffer.from(await audioRes.arrayBuffer())
  return { audio: buf.toString('base64'), mime: 'audio/wav' }
}

// Self-hosted GLaDOS-TTS server (github.com/R2D2FISH/glados-tts and forks) -
// the user runs this themselves and points the app at host:port.
async function speakGlados ({ text, endpoint }) {
  const base = String(endpoint || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('GLaDOS TTS server address is required')

  const res = await fetch(`${base}/synthesize/?${encodeURIComponent(text)}`)
  if (!res.ok) throw new Error(`GLaDOS TTS request failed: ${res.status}`)
  const base64 = (await res.text()).trim()
  if (!base64) throw new Error('GLaDOS TTS returned no audio')
  return { audio: base64, mime: 'audio/wav' }
}

// Self-hosted Moonbase Voices companion app (the user runs
// MoonbaseVoices.exe themselves; this app doesn't bundle it).
async function speakMoonbase ({ text, endpoint, voice }) {
  const base = String(endpoint || 'http://localhost:54027').trim().replace(/\/+$/, '')
  const res = await fetch(`${base}/audio?voice=${encodeURIComponent(voice || 'Betty')}&text=${encodeURIComponent(text)}`)
  if (!res.ok) throw new Error(`Moonbase Voices request failed: ${res.status}`)
  const base64 = (await res.text()).trim()
  if (!base64) throw new Error('Moonbase Voices returned no audio')
  return { audio: base64, mime: 'audio/wav' }
}

async function speakSelfHosted ({ text, endpoint }) {
  const url = String(endpoint || '').trim()
  if (!url) throw new Error('Self-hosted TTS endpoint is required')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  })
  if (!res.ok) throw new Error(`Self-hosted TTS request failed: ${res.status}`)

  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || 'audio/wav'
  return { audio: buf.toString('base64'), mime }
}

// Google Translate's public speech endpoint: free, no key, ~200 characters per
// request, so longer text is split at word boundaries and the MP3 pieces are
// joined (MP3 frames concatenate cleanly). Unofficial but long-standing and
// widely used; good enough as a zero-setup fallback voice.
function splitForTts (text, max = 190) {
  const parts = []
  let rest = String(text || '').replace(/\s+/g, ' ').trim()
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf(', ', max), rest.lastIndexOf(' ', max))
    if (cut < max * 0.4) cut = max
    parts.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) parts.push(rest)
  return parts
}

async function speakGoogleTranslate ({ text, languageCode }) {
  const tl = String(languageCode || 'en').trim() || 'en'
  const pieces = []
  for (const part of splitForTts(text).slice(0, 10)) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(part)}`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) throw new Error(`Google Translate voice request failed: ${res.status}`)
    pieces.push(Buffer.from(await res.arrayBuffer()))
  }
  if (!pieces.length) throw new Error('Nothing to speak')
  return { audio: Buffer.concat(pieces).toString('base64'), mime: 'audio/mpeg' }
}

// Any OpenAI-compatible /audio/speech endpoint: Groq (free tier), OpenAI-format
// servers like Kokoro-FastAPI, LocalAI, Speaches, openedai-speech, AllTalk...
async function speakOpenAiCompatible ({ text, baseUrl, apiKey, model, voice, format }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('Base URL is required (for example http://localhost:8880/v1 for Kokoro)')
  const headers = { 'Content-Type': 'application/json' }
  if (String(apiKey || '').trim()) headers.Authorization = `Bearer ${String(apiKey).trim()}`
  const fmt = String(format || 'mp3').trim() || 'mp3'
  const body = { input: text, response_format: fmt }
  if (String(model || '').trim()) body.model = String(model).trim()
  if (String(voice || '').trim()) body.voice = String(voice).trim()
  const res = await fetch(`${base}/audio/speech`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`TTS request failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim())
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || ({ mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac' }[fmt] || 'audio/mpeg')
  return { audio: buf.toString('base64'), mime }
}

// ---- More cloud voices ------------------------------------------------------
// Each returns { audio: base64, mime }. Request shapes follow each vendor's
// public REST docs; all need the user's own key.

async function checkedFetch (label, url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${label} request failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim())
  return res
}
const asAudio = async (res, fallbackMime = 'audio/mpeg') => ({ audio: Buffer.from(await res.arrayBuffer()).toString('base64'), mime: (res.headers.get('content-type') || '').startsWith('audio/') ? res.headers.get('content-type') : fallbackMime })

// Wrap raw 16-bit little-endian mono PCM in a WAV header (Gemini returns PCM).
function pcmToWav (pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * bits / 8
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(channels * bits / 8, 32); header.writeUInt16LE(bits, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Google Gemini TTS: free tier with a free AI Studio key.
async function speakGeminiTts ({ text, apiKey, model, voice }) {
  if (!apiKey) throw new Error('Gemini API key is required (free at aistudio.google.com/apikey)')
  const m = String(model || 'gemini-2.5-flash-preview-tts').trim()
  const res = await checkedFetch('Gemini TTS', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } } } }
    })
  })
  const j = await res.json()
  const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData && p.inlineData.data)
  if (!part) throw new Error('Gemini TTS returned no audio')
  const rate = Number((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000
  return { audio: pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate).toString('base64'), mime: 'audio/wav' }
}

// Unreal Speech: free monthly allowance.
async function speakUnrealSpeech ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('Unreal Speech API key is required')
  const res = await checkedFetch('Unreal Speech', 'https://api.v8.unrealspeech.com/stream', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Text: String(text).slice(0, 1000), VoiceId: voice || 'Sierra', Bitrate: '192k', Speed: '0', Pitch: '1', Codec: 'libmp3lame' })
  })
  return asAudio(res)
}

async function speakCartesia ({ text, apiKey, voice, model }) {
  if (!apiKey) throw new Error('Cartesia API key is required')
  if (!voice) throw new Error('Cartesia voice id is required (copy one from play.cartesia.ai)')
  const res = await checkedFetch('Cartesia', 'https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Cartesia-Version': '2024-06-10', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: model || 'sonic-2', transcript: text, voice: { mode: 'id', id: voice }, output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 } })
  })
  return asAudio(res)
}

async function speakFishAudio ({ text, apiKey, voice, model }) {
  if (!apiKey) throw new Error('Fish Audio API key is required')
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  if (model) headers.model = model
  const body = { text, format: 'mp3' }
  if (voice) body.reference_id = voice
  const res = await checkedFetch('Fish Audio', 'https://api.fish.audio/v1/tts', { method: 'POST', headers, body: JSON.stringify(body) })
  return asAudio(res)
}

async function speakLmnt ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('LMNT API key is required')
  const res = await checkedFetch('LMNT', 'https://api.lmnt.com/v1/ai/speech/bytes', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: voice || 'leah', text, format: 'mp3' })
  })
  return asAudio(res)
}

async function speakSpeechify ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('Speechify API key is required')
  const res = await checkedFetch('Speechify', 'https://api.sws.speechify.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text, voice_id: voice || 'george', audio_format: 'mp3' })
  })
  const j = await res.json()
  if (!j.audio_data) throw new Error('Speechify returned no audio')
  return { audio: j.audio_data, mime: 'audio/mpeg' }
}

async function speakHume ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('Hume API key is required')
  const utterance = { text }
  if (voice) utterance.voice = { name: voice, provider: 'HUME_AI' }
  const res = await checkedFetch('Hume', 'https://api.hume.ai/v0/tts/file', {
    method: 'POST',
    headers: { 'X-Hume-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ utterances: [utterance], format: { type: 'mp3' } })
  })
  return asAudio(res)
}

async function speakMurf ({ text, apiKey, voice }) {
  if (!apiKey) throw new Error('Murf API key is required')
  const res = await checkedFetch('Murf', 'https://api.murf.ai/v1/speech/generate', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId: voice || 'en-US-natalie', format: 'MP3' })
  })
  const j = await res.json()
  if (j.encodedAudio) return { audio: j.encodedAudio, mime: 'audio/mpeg' }
  if (!j.audioFile) throw new Error('Murf returned no audio')
  return asAudio(await checkedFetch('Murf audio', j.audioFile, {}))
}

// ---- StreamElements ---------------------------------------------------------
// The classic free "Brian" streamer voice. Checked 2026-11-27: the speech
// endpoint now answers 401 "No API key was found" without a key, so it needs
// the JWT token from a (free) StreamElements account; sent as a Bearer token,
// per StreamElements' API docs. The voice list is still public.
const SE_BASE = 'https://api.streamelements.com/kappa/v2/speech'
let seVoiceCache = null
let seVoiceCacheAt = 0
async function listStreamElementsVoices () {
  if (seVoiceCache && Date.now() - seVoiceCacheAt < 24 * 60 * 60 * 1000) return seVoiceCache
  const res = await checkedFetch('StreamElements voices', `${SE_BASE}/voices`, {})
  const j = await res.json()
  const list = Object.values(j.voices || {}).map(v => ({
    id: String(v.id || v.name || ''), name: String(v.name || v.id || ''), language: String(v.languageName || ''),
    languageCode: String(v.languageCode || ''), gender: String(v.gender || ''), provider: String(v.provider || '')
  })).filter(v => v.id)
  list.sort((a, b) => a.languageCode.localeCompare(b.languageCode) || a.name.localeCompare(b.name))
  seVoiceCache = list; seVoiceCacheAt = Date.now()
  return list
}

// Without a token only audio StreamElements' CDN already has cached still plays
// (checked 2026-11-27: "hello" = Cloudflare HIT, ~101 days old; any new text
// = BYPASS → 401). So try anonymously when no token is set, and explain the
// token when that's refused.
const SE_TOKEN_HELP = 'StreamElements now needs your JWT token for new text (free account: StreamElements dashboard → account / channel settings → "Show secrets")'
async function speakStreamElements ({ text, apiKey, voice }, fetchImpl = fetch) {
  const token = String(apiKey || '').trim()
  const q = new URLSearchParams({ voice: voice || 'Brian', text: String(text).slice(0, 500) })
  const res = await fetchImpl(`${SE_BASE}?${q}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  if (res.status === 401 || res.status === 403) throw new Error(token ? `StreamElements rejected the token (${res.status}) - copy the JWT token again from the dashboard` : SE_TOKEN_HELP)
  if (!res.ok) throw new Error(`StreamElements request failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim())
  return asAudio(res)
}

// ---- Self-hosted voice servers (free, run on your PC / server) ---------------
const trimBase = (u, def) => String(u || def).trim().replace(/\/+$/, '')

// Coqui TTS server ("tts-server", e.g. XTTS / VITS models): GET /api/tts.
async function speakCoqui ({ text, endpoint, voice, language }) {
  const base = trimBase(endpoint, 'http://localhost:5002')
  const q = new URLSearchParams({ text })
  if (voice) q.set('speaker_id', voice)
  if (language) q.set('language_id', language)
  const res = await checkedFetch('Coqui TTS', `${base}/api/tts?${q}`, {})
  return asAudio(res, 'audio/wav')
}

// Piper's HTTP server ("python -m piper.http_server"): POST the text, get WAV.
async function speakPiper ({ text, endpoint, voice }) {
  const base = trimBase(endpoint, 'http://localhost:5000')
  const body = { text }
  if (voice) body.voice = voice
  const res = await checkedFetch('Piper', base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return asAudio(res, 'audio/wav')
}

// MaryTTS server: GET /process.
async function speakMary ({ text, endpoint, voice, language }) {
  const base = trimBase(endpoint, 'http://localhost:59125')
  const q = new URLSearchParams({ INPUT_TEXT: text, INPUT_TYPE: 'TEXT', OUTPUT_TYPE: 'AUDIO', AUDIO: 'WAVE_FILE', LOCALE: language || 'en_US' })
  if (voice) q.set('VOICE', voice)
  const res = await checkedFetch('MaryTTS', `${base}/process?${q}`, {})
  return asAudio(res, 'audio/wav')
}

function escapeXml (s) {
  return String(s || '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

async function speak (opts = {}) {
  const { engine, text } = opts
  const input = String(text || '').trim()
  if (!input) throw new Error('Nothing to speak')

  switch (engine) {
    case 'sapi': return speakSapi(opts)
    case 'tiktok': {
      const buf = await getTikTokTtsAudio(input, opts.voice)
      return { audio: buf ? buf.toString('base64') : null, mime: 'audio/mpeg' }
    }
    case 'elevenlabs': return speakElevenLabs(opts)
    case 'openai': return speakOpenAi(opts)
    case 'google': return speakGoogle(opts)
    case 'azure': return speakAzure(opts)
    case 'polly': return speakPolly(opts)
    case 'ibmwatson': return speakIbmWatson(opts)
    case 'deepgram': return speakDeepgram(opts)
    case 'voiceforge': return speakVoiceForge(opts)
    case 'uberduck': return speakUberDuck(opts)
    case 'ttsmonster': return speakTtsMonster(opts)
    case 'glados': return speakGlados(opts)
    case 'moonbase': return speakMoonbase(opts)
    case 'selfhosted': return speakSelfHosted(opts)
    case 'googletranslate': return speakGoogleTranslate({ ...opts, text: input })
    case 'openaicompat': return speakOpenAiCompatible({ ...opts, text: input })
    case 'geminitts': return speakGeminiTts({ ...opts, text: input })
    case 'unrealspeech': return speakUnrealSpeech({ ...opts, text: input })
    case 'cartesia': return speakCartesia({ ...opts, text: input })
    case 'fishaudio': return speakFishAudio({ ...opts, text: input })
    case 'lmnt': return speakLmnt({ ...opts, text: input })
    case 'speechify': return speakSpeechify({ ...opts, text: input })
    case 'hume': return speakHume({ ...opts, text: input })
    case 'murf': return speakMurf({ ...opts, text: input })
    case 'streamelements': return speakStreamElements({ ...opts, text: input })
    case 'coqui': return speakCoqui({ ...opts, text: input })
    case 'piper': return speakPiper({ ...opts, text: input })
    case 'marytts': return speakMary({ ...opts, text: input })
    default: throw new Error(`Unknown TTS engine: ${engine}`)
  }
}

module.exports = { speak, listSapiVoices, listStreamElementsVoices, speakStreamElements, TTS_PROVIDERS, splitForTts, pcmToWav }

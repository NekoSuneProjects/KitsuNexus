'use strict'

// modules/ai/aiProviders.js
// Catalog of OpenAI-compatible chat providers used by IntelliChat and the
// Jarvis voice assistant, plus model listing / connection test / fallback.
// Runs in the MAIN process.
//
// Every entry speaks the OpenAI /chat/completions shape, so one call path
// covers them all. `tier` tells the user what it costs:
//   'free'      - free, no key needed
//   'free-key'  - free tier / free models with a (free) account key
//   'local'     - runs on your own PC (free, private)
//   'gateway'   - a proxy you run (OmniRoute, LiteLLM, Portkey…) that routes to many providers
//   'paid'      - needs paid credit (some include trial credit)
// Default models are only starting points; providers rename models often, so
// the UI's "Load models" button lists what the key can actually use.

const axios = require('axios')

const AI_PROVIDERS = {
  // ---- free, no key ----
  nekosune_ollama: { label: 'NekoSuneVR Ollama (free, no key)', tier: 'free', baseUrl: 'https://ollama.nekosunevr.co.uk/v1', model: 'llama3.1', needsKey: false, locked: true },
  pollinations: { label: 'Pollinations.ai (free, no key)', tier: 'free', baseUrl: 'https://text.pollinations.ai/openai', model: 'openai-fast', needsKey: false, note: 'Anonymous use is rate-limited; a free token from auth.pollinations.ai raises the limit.', keyUrl: 'https://auth.pollinations.ai' },
  ovh: { label: 'OVHcloud AI Endpoints (free, no key, rate-limited)', tier: 'free', baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', model: 'Meta-Llama-3_3-70B-Instruct', needsKey: false, note: 'Works without a key at a low rate limit; a free OVHcloud key raises it.' },

  // ---- free with a free account key ----
  openrouter: { label: 'OpenRouter (free models with a free key)', tier: 'free-key', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', needsKey: true, keyUrl: 'https://openrouter.ai/keys', note: '"openrouter/free" automatically picks a working free model. Models ending in ":free" also cost nothing (rate-limited); "Load models" → Free models only lists them.' },
  gemini: { label: 'Google Gemini (free tier)', tier: 'free-key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  groq: { label: 'Groq (free tier, very fast)', tier: 'free-key', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  cerebras: { label: 'Cerebras (free tier, very fast)', tier: 'free-key', baseUrl: 'https://api.cerebras.ai/v1', model: 'llama3.1-8b', needsKey: true, keyUrl: 'https://cloud.cerebras.ai' },
  mistral: { label: 'Mistral AI (free "Experiment" tier)', tier: 'free-key', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', needsKey: true, keyUrl: 'https://console.mistral.ai/api-keys' },
  github: { label: 'GitHub Models (free with a GitHub token)', tier: 'free-key', baseUrl: 'https://models.github.ai/inference', model: 'openai/gpt-4.1-mini', needsKey: true, keyUrl: 'https://github.com/settings/tokens', note: 'Use a GitHub personal access token with the "models" permission.' },
  huggingface: { label: 'Hugging Face Inference (free monthly credit)', tier: 'free-key', baseUrl: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.1-8B-Instruct', needsKey: true, keyUrl: 'https://huggingface.co/settings/tokens' },
  nvidia: { label: 'NVIDIA NIM (free credits)', tier: 'free-key', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-8b-instruct', needsKey: true, keyUrl: 'https://build.nvidia.com' },
  sambanova: { label: 'SambaNova Cloud (free tier)', tier: 'free-key', baseUrl: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-3.1-8B-Instruct', needsKey: true, keyUrl: 'https://cloud.sambanova.ai/apis' },
  cloudflare: { label: 'Cloudflare Workers AI (free daily allowance)', tier: 'free-key', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1', model: '@cf/meta/llama-3.1-8b-instruct', needsKey: true, keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', note: 'Replace YOUR_ACCOUNT_ID in the base URL with your Cloudflare account id.' },
  cohere: { label: 'Cohere (free trial key)', tier: 'free-key', baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-r7b-12-2024', needsKey: true, keyUrl: 'https://dashboard.cohere.com/api-keys' },
  llm7: { label: 'LLM7.io (free key)', tier: 'free-key', baseUrl: 'https://api.llm7.io/v1', model: 'default', needsKey: true, keyUrl: 'https://token.llm7.io' },
  zai: { label: 'Z.ai GLM (free Flash models)', tier: 'free-key', baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-4.5-flash', needsKey: true, keyUrl: 'https://z.ai/manage-apikey/apikey-list' },
  zhipu: { label: 'Zhipu BigModel (China, free GLM Flash)', tier: 'free-key', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', needsKey: true, keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  siliconflow: { label: 'SiliconFlow (free models)', tier: 'free-key', baseUrl: 'https://api.siliconflow.com/v1', model: 'Qwen/Qwen2.5-7B-Instruct', needsKey: true, keyUrl: 'https://cloud.siliconflow.com/account/ak' },
  chutes: { label: 'Chutes (free tier)', tier: 'free-key', baseUrl: 'https://llm.chutes.ai/v1', model: '', needsKey: true, keyUrl: 'https://chutes.ai', note: 'Use "Load models" to pick a model.' },
  scaleway: { label: 'Scaleway Generative APIs (free tokens)', tier: 'free-key', baseUrl: 'https://api.scaleway.ai/v1', model: 'llama-3.1-8b-instruct', needsKey: true, keyUrl: 'https://console.scaleway.com/iam/api-keys' },
  dashscope: { label: 'Alibaba Qwen / DashScope (free quota)', tier: 'free-key', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo', needsKey: true, keyUrl: 'https://modelstudio.console.alibabacloud.com' },
  nebius: { label: 'Nebius AI Studio (trial credit)', tier: 'free-key', baseUrl: 'https://api.studio.nebius.com/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', needsKey: true, keyUrl: 'https://studio.nebius.com' },
  hyperbolic: { label: 'Hyperbolic (trial credit)', tier: 'free-key', baseUrl: 'https://api.hyperbolic.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', needsKey: true, keyUrl: 'https://app.hyperbolic.xyz/settings' },
  novita: { label: 'Novita AI (trial credit)', tier: 'free-key', baseUrl: 'https://api.novita.ai/v3/openai', model: 'meta-llama/llama-3.1-8b-instruct', needsKey: true, keyUrl: 'https://novita.ai/settings/key-management' },

  // ---- runs on your PC ----
  ollama: { label: 'Ollama (local)', tier: 'local', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', needsKey: false },
  lmstudio: { label: 'LM Studio (local)', tier: 'local', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false, note: 'Start the local server in LM Studio, then "Load models".' },
  jan: { label: 'Jan (local)', tier: 'local', baseUrl: 'http://localhost:1337/v1', model: '', needsKey: false },
  koboldcpp: { label: 'KoboldCpp (local)', tier: 'local', baseUrl: 'http://localhost:5001/v1', model: 'koboldcpp', needsKey: false },
  llamacpp: { label: 'llama.cpp server (local)', tier: 'local', baseUrl: 'http://localhost:8080/v1', model: '', needsKey: false },
  localai: { label: 'LocalAI (local)', tier: 'local', baseUrl: 'http://localhost:8080/v1', model: '', needsKey: false },
  vllm: { label: 'vLLM (local / self-hosted)', tier: 'local', baseUrl: 'http://localhost:8000/v1', model: '', needsKey: false },
  textgenwebui: { label: 'text-generation-webui / oobabooga (local)', tier: 'local', baseUrl: 'http://localhost:5000/v1', model: '', needsKey: false, note: 'Start it with the --api flag.' },
  tabbyapi: { label: 'TabbyAPI / ExLlamaV2 (local)', tier: 'local', baseUrl: 'http://localhost:5000/v1', model: '', needsKey: true, note: 'Key = the api_key from its api_tokens.yml.' },
  sglang: { label: 'SGLang (local / self-hosted)', tier: 'local', baseUrl: 'http://localhost:30000/v1', model: '', needsKey: false },
  aphrodite: { label: 'Aphrodite Engine (local / self-hosted)', tier: 'local', baseUrl: 'http://localhost:2242/v1', model: '', needsKey: false },
  gpt4all: { label: 'GPT4All (local)', tier: 'local', baseUrl: 'http://localhost:4891/v1', model: '', needsKey: false, note: 'Enable "Local API Server" in GPT4All settings.' },
  llamafile: { label: 'llamafile (local)', tier: 'local', baseUrl: 'http://localhost:8080/v1', model: 'LLaMA_CPP', needsKey: false },
  xinference: { label: 'Xorbits Inference (local / self-hosted)', tier: 'local', baseUrl: 'http://localhost:9997/v1', model: '', needsKey: false },
  tgi: { label: 'Hugging Face TGI (self-hosted)', tier: 'local', baseUrl: 'http://localhost:8080/v1', model: 'tgi', needsKey: false },
  // ---- gateways / proxies (run one yourself; they route to many providers) ----
  omniroute: { label: 'OmniRoute gateway (free providers, auto-fallback)', tier: 'gateway', baseUrl: 'http://localhost:20128/v1', model: '', needsKey: false, note: 'Install with "npm install -g omniroute", add providers in its dashboard, then "Load models". Set REQUIRE_API_KEY if the port is reachable from other PCs.', keyUrl: 'https://omniroute.online' },
  litellm: { label: 'LiteLLM proxy', tier: 'gateway', baseUrl: 'http://localhost:4000/v1', model: '', needsKey: false, note: 'Use the model names from your LiteLLM config; the key is your LiteLLM virtual key if you set one.' },
  portkey: { label: 'Portkey AI Gateway (local)', tier: 'gateway', baseUrl: 'http://localhost:8787/v1', model: '', needsKey: false, note: 'Open-source gateway ("npx @portkey-ai/gateway").' },
  oneapi: { label: 'One API / New API (self-hosted)', tier: 'gateway', baseUrl: 'http://localhost:3000/v1', model: '', needsKey: true, note: 'Use a token created in its dashboard.' },
  openwebui: { label: 'Open WebUI (its API)', tier: 'gateway', baseUrl: 'http://localhost:3000/api', model: '', needsKey: true, note: 'Settings → Account → API key in Open WebUI.' },
  anythingllm: { label: 'AnythingLLM (OpenAI-compatible API)', tier: 'gateway', baseUrl: 'http://localhost:3001/api/v1/openai', model: '', needsKey: true, note: 'Model = your workspace slug; key from AnythingLLM → Settings → Developer API.' },
  cfgateway: { label: 'Cloudflare AI Gateway (unified)', tier: 'gateway', baseUrl: 'https://gateway.ai.cloudflare.com/v1/YOUR_ACCOUNT_ID/YOUR_GATEWAY/compat', model: 'openai/gpt-4o-mini', needsKey: true, note: 'Replace YOUR_ACCOUNT_ID / YOUR_GATEWAY; the key is the upstream provider key.' },

  // ---- paid (some with trial credit) ----
  openai: { label: 'OpenAI', tier: 'paid', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', tier: 'paid', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  grok: { label: 'xAI (Grok)', tier: 'paid', baseUrl: 'https://api.x.ai/v1', model: 'grok-3-mini', needsKey: true, keyUrl: 'https://console.x.ai' },
  deepseek: { label: 'DeepSeek (very cheap)', tier: 'paid', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys' },
  together: { label: 'Together AI', tier: 'paid', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', needsKey: true, keyUrl: 'https://api.together.ai/settings/api-keys' },
  fireworks: { label: 'Fireworks AI', tier: 'paid', baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', needsKey: true, keyUrl: 'https://fireworks.ai/account/api-keys' },
  perplexity: { label: 'Perplexity (web-connected)', tier: 'paid', baseUrl: 'https://api.perplexity.ai', model: 'sonar', needsKey: true, keyUrl: 'https://www.perplexity.ai/settings/api' },
  moonshot: { label: 'Moonshot (Kimi)', tier: 'paid', baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2-0905-preview', needsKey: true, keyUrl: 'https://platform.moonshot.ai/console/api-keys' },
  azure_openai: { label: 'Azure OpenAI / AI Foundry (v1 API)', tier: 'paid', baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/v1', model: '', needsKey: true, note: 'Replace YOUR_RESOURCE; model = your deployment name.' },

  custom: { label: 'Custom (any OpenAI-compatible URL)', tier: 'custom', baseUrl: '', model: '', needsKey: false }
}

const TIER_LABELS = { free: 'Free — no key', 'free-key': 'Free with a free key', local: 'Runs on your PC', gateway: 'Gateways / proxies (route to many providers)', paid: 'Paid', custom: 'Other' }

const cleanBase = b => String(b || '').trim().replace(/\/+$/, '')

// Extra headers some providers want.
function headersFor ({ baseUrl, apiKey }, { listing = false } = {}) {
  const h = { 'Content-Type': 'application/json' }
  const key = String(apiKey || '').trim()
  if (key) h.Authorization = `Bearer ${key}`
  const base = cleanBase(baseUrl)
  if (/openrouter\.ai/i.test(base)) { h['HTTP-Referer'] = 'https://github.com/NekoSuneProjects/KitsuNexus'; h['X-Title'] = 'KitsuNexus' }
  // Anthropic's OpenAI-compatible chat endpoint takes the Bearer key; its
  // model list is the native API, which wants x-api-key + a version header.
  if (listing && /api\.anthropic\.com/i.test(base) && key) { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01' }
  return h
}

// Short, human reason for an error (bad key / rate limited / not running...).
function explainError (err) {
  const status = err?.response?.status
  const msg = err?.response?.data?.error?.message || err?.response?.data?.message || (typeof err?.response?.data?.error === 'string' ? err.response.data.error : '') || err?.message || String(err)
  if (status === 401 || status === 403) return `API key rejected (${status})${msg ? ': ' + msg : ''}`
  if (status === 429) return `rate limited / free quota used up (429)${msg ? ': ' + msg : ''}`
  if (status === 404) return `model or URL not found (404)${msg ? ': ' + msg : ''}`
  if (err?.code === 'ECONNREFUSED') return 'nothing is running at that address (is the local app started?)'
  if (err?.code === 'ENOTFOUND') return 'address not found (check the base URL)'
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(msg)) return 'timed out'
  return status ? `${status}: ${msg}` : msg
}

// Worth trying the backup provider for these (not for e.g. a bad prompt).
function isRetryable (err) {
  const s = err?.response?.status
  return !s || s === 401 || s === 402 || s === 403 || s === 404 || s === 408 || s === 429 || s >= 500
}

async function chatOnce ({ baseUrl, apiKey, model, messages, maxTokens = 200, temperature = 0.4, timeout = 20000 }) {
  const base = cleanBase(baseUrl)
  if (!base) throw new Error('No AI base URL set')
  const placeholder = base.match(/YOUR_[A-Z_]+/)
  if (placeholder) throw new Error(`Replace ${placeholder[0]} in the base URL with your own value`)
  const body = { messages, max_tokens: maxTokens, temperature }
  if (String(model || '').trim()) body.model = String(model).trim()
  const res = await axios.post(`${base}/chat/completions`, body, { headers: headersFor({ baseUrl: base, apiKey }), timeout })
  const msg = res.data?.choices?.[0]?.message
  // Some reasoning models put the answer in reasoning_content when content is empty.
  return String(msg?.content || msg?.reasoning_content || '').trim()
}

// Try each config in order; the first that answers wins. Returns
// { text, used: index } or throws the last error (with .attempts).
async function chatWithFallback (configs, request) {
  const list = (configs || []).filter(c => c && cleanBase(c.baseUrl))
  if (!list.length) throw new Error('No AI provider configured')
  const attempts = []
  for (let i = 0; i < list.length; i++) {
    try {
      const text = await chatOnce({ ...list[i], ...request })
      return { text, used: i, attempts }
    } catch (err) {
      attempts.push(explainError(err))
      if (i === list.length - 1 || !isRetryable(err)) { err.attempts = attempts; err.explained = attempts.join(' → '); throw err }
    }
  }
}

// List models the key can use. OpenRouter marks price 0 models as free.
async function listModels ({ baseUrl, apiKey }) {
  const base = cleanBase(baseUrl)
  if (!base) return { ok: false, error: 'No base URL' }
  try {
    const res = await axios.get(`${base}/models`, { headers: headersFor({ baseUrl: base, apiKey }, { listing: true }), timeout: 15000 })
    const raw = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data?.models) ? res.data.models : Array.isArray(res.data) ? res.data : []
    const models = raw.map(m => {
      const id = String(m.id || m.name || '').replace(/^models\//, '')
      const p = m.pricing || {}
      const free = /:free$/.test(id) || (p.prompt !== undefined && Number(p.prompt) === 0 && Number(p.completion || 0) === 0)
      return { id, name: m.name && m.name !== id ? String(m.name) : '', free, context: Number(m.context_length || m.context_window || 0) || 0 }
    }).filter(m => m.id)
    models.sort((a, b) => (b.free - a.free) || a.id.localeCompare(b.id))
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: explainError(err) }
  }
}

async function testConnection (cfg) {
  const t0 = Date.now()
  try {
    const text = await chatOnce({ ...cfg, messages: [{ role: 'user', content: 'Reply with just the word OK.' }], maxTokens: 10, timeout: 20000 })
    return { ok: true, reply: text.slice(0, 80), ms: Date.now() - t0 }
  } catch (err) {
    return { ok: false, error: explainError(err), ms: Date.now() - t0 }
  }
}

module.exports = { AI_PROVIDERS, TIER_LABELS, headersFor, chatOnce, chatWithFallback, listModels, testConnection, explainError, isRetryable }

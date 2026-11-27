// modules/ai/intelliChat.js
// IntelliChat - AI helper for chatbox lines. Provider-agnostic: works with any
// OpenAI-compatible /chat/completions endpoint, so you can use OpenAI, a local
// Ollama, a LiteLLM gateway, xAI (Grok), Google Gemini (OpenAI-compat), Groq,
// OpenRouter, Anthropic (Claude), or a custom base URL.
//
// Runs in the MAIN process.

// Provider presets live in aiProviders.js (shared with the Jarvis assistant).
const { AI_PROVIDERS, chatOnce, explainError } = require('./aiProviders')

const PROMPTS = {
  rewrite: 'Rewrite the user message to be friendly and fun for a VRChat chatbox. Keep it under 140 characters. Reply with ONLY the rewritten text.',
  spellcheck: 'Fix spelling and grammar of the user message. Keep meaning and tone. Reply with ONLY the corrected text.',
  shorten: 'Shorten the user message to fit a VRChat chatbox (max 140 chars) without losing meaning. Reply with ONLY the shortened text.',
  translate: 'Translate the user message to English. Reply with ONLY the translation.'
}

async function intelliRewrite ({ baseUrl, apiKey, model, mode = 'rewrite', text }) {
  const base = String(baseUrl || AI_PROVIDERS.openai.baseUrl).trim().replace(/\/+$/, '')
  const useModel = String(model || AI_PROVIDERS.openai.model).trim()
  const input = String(text || '').trim()
  if (!input) throw new Error('Nothing to send')

  const system = PROMPTS[mode] || PROMPTS.rewrite

  try {
    const out = await chatOnce({
      baseUrl: base,
      apiKey,
      model: useModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: input }],
      maxTokens: 120,
      temperature: 0.7,
      timeout: 30000
    })
    return (out || input).slice(0, 144)
  } catch (err) {
    throw new Error(`AI request failed: ${explainError(err)}`)
  }
}

module.exports = { intelliRewrite, AI_PROVIDERS }

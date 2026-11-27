// modules/ai/assistantBrain.js
// Turns a spoken command (already wake-word-stripped) into one small JSON
// action the renderer can execute against the real VRChat API surface it
// already has, or into a general conversational reply. Reuses the same
// OpenAI-compatible /chat/completions call shape as intelliChat.js, with
// its own purpose-built system prompt. Runs in the MAIN process.

const { chatWithFallback, explainError } = require('./aiProviders')

const SYSTEM_PROMPT = `You are a voice assistant built into a VRChat companion desktop app - think of yourself like Alexa/Siri, but running inside VRChat's companion app. The user just spoke a command right after saying your wake word - you only see the command part.

Reply with ONLY one JSON object, no other text, no markdown fences, matching exactly one of these shapes:
{"action":"friend_status","name":"<friend display name as spoken>"}
{"action":"who_is_online"}
{"action":"my_status"}
{"action":"set_status","text":"<new status text, short>"}
{"action":"sos"}
{"action":"get_weather"}
{"action":"get_time","timezone":"<IANA timezone, e.g. \"America/New_York\" for Eastern Time or \"Asia/Tokyo\" for Japan - omit entirely if no place/region was mentioned>","place":"<short label matching what the user said, e.g. \"Eastern Time\" or \"Tokyo\" - omit if timezone is omitted>"}
{"action":"search_web","query":"<a short, focused search-engine-style query>"}
{"action":"chat","reply":"<a short, warm, natural spoken-style reply>"}

What you're for:
- VRChat-specific things: friend status, who's online, your own status/status text, sending SOS.
- Being a genuine creative partner for VRChat world-creation - brainstorming world ideas, themes, mechanics, layouts, how to pace an experience, naming things, feedback on a concept the user describes out loud. Use "chat" for this and be genuinely helpful and opinionated, not just agreeable.
- General assistant things, like Alexa: current weather ("get_weather"), the current time or date/day ("get_time"), news/current events/general knowledge/facts/sports scores/prices/anything time-sensitive or factual you're not confident about from memory ("search_web" with a concise query).
- Everyday conversation, questions, opinions, jokes, small talk - use "chat" and just talk like a helpful, personable assistant.

Rules:
- NEVER produce an action that changes the user's bio. Bio is only ever changed manually by the user or via a saved bio preset - never by voice command. If asked to change the bio, use "chat" and explain that bio changes have to be done manually or via a bio preset.
- "sos" is only for an explicit, clear request for help/to notify someone - never infer it from mood alone.
- For "what time is it", "what's the date/day today" and similar, always use "get_time" - never guess the time/date yourself, you don't actually know it. If a specific place/region/timezone is mentioned (e.g. "Eastern Time", "in Tokyo", "UK time"), resolve it to a real IANA timezone name yourself and include it - otherwise omit "timezone" entirely so it defaults to the user's own local time.
- Do NOT help with writing, debugging, or explaining code, even if asked. This is a voice assistant for conversation and VRChat, not a coding tool. If asked to code something, use "chat" and briefly say that's better suited to an actual coding assistant.
- If unsure whether something needs a live search, prefer "search_web" over guessing at facts that could be wrong or outdated.
- If the command doesn't clearly match one of the specific actions above, use "chat".`

const SUMMARIZE_PROMPT = `You are a voice assistant reading web search results aloud to answer the user's spoken question. Given the original question and a list of search results (title/url/snippet), answer in 1-3 short, natural, spoken-style sentences using only what the results actually support. If the results don't answer the question, say so honestly rather than guessing. Reply with ONLY the spoken answer - no markdown, no citations, no "according to".`

// configs: one AI config ({ baseUrl, apiKey, model }) or a list tried in order
// (primary, then backup) - free tiers rate-limit often, so a backup provider
// keeps the assistant answering. See aiProviders.chatWithFallback.
function asList (cfg) {
  if (Array.isArray(cfg)) return cfg
  return [{ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model }]
}

async function callChat (cfg, { systemPrompt, userContent, maxTokens = 200 }) {
  const r = await chatWithFallback(asList(cfg), {
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    maxTokens,
    temperature: 0.4
  })
  return r.text
}

// opts: { text, configs } or the older { baseUrl, apiKey, model, text }.
async function interpretCommand (opts = {}) {
  const input = String(opts.text || '').trim()
  if (!input) return { action: 'chat', reply: '' }

  try {
    const raw = await callChat(opts.configs || opts, { systemPrompt: SYSTEM_PROMPT, userContent: input })
    return parseAction(raw, input)
  } catch (err) {
    // Surface the real cause instead of a generic message - almost always
    // "no/invalid API key", a used-up free quota, or a local provider (e.g.
    // Ollama) that isn't running.
    const detail = err.explained || explainError(err)
    return { action: 'chat', reply: `Sorry, I couldn't reach my brain just now (${detail}). Check the AI settings in the AI tab.` }
  }
}

async function summarizeSearchResults (opts = {}) {
  const { query, results } = opts
  const list = (results || [])
    .map((r, i) => `${i + 1}. ${r.title}\n${r.content}\n(${r.url})`)
    .join('\n\n')
  const userContent = `Question: ${query}\n\nSearch results:\n${list}`

  try {
    const raw = await callChat(opts.configs || opts, { systemPrompt: SUMMARIZE_PROMPT, userContent, maxTokens: 250 })
    return raw || (results[0]?.content || '')
  } catch (_) {
    // Fall back to just reading the top snippet if the summarizing call fails.
    return results?.[0]?.content || ''
  }
}

function parseAction (raw, fallbackText) {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
    if (parsed && typeof parsed.action === 'string') return parsed
  } catch (_) {}
  return { action: 'chat', reply: raw || fallbackText }
}

module.exports = { interpretCommand, summarizeSearchResults }

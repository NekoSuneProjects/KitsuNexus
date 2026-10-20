'use strict' // Twitch chat/reward events mapped to avatar OSC interactions.

const axios = require('axios')
const WebSocket = require('ws')

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws'

let irc = null
let eventsub = null
let resetTimer = null
let reconnectTimer = null
let ircReconnectTimer = null
let config = null
let update = () => {}
let sendParam = null
let generation = 0
let broadcasterId = ''
let authLogin = ''
let mappings = []
const seenMessages = new Set()

const state = {
  running: false,
  chatConnected: false,
  rewardsConnected: false,
  lastTrigger: null,
  error: ''
}

function cleanToken (value) { return String(value || '').trim().replace(/^oauth:/i, '') }
function cleanLogin (value) { return String(value || '').trim().toLowerCase().replace(/^#/, '') }

function parseMappings (input) {
  const rows = Array.isArray(input) ? input : String(input || '').split(/\r?\n/).map((line, index) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return null
    const parts = text.split('|').map(value => value.trim())
    if (parts.length < 3) throw new Error(`Mapping line ${index + 1} must be: command | !name | value`)
    return { source: parts[0], match: parts[1], value: parts[2], enabled: parts[3] !== 'off' }
  }).filter(Boolean)

  return rows.map((row, index) => {
    const source = String(row.source || row.type || '').trim().toLowerCase()
    const match = String(row.match || row.name || '').trim()
    const value = Number(row.value)
    if (!['command', 'reward'].includes(source)) throw new Error(`Mapping ${index + 1} source must be command or reward`)
    if (!match) throw new Error(`Mapping ${index + 1} needs a command or reward title/ID`)
    if (!Number.isInteger(value) || value < 1 || value > 255) throw new Error(`Mapping ${index + 1} value must be an integer from 1 to 255`)
    return { source, match, matchLower: match.toLowerCase(), value, enabled: row.enabled !== false }
  })
}

function emit (extra = {}) {
  Object.assign(state, extra)
  update({ ...state, mappings: mappings.map(({ matchLower, ...row }) => row) })
}

function firstSeen (id) {
  if (!id) return true
  if (seenMessages.has(id)) return false
  seenMessages.add(id)
  if (seenMessages.size > 250) seenMessages.delete(seenMessages.values().next().value)
  return true
}

function oscAddress () {
  const name = String(config?.parameter || 'twitch').trim().replace(/^\/avatar\/parameters\//, '').replace(/^\/+/, '')
  return `/avatar/parameters/${name || 'twitch'}`
}

function trigger (mapping, source, details = {}) {
  if (!state.running || !mapping?.enabled) return false
  const event = { source, match: mapping.match, value: mapping.value, at: Date.now(), ...details }
  sendParam(oscAddress(), mapping.value, 'int')
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => sendParam(oscAddress(), 0, 'int'), Math.max(100, Number(config.pulseMs) || 750))
  emit({ lastTrigger: event, error: '' })
  return true
}

function matchCommand (message, rows = mappings) {
  const first = String(message || '').trim().split(/\s+/)[0].toLowerCase()
  return rows.find(row => row.enabled && row.source === 'command' && row.matchLower === first)
}

function matchReward (reward = {}, rows = mappings) {
  const id = String(reward.id || '').toLowerCase()
  const title = String(reward.title || '').trim().toLowerCase()
  return rows.find(row => row.enabled && row.source === 'reward' && (row.matchLower === id || row.matchLower === title))
}

function parseIrcLine (line) {
  let rest = String(line || '')
  const tags = {}
  if (rest.startsWith('@')) {
    const split = rest.indexOf(' ')
    rest.slice(1, split).split(';').forEach(tag => {
      const [key, ...value] = tag.split('=')
      tags[key] = value.join('=').replace(/\\s/g, ' ')
    })
    rest = rest.slice(split + 1)
  }
  const privmsg = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.*)$/)
  return privmsg ? { tags, user: privmsg[1], message: privmsg[2] } : null
}

function openIrc () {
  const socket = new WebSocket(IRC_URL)
  irc = socket
  socket.on('open', () => {
    if (irc !== socket || !state.running) return
    socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
    socket.send(`PASS oauth:${cleanToken(config.token)}`)
    socket.send(`NICK ${authLogin}`)
    socket.send(`JOIN #${cleanLogin(config.login)}`)
  })
  socket.on('message', raw => {
    if (irc !== socket || !state.running) return
    for (const line of raw.toString().split('\r\n')) {
      if (line.startsWith('PING')) { socket.send(line.replace(/^PING/, 'PONG')); continue }
      if (/ 001 | JOIN #/i.test(line)) emit({ chatConnected: true })
      if (/NOTICE \* :Login authentication failed/i.test(line)) emit({ error: 'Twitch chat authentication failed. Reconnect Twitch in OAuth Accounts.' })
      const msg = parseIrcLine(line)
      if (!msg) continue
      if (!firstSeen(msg.tags.id)) continue
      const mapping = matchCommand(msg.message)
      if (mapping) trigger(mapping, 'command', { user: msg.tags['display-name'] || msg.user, message: msg.message })
    }
  })
  socket.on('error', err => { if (irc === socket && state.running) emit({ chatConnected: false, error: `Twitch chat: ${err.message}` }) })
  socket.on('close', () => {
    if (irc !== socket) return
    emit({ chatConnected: false })
    if (state.running) ircReconnectTimer = setTimeout(openIrc, 5000)
  })
}

async function subscribeRewards (sessionId) {
  await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
    transport: { method: 'websocket', session_id: sessionId }
  }, {
    headers: { Authorization: `Bearer ${cleanToken(config.token)}`, 'Client-Id': config.clientId },
    timeout: 10000
  })
}

function openEventSub (url = EVENTSUB_URL, subscribe = true) {
  const socket = new WebSocket(url)
  eventsub = socket
  socket.on('message', async raw => {
    if (eventsub !== socket || !state.running) return
    let message
    try { message = JSON.parse(raw.toString()) } catch (_) { return }
    const type = message.metadata?.message_type
    if (type === 'session_welcome') {
      try {
        if (subscribe) await subscribeRewards(message.payload.session.id)
        if (eventsub !== socket || !state.running) return
        emit({ rewardsConnected: true, error: '' })
      } catch (err) {
        if (eventsub !== socket || !state.running) return
        emit({ rewardsConnected: false, error: `Twitch rewards: ${err.response?.data?.message || err.message}. Reconnect Twitch with reward permission.` })
      }
    } else if (type === 'session_reconnect') {
      const reconnectUrl = message.payload?.session?.reconnect_url
      if (reconnectUrl) {
        socket.removeAllListeners('close')
        try { socket.close() } catch (_) {}
        openEventSub(reconnectUrl, false)
      }
    } else if (type === 'notification') {
      if (!firstSeen(message.metadata?.message_id)) return
      const event = message.payload?.event || {}
      const mapping = matchReward(event.reward)
      if (mapping) trigger(mapping, 'reward', {
        user: event.user_name || event.user_login || '',
        reward: event.reward?.title || '',
        rewardId: event.reward?.id || ''
      })
    } else if (type === 'revocation') {
      emit({ rewardsConnected: false, error: `Twitch reward subscription revoked: ${message.payload?.subscription?.status || 'unknown reason'}` })
    }
  })
  socket.on('error', err => { if (eventsub === socket && state.running) emit({ rewardsConnected: false, error: `Twitch rewards: ${err.message}` }) })
  socket.on('close', () => {
    if (eventsub !== socket) return
    emit({ rewardsConnected: false })
    if (state.running) reconnectTimer = setTimeout(() => openEventSub(), 5000)
  })
}

async function resolveUsers () {
  const headers = { Authorization: `Bearer ${cleanToken(config.token)}`, 'Client-Id': config.clientId }
  const [validation, auth, channel] = await Promise.all([
    axios.get('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${cleanToken(config.token)}` }, timeout: 10000 }),
    axios.get('https://api.twitch.tv/helix/users', { headers, timeout: 10000 }),
    axios.get('https://api.twitch.tv/helix/users', { params: { login: cleanLogin(config.login) }, headers, timeout: 10000 })
  ])
  const scopes = validation.data?.scopes || []
  const missing = ['chat:read', 'channel:read:redemptions'].filter(scope => !scopes.includes(scope))
  if (missing.length) throw new Error(`Twitch login is missing ${missing.join(' and ')}. Use Login with Twitch again in OAuth Accounts.`)
  if (validation.data?.client_id && validation.data.client_id !== config.clientId) throw new Error('This OAuth token belongs to a different Twitch Client ID. Log in again.')
  const authUser = auth.data?.data?.[0]
  const channelUser = channel.data?.data?.[0]
  if (!authUser?.login) throw new Error('Could not identify the Twitch account for this token')
  if (!channelUser?.id) throw new Error(`Twitch channel "${config.login}" was not found`)
  if (authUser.id !== channelUser.id) throw new Error('For reward redemptions, log in with the Twitch account that owns this channel.')
  return { login: authUser.login, channelId: channelUser.id }
}

async function start (options, oscSender, listener = () => {}) {
  stop(false)
  const run = generation
  config = { parameter: 'twitch', pulseMs: 750, ...(options || {}) }
  update = listener
  sendParam = oscSender
  mappings = parseMappings(config.mappings)
  seenMessages.clear()
  if (typeof sendParam !== 'function') throw new TypeError('Twitch Interactive needs an OSC sender')
  if (!config.clientId || !cleanToken(config.token) || !cleanLogin(config.login)) throw new Error('Authorize Twitch first in OAuth Accounts (Client ID, channel, and OAuth token are required).')
  if (!mappings.length) throw new Error('Add at least one command or reward mapping.')
  emit({ running: true, chatConnected: false, rewardsConnected: false, lastTrigger: null, error: '' })
  try {
    const identity = await resolveUsers()
    if (run !== generation) return { running: false }
    authLogin = identity.login
    broadcasterId = identity.channelId
    openIrc()
    openEventSub()
  } catch (err) {
    if (run !== generation) return { running: false }
    stop(false)
    emit({ error: err.response?.data?.message || err.message })
    throw err
  }
  return { ...state }
}

function stop (notify = true) {
  generation++
  state.running = false
  clearTimeout(resetTimer)
  clearTimeout(reconnectTimer)
  clearTimeout(ircReconnectTimer)
  resetTimer = reconnectTimer = ircReconnectTimer = null
  if (irc) { irc.removeAllListeners(); try { irc.close() } catch (_) {} }
  if (eventsub) { eventsub.removeAllListeners(); try { eventsub.close() } catch (_) {} }
  irc = eventsub = null
  if (sendParam && config) sendParam(oscAddress(), 0, 'int')
  state.chatConnected = false
  state.rewardsConnected = false
  if (notify) emit()
  return { ...state }
}

function getState () { return { ...state } }

module.exports = { start, stop, getState, parseMappings, parseIrcLine, matchCommand, matchReward }

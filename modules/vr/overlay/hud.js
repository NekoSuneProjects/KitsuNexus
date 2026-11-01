'use strict'
const mode = new URLSearchParams(location.search).get('mode')
document.body.dataset.mode = mode === 'vr' ? 'vr' : 'desktop'
document.getElementById('mode').textContent = mode === 'vr' ? 'SteamVR' : 'Desktop'
function showTime () {
  document.getElementById('clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date())
}
showTime()
setInterval(showTime, 15000)
function short (value, fallback) {
  return typeof value === 'string' && value.trim() ? value.slice(0, 110) : fallback
}
let previousPlayers = null
const notices = []
const alerts = document.getElementById('alerts')
const PREF_KEY = 'kitsunexus-hud-prefs-v1'
const defaults = { limit: 12, fade: 15, players: true, tiles: true, music: true, heart: true, language: 'en', preset: 'full' }
let prefs = { ...defaults }
try {
  const stored = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
  if (stored && typeof stored === 'object') {
    prefs.limit = [3, 6, 12, 20].includes(Number(stored.limit)) ? Number(stored.limit) : 12
    prefs.fade = Number.isFinite(Number(stored.fade)) ? Math.max(0, Math.min(120, Number(stored.fade))) : 15
    prefs.players = stored.players !== false
    prefs.tiles = stored.tiles !== false
    prefs.music = stored.music !== false
    prefs.heart = stored.heart !== false
    prefs.preset = ['full', 'compact', 'social', 'music', 'custom'].includes(stored.preset) ? stored.preset : 'full'
    prefs.language = typeof stored.language === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(stored.language) ? stored.language : 'en'
  }
} catch (_) {}
function renderPrefs () {
  document.getElementById('hudPreset').value = prefs.preset
  document.getElementById('noticeLimit').value = String(prefs.limit)
  document.getElementById('noticeFade').value = String(prefs.fade)
  document.getElementById('showPlayers').checked = prefs.players
  document.getElementById('showTiles').checked = prefs.tiles
  document.getElementById('showMusic').checked = prefs.music
  document.getElementById('showHeart').checked = prefs.heart
  document.getElementById('quickLanguage').value = prefs.language
  document.getElementById('players').hidden = !prefs.players
  document.getElementById('hudTiles').hidden = !prefs.tiles
  document.getElementById('music').closest('.tile').hidden = !prefs.music
  document.getElementById('heart').closest('.tile').hidden = !prefs.heart
}
function savePrefs () {
  prefs.preset = document.getElementById('hudPreset').value
  prefs.limit = Number(document.getElementById('noticeLimit').value)
  prefs.fade = Math.max(0, Math.min(120, Number(document.getElementById('noticeFade').value) || 0))
  prefs.players = document.getElementById('showPlayers').checked
  prefs.tiles = document.getElementById('showTiles').checked
  prefs.music = document.getElementById('showMusic').checked
  prefs.heart = document.getElementById('showHeart').checked
  prefs.language = document.getElementById('quickLanguage').value
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch (_) {}
  renderPrefs()
  renderNotices()
}
for (const id of ['noticeLimit', 'noticeFade', 'showPlayers', 'showTiles', 'showMusic', 'showHeart', 'quickLanguage']) {
  document.getElementById(id).addEventListener('change', () => {
    if (['showPlayers', 'showTiles', 'showMusic', 'showHeart'].includes(id)) document.getElementById('hudPreset').value = 'custom'
    savePrefs()
  })
}
document.getElementById('hudPreset').addEventListener('change', () => {
  const selected = document.getElementById('hudPreset').value
  const layouts = {
    full: { players: true, tiles: true, music: true, heart: true },
    compact: { players: false, tiles: true, music: false, heart: false },
    social: { players: true, tiles: false, music: false, heart: false },
    music: { players: false, tiles: true, music: true, heart: false }
  }
  if (layouts[selected]) Object.assign(prefs, layouts[selected])
  prefs.preset = selected
  renderPrefs()
  savePrefs()
})
document.getElementById('resetHudPrefs').addEventListener('click', () => {
  prefs = { ...defaults }
  renderPrefs()
  savePrefs()
})
renderPrefs()
function renderNotices () {
  const now = Date.now()
  const active = prefs.fade ? notices.filter(n => now - n.at < prefs.fade * 1000) : notices
  alerts.textContent = active.slice(0, prefs.limit).map(n => n.text).join(' | ')
}
setInterval(renderNotices, 1000)
function addNotice (message) {
  notices.unshift({ at: Date.now(), text: new Date().toLocaleTimeString() + ' · ' + message })
  if (notices.length > 20) notices.length = 20
  renderNotices()
}
document.getElementById('clearAlerts').addEventListener('click', () => { notices.length = 0; alerts.textContent = '' })
window.kitsunexusHud.onData(state => {
  if (Array.isArray(state?.players)) {
    const incoming = state.players.filter(p => typeof p === 'string').slice(0, 80)
    const names = new Set(incoming)
    if (previousPlayers !== null) {
      const joined = incoming.filter(p => !previousPlayers.has(p))
      const left = [...previousPlayers].filter(p => !names.has(p))
      for (const name of joined.slice(0, 20)) addNotice(name + ' joined')
      for (const name of left.slice(0, 20)) addNotice(name + ' left')
    }
    previousPlayers = names
    document.getElementById('players').textContent = incoming.length ? 'Players (' + incoming.length + '): ' + incoming.join(' • ') : 'No players detected'
  }
  if (!state || typeof state !== 'object') return
  if (Object.prototype.hasOwnProperty.call(state, 'session')) document.getElementById('session').textContent = short(state.session, 'Not connected')
  if (Object.prototype.hasOwnProperty.call(state, 'music')) document.getElementById('music').textContent = short(state.music, 'No track')
  if (Object.prototype.hasOwnProperty.call(state, 'heart')) document.getElementById('heart').textContent = short(state.heart, 'Not connected')
})

const actionStatus = document.getElementById('actionStatus')
const quickMessage = document.getElementById('quickMessage')
async function performAction (type) {
  actionStatus.textContent = 'Working…'
  try {
    const response = await window.kitsunexusHud.action({ type, text: quickMessage.value, target: document.getElementById('quickLanguage').value })
    if (!response || response.ok === false) throw new Error(response?.error || 'Action failed')
    if (type === 'translate') quickMessage.value = String(response.translatedText || quickMessage.value).slice(0, 2000)
    actionStatus.textContent = response.message || 'Ready'
  } catch (err) { actionStatus.textContent = String(err.message || err).slice(0, 140) }
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => performAction(button.dataset.action)))
document.getElementById('quickSend').addEventListener('click', () => performAction('send'))
document.getElementById('quickTranslate').addEventListener('click', () => performAction('translate'))

quickMessage.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    performAction('send')
  }
})

const MESSAGE_KEY = 'kitsunexus-hud-message-presets-v1'
let messagePresets = []
try {
  const saved = JSON.parse(localStorage.getItem(MESSAGE_KEY) || '[]')
  if (Array.isArray(saved)) messagePresets = saved.filter(x => typeof x === 'string' && x.length <= 2000).slice(0, 20)
} catch (_) {}
function refreshMessagePresets () {
  const picker = document.getElementById('quickPreset')
  picker.replaceChildren(new Option('Message preset…', ''))
  messagePresets.forEach((message, i) => picker.add(new Option(message.slice(0, 50), String(i))))
}
function persistMessagePresets () {
  try { localStorage.setItem(MESSAGE_KEY, JSON.stringify(messagePresets)) } catch (_) {}
  refreshMessagePresets()
}
refreshMessagePresets()
document.getElementById('quickPreset').addEventListener('change', event => {
  if (event.target.value !== '') quickMessage.value = messagePresets[Number(event.target.value)] || ''
})
document.getElementById('saveQuickPreset').addEventListener('click', () => {
  const value = quickMessage.value.trim().slice(0, 2000)
  if (!value || messagePresets.includes(value)) return
  messagePresets.unshift(value)
  messagePresets = messagePresets.slice(0, 20)
  persistMessagePresets()
  actionStatus.textContent = 'Message preset saved locally'
})
document.getElementById('deleteQuickPreset').addEventListener('click', () => {
  const index = document.getElementById('quickPreset').value
  if (index === '') return
  messagePresets.splice(Number(index), 1)
  persistMessagePresets()
  actionStatus.textContent = 'Message preset removed'
})
document.getElementById('copyQuickMessage').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(quickMessage.value)
    actionStatus.textContent = 'Message copied'
  } catch (_) { actionStatus.textContent = 'Clipboard permission unavailable' }
})

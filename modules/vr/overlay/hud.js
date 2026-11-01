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
window.kitsunexusHud.onData(state => {
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
    const response = await window.kitsunexusHud.action({ type, text: quickMessage.value, target: 'en' })
    if (!response || response.ok === false) throw new Error(response?.error || 'Action failed')
    if (type === 'translate') quickMessage.value = String(response.translatedText || quickMessage.value).slice(0, 2000)
    actionStatus.textContent = response.message || 'Ready'
  } catch (err) { actionStatus.textContent = String(err.message || err).slice(0, 140) }
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => performAction(button.dataset.action)))
document.getElementById('quickSend').addEventListener('click', () => performAction('send'))
document.getElementById('quickTranslate').addEventListener('click', () => performAction('translate'))

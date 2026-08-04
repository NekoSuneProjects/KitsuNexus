/* NekoSuneAPPS renderer - wires the themed UI to the OSC layer and all modules. */
const { loadAudioDevices, setupAudioAnalysis, stopAudioAnalysis } = require('./modules/vrchat/audio/audioModule')
const {
  setOscPort, setOscReceiverPort, sendOsc, sendParam, sendBeat, sendChatboxMessage,
  startOscReceiver, stopOscReceiver, addOscListener, setExtraOscTargets, setExtraOscReceiverPorts
} = require('./modules/vrchat/osc/oscModule')
const { KatOscText } = require('./modules/vrchat/osc/katOscText')
const { AvatarScalingController } = require('./modules/vrchat/osc/avatarScaling')
const { vkName } = require('./modules/vrchat/osc/vkCodes')
const { oscPortsForProfileId } = require('./modules/vrchat/launcher/quickLaunch')
const { LANGUAGES } = require('./modules/ai/languageList')
const { ChatboxComposer } = require('./modules/vrchat/chatbox/chatboxComposer')
const { LiveTypingSender } = require('./modules/vrchat/chatbox/liveTyping')
const { DEFAULT_PRESETS } = require('./modules/vrchat/status/statusModule')
const { RealisticOscLeashController } = require('./modules/integrations/osc/leash/realisticOscLeash')
const { OscDigitalClock } = require('./modules/integrations/osc/clock/oscDigitalClock')
const { OscQrController } = require('./modules/integrations/osc/qr/oscQrModule')
const { ShazamOscController } = require('./modules/integrations/osc/recognition/shazamOscModule')
const { DesktopSttController } = require('./modules/integrations/osc/stt/desktopSttModule')
const { OcrTranslateController } = require('./modules/integrations/osc/ocr/ocrTranslateModule')
const { JarvisAssistant } = require('./modules/vrchat/assistant/jarvisAssistant')
const {
  getBleHeartRatePlatform,
  getBleHeartRatePlatforms,
  getBleHeartRateOptionalServices,
  findBleHeartRatePlatform,
  createBleHeartRateRelay
} = require('./modules/heartrate/devices/ble')

const goodmansBlePlatform = getBleHeartRatePlatform('goodmans')
const BLE_OPTIONAL_SERVICES = getBleHeartRateOptionalServices()

const api = window.electronAPI
const $ = id => document.getElementById(id)

;(function moveTranslationCards () {
  const target = $('translationCards')
  if (!target) return
  ;['aiProvider', 'translatorProvider'].forEach(id => {
    const el = $(id)
    const card = el && el.closest('.card')
    if (card) target.appendChild(card)
  })
})()

;(function moveTonToolCards () {
  const target = $('tonToolsCards')
  if (!target) return
  ;['tonOscEnable', 'essAudio'].forEach(id => {
    const el = $(id)
    const card = el && el.closest('.card')
    if (card) target.appendChild(card)
  })
})()

// Custom sidebar icons: for each nav button, try assets/icons/<data-tab>.png (then
// .svg). If found, swap it in for the emoji; if not, the emoji stays. Lets icons be
// added one at a time with no code changes.
;(function loadNavIcons () {
  document.querySelectorAll('.navbtn[data-tab]').forEach(btn => {
    const ico = btn.querySelector('.ico'); if (!ico) return
    const tab = btn.dataset.tab
    const tryExt = exts => {
      if (!exts.length) return
      const src = `assets/icons/${tab}.${exts[0]}`
      const img = new Image()
      img.onload = () => { ico.style.backgroundImage = `url("${src}")`; ico.classList.add('has-img') }
      img.onerror = () => tryExt(exts.slice(1))
      img.src = src
    }
    tryExt(['png', 'svg'])
  })
})()

// No credentials are shipped except the app's own fixed Discord Rich Presence
// ID below (owned by NekoSuneAPPS, not user data). Users still enter their own
// Twitch/bot IDs and secrets (see Docs / Setup) — never hardcode those.
const DEFAULT_TWITCH_CLIENT_ID = ''
// Fixed NekoSuneAPPS Discord Rich Presence Application ID. Intentionally not
// user-editable (see #discordAppId in index.html) — locked so RP always shows
// as the official app regardless of what's in a user's saved config.
const DEFAULT_DISCORD_APP_ID = '1534167604304937142'

let isAnalyzing = false
let beatState = false
let oscHistory = []
const maxHistory = 100

const composer = new ChatboxComposer({ sendChatboxMessage, onHoldChange: () => updateHoldStatus() })

/* ---------------- tabs + theme ---------------- */
document.querySelectorAll('.navbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tabpanel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    const tab = btn.dataset.tab
    $(tab).classList.add('active')
    $('pageTitle').textContent = btn.querySelector('.lbl').textContent
  })
})

// Sidebar drag-to-reorder — lets users rearrange nav buttons top-to-bottom.
// Non-button elements (labels, brand, clock) stay fixed; only .navbtn elements move.
// Order is persisted in settings under 'sidebarOrder'.
;(function initSidebarDrag () {
  const sidebar = document.querySelector('.sidebar')
  let dragging = null
  sidebar.querySelectorAll('.navbtn').forEach(b => { b.draggable = true })

  sidebar.addEventListener('dragstart', e => {
    const btn = e.target.closest('.navbtn'); if (!btn) return
    dragging = btn
    // Defer class add so the browser captures the non-faded element as the drag ghost.
    setTimeout(() => btn.classList.add('dragging'), 0)
  })
  sidebar.addEventListener('dragend', () => {
    if (dragging) dragging.classList.remove('dragging')
    dragging = null
    sidebar.querySelectorAll('.drag-over').forEach(b => b.classList.remove('drag-over'))
  })
  sidebar.addEventListener('dragover', e => {
    e.preventDefault()
    const target = e.target.closest('.navbtn')
    sidebar.querySelectorAll('.drag-over').forEach(b => b.classList.remove('drag-over'))
    if (target && target !== dragging) target.classList.add('drag-over')
  })
  sidebar.addEventListener('drop', e => {
    e.preventDefault()
    const target = e.target.closest('.navbtn')
    if (!target || !dragging || target === dragging) return
    const btns = [...sidebar.querySelectorAll('.navbtn')]
    const di = btns.indexOf(dragging); const ti = btns.indexOf(target)
    if (di < ti) target.after(dragging); else target.before(dragging)
    target.classList.remove('drag-over')
    const order = [...sidebar.querySelectorAll('.navbtn[data-tab]')].map(b => b.dataset.tab)
    api.saveSetting('sidebarOrder', order)
  })
})()

// Sidebar hover tooltips — rendered as a body-level fixed div so they escape the
// sidebar's overflow clipping (CSS overflow-y:auto forces overflow-x:auto per spec,
// which clips absolutely-positioned children).
;(function initSidebarTooltip () {
  const tip = document.createElement('div')
  tip.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:9999',
    'background:var(--panel2)', 'color:var(--text)',
    'border:1px solid var(--border)', 'border-radius:9px',
    'padding:5px 11px', 'font-size:.82rem', 'white-space:nowrap',
    'box-shadow:0 8px 22px -10px #000',
    'opacity:0', 'transition:opacity .12s', 'will-change:opacity'
  ].join(';')
  document.body.appendChild(tip)

  const sidebar = document.querySelector('.sidebar')
  sidebar.addEventListener('mouseover', e => {
    const btn = e.target.closest('.navbtn')
    if (!btn) return
    const lbl = btn.querySelector('.lbl')
    const text = lbl ? lbl.textContent.trim() : ''
    if (!text) return
    // Don't show tooltip when the label is already visible in the sidebar
    if (lbl && getComputedStyle(lbl).display !== 'none') return
    const r = btn.getBoundingClientRect()
    tip.textContent = text
    tip.style.left = (r.right + 8) + 'px'
    tip.style.top = (r.top + r.height / 2) + 'px'
    tip.style.transform = 'translateY(-50%)'
    tip.style.opacity = '1'
  })
  sidebar.addEventListener('mouseleave', () => { tip.style.opacity = '0' })
})()

// Event themes (Halloween/Christmas/Pride/Easter) always take over during their
// window, even on top of a custom/default theme pick — the custom pick just
// resumes automatically once the event window ends.
function easterDate (y) {
  const a = y % 19; const b = Math.floor(y / 100); const c = y % 100
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mo = Math.floor((h + l - 7 * m + 114) / 31); const da = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(y, mo - 1, da)
}
function seasonalTheme (now) {
  const mo = now.getMonth() + 1; const day = now.getDate()
  if (mo === 10 && day >= 24) return { theme: 'halloween', label: '🎃 Halloween', isEvent: true }
  if (mo === 12) return { theme: 'xmas', label: '🎄 Christmas', isEvent: true }
  if (mo === 6) return { theme: 'rainbow', label: '🏳️‍🌈 Pride', isEvent: true }
  const diff = (now - easterDate(now.getFullYear())) / 86400000
  if (diff >= -7 && diff <= 1) return { theme: 'easter', label: '🐰 Easter', isEvent: true }
  return { theme: 'blackgreen', label: '', isEvent: false }
}
function applyTheme (uiTheme) {
  const season = seasonalTheme(new Date())
  if (season.isEvent) {
    document.documentElement.setAttribute('data-theme', season.theme)
    if ($('seasonBadge')) $('seasonBadge').textContent = season.label
    return
  }
  const useAuto = !uiTheme || uiTheme === 'auto'
  document.documentElement.setAttribute('data-theme', useAuto ? season.theme : uiTheme)
  if ($('seasonBadge')) $('seasonBadge').textContent = ''
}
applyTheme('auto')
api.getSetting('uiTheme', 'auto').then(saved => {
  applyTheme(saved)
  if ($('themeSelect')) $('themeSelect').value = saved || 'auto'
})
if ($('themeSelect')) {
  $('themeSelect').addEventListener('change', async e => {
    await api.saveSetting('uiTheme', e.target.value)
    applyTheme(e.target.value)
  })
}
// Re-check at midnight-ish so an event window ending while the app stays open
// (or starting while it's open) recolors without needing a restart.
setInterval(() => { api.getSetting('uiTheme', 'auto').then(applyTheme) }, 30 * 60 * 1000)

/* ---------------- i18n ---------------- */
// Foundation only: covers the sidebar nav labels, common buttons, and the
// newly-added Avatar Scaling / Translator / Live Typing / language-picker
// UI (tagged with data-i18n / data-i18n-ph). Everything else in the app
// stays hardcoded English for now - missing keys fall back to English so
// partial coverage never breaks anything.
let i18nStrings = {}
function t (key, vars) {
  let s = i18nStrings[key] != null ? i18nStrings[key] : key
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{{${k}}}`, v) })
  return s
}
async function applyLanguage (lang) {
  i18nStrings = await api.i18nStrings(lang)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    if (i18nStrings[key] != null) el.textContent = i18nStrings[key]
  })
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph')
    if (i18nStrings[key] != null) el.placeholder = i18nStrings[key]
  })
  document.querySelectorAll('.navbtn[data-tab]').forEach(btn => {
    const key = 'nav.' + btn.dataset.tab
    const lbl = btn.querySelector('.lbl')
    if (lbl && i18nStrings[key] != null) lbl.textContent = i18nStrings[key]
  })
}
async function populateLanguageSelects () {
  const languages = await api.i18nLanguages()
  ;[$('languageSelect'), $('languagePickerSelect')].forEach(sel => {
    if (!sel) return
    sel.innerHTML = ''
    languages.forEach(({ code, name }) => sel.appendChild(new Option(name, code)))
  })
}
async function initLanguage () {
  await populateLanguageSelects()
  const saved = await api.getSetting('uiLanguage', null)
  if (!saved) {
    $('languagePickerSelect').value = 'en'
    $('languagePickerModal').style.display = 'flex'
    return
  }
  $('languageSelect').value = saved
  await applyLanguage(saved)
}
$('languagePickerContinue').addEventListener('click', async () => {
  const lang = $('languagePickerSelect').value
  await api.saveSetting('uiLanguage', lang)
  $('languageSelect').value = lang
  await applyLanguage(lang)
  $('languagePickerModal').style.display = 'none'
})
$('languageSelect').addEventListener('change', async e => {
  await api.saveSetting('uiLanguage', e.target.value)
  await applyLanguage(e.target.value)
})
initLanguage()

/* ---------------- helpers ---------------- */
function setText (id, v) { const el = $(id); if (el) el.textContent = v }
function setPill (id, on, onText, offText) {
  const el = $(id); if (!el) return
  el.textContent = on ? (onText || 'on') : (offText || 'off')
  el.className = 'pill ' + (on ? 'on' : 'off')
}
// Buffered, capped log. VRChat can flood incoming OSC, so we keep only the last
// 200 lines in memory and flush to the textarea at most twice a second, and only
// while the Log tab is visible.
let logBuffer = []
let logDirty = false
function logLine (line) {
  logBuffer.push(`${new Date().toLocaleTimeString()} ${line}`)
  if (logBuffer.length > 200) logBuffer.splice(0, logBuffer.length - 200)
  logDirty = true
}
setInterval(() => {
  if (!logDirty) return
  const t = $('oscLogText')
  if (!t || t.offsetParent === null) { logDirty = false; return }
  t.value = logBuffer.join('\n') + '\n'
  t.scrollTop = t.scrollHeight
  logDirty = false
}, 500)

/* ---------------- OSC log graph ---------------- */
function updateOscGraph () {
  const c = $('oscGraph'); if (!c) return
  if (c.offsetParent === null) return // not visible -> don't draw
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const colors = ['#ef4444', '#22c55e', '#3b82f6', '#a855f7']
  const step = c.width / maxHistory
  oscHistory.forEach((levels, i) => levels.forEach((lv, j) => {
    ctx.fillStyle = colors[j]
    ctx.fillRect(i * step, c.height - lv * c.height, step - 1, lv * c.height)
  }))
}

/* ---------------- audio ---------------- */
let graphFrame = 0
function handleAudioLevels (levels) {
  oscHistory.push([...levels]); if (oscHistory.length > maxHistory) oscHistory.shift()
  // OSC goes out every frame (smooth in VRChat); the graph only redraws ~6fps.
  if ((graphFrame = (graphFrame + 1) % 3) === 0) updateOscGraph()
  const peak = Math.max(...levels)
  const newBeat = peak > 0.65
  if (newBeat !== beatState) { beatState = newBeat; sendBeat(beatState ? 1 : 0) }
  sendOsc(levels)
  // Emerald Sound System: drive rf_ESS/Float from the audio volume when enabled.
  if (essAudioReactive) {
    const vol = levels.reduce((a, b) => a + b, 0) / levels.length
    sendParam('/avatar/parameters/rf_ESS/Float', Math.max(0, Math.min(1, vol)), 'float')
  }
}
let essAudioReactive = false
async function initAudio () {
  const sel = $('audioDeviceSelect')
  const deviceId = sel.value
  if (!deviceId) { alert('Pick an audio input device.'); return }
  await api.saveSetting('selectedAudioDevice', deviceId)
  await setupAudioAnalysis(deviceId, { onLevels: handleAudioLevels, onError: err => alert('Audio failed: ' + err.message) })
  isAnalyzing = true
  $('toggleAudio').textContent = 'Stop Audio'
}
$('toggleAudio').addEventListener('click', () => {
  if (isAnalyzing) { stopAudioAnalysis(); isAnalyzing = false; $('toggleAudio').textContent = 'Start Audio'; return }
  initAudio()
})
;['gain', 'lowBoost', 'bassBoost', 'midBoost', 'trebleBoost'].forEach(name => {
  const slider = $(name + 'Slider')
  if (!slider) return
  slider.addEventListener('input', async e => {
    setText(name + 'Value', e.target.value)
    await api.saveSetting(name, parseFloat(e.target.value))
  })
})
$('audioDeviceSelect').addEventListener('change', e => api.saveSetting('selectedAudioDevice', e.target.value))

/* ---------------- now playing + KAT ---------------- */
let katText = null
let removeKatListener = null
let lastKatText = ''
let katEnabled = false
let chatboxNpEnabled = false
let lastSongKey = ''
const MEDIA_BAR_STYLES = {
  bars: ['█', '░'],
  stars: ['★', '☆'],
  diamonds: ['◆', '◇'],
  dots: ['●', '○'],
  squares: ['■', '□'],
  thin: ['▰', '▱']
}

function buildSong (m) {
  if (!m || !m.found || !m.title) return ''
  if (m.status && m.status !== 'Playing') return ''
  return [m.artist, m.title].filter(Boolean).join(' - ')
}
function formatMediaTime (ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
function mediaProgressBar (pct, styleKey) {
  const pair = MEDIA_BAR_STYLES[styleKey] || MEDIA_BAR_STYLES.bars
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * 10)
  return `[${pair[0].repeat(filled)}${pair[1].repeat(10 - filled)}]`
}
function mediaProgressInfo (m) {
  const durationMs = Math.max(0, Number(m?.durationMs) || 0)
  let progressMs = Math.max(0, Number(m?.progressMs) || 0)
  if (m?.status === 'Playing' && Number(m?.fetchedAt)) progressMs += Math.max(0, Date.now() - Number(m.fetchedAt))
  if (durationMs) progressMs = Math.min(progressMs, durationMs)
  const pct = durationMs ? Math.max(0, Math.min(1, progressMs / durationMs)) : 0
  return {
    progressMs,
    durationMs,
    pct,
    progress: durationMs ? formatMediaTime(progressMs) : '',
    duration: durationMs ? formatMediaTime(durationMs) : '',
    time: durationMs ? `${formatMediaTime(progressMs)}-${formatMediaTime(durationMs)}` : '',
    bar: durationMs ? mediaProgressBar(pct, $('nowPlayingBarStyle')?.value) : ''
  }
}
let npSourcesKey = '' // avoid rebuilding the dropdown every poll
function syncNpSourceDropdown (sessions, preferred) {
  const sel = $('nowPlayingSourceSelect'); if (!sel) return
  const list = (sessions || []).filter(s => s && s.appId)
  const key = list.map(s => s.appId + ':' + s.status).join('|') + '#' + (preferred || '')
  if (key === npSourcesKey) return
  npSourcesKey = key
  const cur = sel.value
  sel.innerHTML = '<option value="">Auto (recommended)</option>' +
    list.map(s => `<option value="${esc(s.appId)}">${esc(s.source || s.appId)}${s.status ? ' · ' + esc(s.status) : ''}</option>`).join('')
  // Keep the user's selection if still present, else reflect the saved preference.
  const want = cur || (preferred ? (list.find(s => s.appId.toLowerCase().includes(preferred)) || {}).appId || '' : '')
  sel.value = [...sel.options].some(o => o.value === want) ? want : ''
}
function renderNowPlaying (m) {
  syncNpSourceDropdown(m && m.sessions, m && m.preferredSource)
  const diag = $('nowPlayingDiag')
  if (!m || !m.found) {
    setText('nowPlayingTitle', 'No media detected'); setText('nowPlayingMeta', 'No active session')
    setText('nowPlayingTime', '--:-- / --:--')
    if ($('nowPlayingProgress')) $('nowPlayingProgress').style.width = '0%'
    if (diag) {
      const n = (m && m.sessions && m.sessions.length) || 0
      diag.textContent = m && m.error
        ? '⚠ ' + m.error
        : (n ? `${n} source(s) seen but nothing playing — press play, or pick a source above.` : 'No media apps registered with Windows. Open Spotify and press play.')
    }
    return
  }
  if (diag) diag.textContent = ''
  setText('nowPlayingTitle', m.title || 'Unknown')
  setText('nowPlayingMeta', [m.artist, m.album, m.status].filter(Boolean).join(' · ') || 'Active')
  setText('nowPlayingSource', m.source || 'Windows')
  const progress = mediaProgressInfo(m)
  setText('nowPlayingTime', progress.time ? `${progress.progress} / ${progress.duration}` : 'No timeline available')
  if ($('nowPlayingProgress')) $('nowPlayingProgress').style.width = `${Math.round(progress.pct * 100)}%`
}
async function initNowPlayingSources () {
  try { const r = await api.nowPlayingSources(); syncNpSourceDropdown(r.sources, r.preferred) } catch (_) {}
}
$('nowPlayingSourceSelect').addEventListener('change', async e => {
  await api.nowPlayingSetSource(e.target.value)
  refreshNowPlaying()
})
$('nowPlayingRefreshSources').addEventListener('click', async () => { npSourcesKey = ''; await initNowPlayingSources(); refreshNowPlaying() })
$('nowPlayingBarStyle').addEventListener('change', async e => {
  await api.saveSetting('nowPlayingBarStyle', e.target.value)
  refreshNowPlaying()
})
function getKatSyncParamsSetting () {
  const mode = $('katSyncParamsMode').value
  if (mode === 'custom') {
    const v = parseInt($('katSyncParamsCustom').value, 10)
    return Number.isFinite(v) ? Math.max(1, Math.min(16, v)) : 4
  }
  return parseInt(mode, 10) || 0
}
function startKat () {
  if (katText) return
  katText = new KatOscText({ oscPort: getSendPort(), extraOscTargets: parseOscTargetsText($('extraOscTargets')?.value || ''), syncParams: getKatSyncParamsSetting() })
  katText.onStatus = msg => setText('katNowPlayingStatus', msg)
  removeKatListener = addOscListener((a, args) => katText.handleOscInput(a, args), getRecvPort())
  katText.start(); katText.setText(lastKatText)
}
function stopKat () {
  if (removeKatListener) { removeKatListener(); removeKatListener = null }
  if (katText) { katText.close(); katText = null }
  setText('katNowPlayingStatus', 'KAT output is off')
}
$('enableKatNowPlaying').addEventListener('change', async e => {
  katEnabled = e.target.checked
  await api.saveSetting('katNowPlayingEnabled', katEnabled)
  katEnabled ? startKat() : stopKat()
})
$('katSyncParamsMode').addEventListener('change', async e => {
  $('katSyncParamsCustom').style.display = e.target.value === 'custom' ? '' : 'none'
  const value = getKatSyncParamsSetting()
  await api.saveSetting('katSyncParams', value)
  if (katText) katText.setSyncParams(value)
})
$('katSyncParamsCustom').addEventListener('change', async e => {
  if ($('katSyncParamsMode').value !== 'custom') return
  const value = getKatSyncParamsSetting()
  await api.saveSetting('katSyncParams', value)
  if (katText) katText.setSyncParams(value)
})
/* ---------------- avatar scaling ---------------- */
let avatarScaling = null
let removeAvatarScalingListener = null
const avatarScalingHotkeys = { keyUp: null, keyDown: null }
const AVATAR_SCALE_MIN = 0.01
const AVATAR_SCALE_MAX = 10000
const AVATAR_SCALE_LOG_MIN = Math.log10(AVATAR_SCALE_MIN)
const AVATAR_SCALE_LOG_MAX = Math.log10(AVATAR_SCALE_MAX)

function clampAvatarScale (value) {
  if (!Number.isFinite(value)) return 1
  return Math.max(AVATAR_SCALE_MIN, Math.min(AVATAR_SCALE_MAX, value))
}

function avatarScaleToSlider (scale) {
  const safeScale = clampAvatarScale(scale)
  return (Math.log10(safeScale) - AVATAR_SCALE_LOG_MIN) / (AVATAR_SCALE_LOG_MAX - AVATAR_SCALE_LOG_MIN)
}

function avatarSliderToScale (sliderValue) {
  const t = Math.max(0, Math.min(1, Number(sliderValue)))
  return 10 ** (AVATAR_SCALE_LOG_MIN + t * (AVATAR_SCALE_LOG_MAX - AVATAR_SCALE_LOG_MIN))
}

function formatAvatarScale (scale) {
  return clampAvatarScale(scale).toFixed(2)
}

function ensureAvatarScaling () {
  if (avatarScaling) return avatarScaling
  avatarScaling = new AvatarScalingController({
    oscPort: getSendPort(),
    extraOscTargets: parseOscTargetsText($('extraOscTargets')?.value || ''),
    scale: clampAvatarScale(parseFloat($('avatarScalingValue').value)),
    useSafety: $('avatarScalingSafety').checked,
    saveScaleBetweenWorlds: $('avatarScalingSaveWorlds').checked,
    smoothing: parseInt($('avatarScalingSmoothing').value, 10) || 50
  })
  avatarScaling.onStatus = renderAvatarScalingState
  removeAvatarScalingListener = addOscListener((a, args) => avatarScaling.handleOscInput(a, args), getRecvPort())
  return avatarScaling
}

let avatarScalingSaveTimer = null
function renderAvatarScalingState (s) {
  $('avatarScalingSlider').value = avatarScaleToSlider(s.scale)
  $('avatarScalingValue').value = formatAvatarScale(s.scale)
  setText('avatarScalingOut', s.connected ? `Avatar scaling on — ${formatAvatarScale(s.scale)}m` : 'Avatar scaling is off')
  // Debounced: this fires on every slider-drag tick and every 50ms while a
  // hold-to-scale hotkey is held, so save at most twice a second rather
  // than hammering electron-store on every single tick.
  clearTimeout(avatarScalingSaveTimer)
  avatarScalingSaveTimer = setTimeout(() => api.saveSetting('avatarScalingScale', s.scale), 500)
}

async function startAvatarScaling () {
  ensureAvatarScaling().start()
  await api.avatarScalingSetHotkeys(avatarScalingHotkeys)
}

async function stopAvatarScaling () {
  if (avatarScaling) avatarScaling.stop()
  await api.avatarScalingClearHotkeys()
}

api.on('avatarScaling:scaleTick', ({ dir }) => { if (avatarScaling) avatarScaling.applyScaleDelta(dir) })

$('avatarScalingEnable').addEventListener('change', async e => {
  await api.saveSetting('avatarScalingEnabled', e.target.checked)
  if (e.target.checked) startAvatarScaling(); else stopAvatarScaling()
})
$('avatarScalingSlider').addEventListener('input', e => {
  const v = avatarSliderToScale(e.target.value)
  $('avatarScalingValue').value = formatAvatarScale(v)
  ensureAvatarScaling().setScale(v)
})
$('avatarScalingValue').addEventListener('change', e => {
  const v = clampAvatarScale(parseFloat(e.target.value))
  if (!Number.isFinite(v)) return
  e.target.value = formatAvatarScale(v)
  ensureAvatarScaling().setScale(v)
})
$('avatarScalingSafety').addEventListener('change', async e => {
  ensureAvatarScaling().setUseSafety(e.target.checked)
  await api.saveSetting('avatarScalingSafety', e.target.checked)
})
$('avatarScalingSaveWorlds').addEventListener('change', async e => {
  ensureAvatarScaling().setSaveScaleBetweenWorlds(e.target.checked)
  await api.saveSetting('avatarScalingSaveWorlds', e.target.checked)
})
$('avatarScalingSmoothing').addEventListener('input', async e => {
  const v = parseInt(e.target.value, 10)
  setText('avatarScalingSmoothingVal', v)
  ensureAvatarScaling().setSmoothing(v)
  await api.saveSetting('avatarScalingSmoothing', v)
})

async function recordAvatarScalingKey (slot) {
  const btn = slot === 'up' ? $('avatarScalingRecordUp') : $('avatarScalingRecordDown')
  const label = slot === 'up' ? $('avatarScalingKeyUp') : $('avatarScalingKeyDown')
  btn.disabled = true
  setText('avatarScalingOut', `Press a key for scale-${slot}...`)
  const result = await api.avatarScalingRecordKey()
  btn.disabled = false
  if (!result) { setText('avatarScalingOut', 'No key captured (timed out) — you can still use the slider'); return }
  if (result.error) { setText('avatarScalingOut', result.error); return }
  avatarScalingHotkeys[slot === 'up' ? 'keyUp' : 'keyDown'] = result.vk
  label.textContent = result.name
  await api.saveSetting('avatarScalingHotkeys', avatarScalingHotkeys)
  if ($('avatarScalingEnable').checked) await api.avatarScalingSetHotkeys(avatarScalingHotkeys)
  setText('avatarScalingOut', `Scale-${slot} key set to ${result.name}`)
}
$('avatarScalingRecordUp').addEventListener('click', () => recordAvatarScalingKey('up'))
$('avatarScalingRecordDown').addEventListener('click', () => recordAvatarScalingKey('down'))

$('enableChatboxNowPlaying').addEventListener('change', async e => {
  chatboxNpEnabled = e.target.checked
  await api.saveSetting('chatboxNowPlayingEnabled', chatboxNpEnabled)
  setText('chatboxNowPlayingStatus', chatboxNpEnabled ? 'Chatbox output is on' : 'Chatbox output is off')
})

let discordConnected = false
function nowPlayingNeeded () {
  // Only spawn the PowerShell media query when something actually consumes it.
  return katEnabled || chatboxNpEnabled ||
    composer.modes.nowPlaying !== 'off' ||
    (composer.modes.status !== 'off' && /\{(song|artist|title|songsource|songtime|songprogress|songduration|songbar)\}/.test($('presetsText').value)) ||
    (discordConnected && $('discordShowNp') && $('discordShowNp').checked) ||
    ($('nowplaying') && $('nowplaying').offsetParent !== null) ||
    ($('spotiOscEnable') && $('spotiOscEnable').checked)
}
async function refreshNowPlaying () {
  if (!nowPlayingNeeded()) return
  try {
    const m = await api.getNowPlaying()
    renderNowPlaying(m)
    publishSpotiState(m)
    const song = buildSong(m)
    const progress = mediaProgressInfo(m)
    composer.update({
      song: song || 'Not playing',
      artist: (m && m.found && m.artist) ? m.artist : '',
      title: (m && m.found && m.title) ? m.title : '',
      songSource: (m && m.found && m.source) ? m.source : '',
      songTime: (m && m.found) ? progress.time : '',
      songProgress: (m && m.found) ? progress.progress : '',
      songDuration: (m && m.found) ? progress.duration : '',
      songBar: (m && m.found) ? progress.bar : ''
    })
    lastKatText = song
    if (katText) katText.setText(song)
    if (chatboxNpEnabled && song) {
      const key = song
      if (key !== lastSongKey) { lastSongKey = key; sendChatboxMessage(`Now Playing: ${song}`, false); setText('chatboxNowPlayingStatus', 'Posted current song') }
    }
    // Feed the Discord presence (it shows 🎵 song when no world line is up).
    if (discordConnected) api.discordLive({ nowPlaying: (m && m.found && song) ? song : '' })
  } catch (err) { renderNowPlaying({ found: false }) }
}
// Now Playing spawns a PowerShell query, so poll gently (every 10s). It still
// runs while minimised so the chatbox stays current in VR.
setInterval(refreshNowPlaying, 10000)

/* ---------------- OSC settings ---------------- */
function getSendPort () { const p = parseInt($('portInput').value, 10); return Number.isFinite(p) ? p : 9000 }
function getRecvPort () { const p = parseInt($('receiverPortInput').value, 10); return Number.isFinite(p) ? p : 9001 }
function parseOscTargetsText (text) {
  return String(text || '')
    .split(/\r?\n|,/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(?:(.+):)?(\d+)$/)
      if (!match) return null
      const port = parseInt(match[2], 10)
      if (!Number.isFinite(port) || port < 1 || port > 65535) return null
      return { host: (match[1] || '127.0.0.1').trim() || '127.0.0.1', port }
    })
    .filter(Boolean)
}

function oscTargetsToText (targets) {
  return (Array.isArray(targets) ? targets : [])
    .map(t => `${t.host || '127.0.0.1'}:${t.port}`)
    .join('\n')
}

function parseOscPortsText (text) {
  return String(text || '')
    .split(/\r?\n|,/)
    .map(line => parseInt(line.trim(), 10))
    .filter(port => Number.isFinite(port) && port > 0 && port <= 65535)
    .filter((port, index, list) => list.indexOf(port) === index)
}

function oscPortsToText (ports) {
  return (Array.isArray(ports) ? ports : []).join('\n')
}

async function applyExtraOscTargets (targets) {
  setExtraOscTargets(targets)
  if (katText && typeof katText.setExtraOscTargets === 'function') katText.setExtraOscTargets(targets)
  if (avatarScaling && typeof avatarScaling.setExtraOscTargets === 'function') avatarScaling.setExtraOscTargets(targets)
  if (api.updateOscTargets) api.updateOscTargets(targets)
}

$('portInput').addEventListener('change', async e => {
  const p = parseInt(e.target.value, 10)
  if (!isNaN(p)) { setOscPort(p); if (katText) katText.setOscPort(p); await api.saveSetting('oscPort', p); api.updateOscPort(p) }
})
$('extraOscTargets').addEventListener('change', async e => {
  const targets = parseOscTargetsText(e.target.value)
  e.target.value = oscTargetsToText(targets)
  await applyExtraOscTargets(targets)
  await api.saveSetting('extraOscTargets', targets)
  setText('extraOscTargetsOut', targets.length ? `Mirroring OSC to ${targets.length} extra target(s).` : 'Only the primary OSC send port is used.')
})
$('extraOscReceivers').addEventListener('change', async e => {
  const ports = parseOscPortsText(e.target.value).filter(port => port !== getRecvPort())
  e.target.value = oscPortsToText(ports)
  setExtraOscReceiverPorts(ports)
  await api.saveSetting('extraOscReceivers', ports)
  setText('extraOscReceiversOut', ports.length ? `Listening on ${ports.length} extra receive port(s).` : 'Only the primary receive port is used.')
})
$('receiverPortInput').addEventListener('change', async e => {
  const p = parseInt(e.target.value, 10)
  if (!isNaN(p)) {
    setOscReceiverPort(p)
    const ports = parseOscPortsText($('extraOscReceivers').value).filter(port => port !== p)
    $('extraOscReceivers').value = oscPortsToText(ports)
    setExtraOscReceiverPorts(ports)
    await api.saveSetting('extraOscReceivers', ports)
    await api.saveSetting('receiverPort', p)
  }
})
$('enableReceive').addEventListener('change', async e => {
  await api.saveSetting('receiveEnabled', e.target.checked)
  e.target.checked ? startOscReceiver(getRecvPort(), (a, args) => logLine(`IN  ${a} ${args.join(',')}`)) : stopOscReceiver()
})
$('clearLog').addEventListener('click', () => { logBuffer = []; logDirty = true; $('oscLogText').value = ''; oscHistory = []; updateOscGraph() })

/* ---------------- chatbox composer ---------------- */
// Manual message history (newest first). Persisted so reposts survive restarts.
let chatHistory = []
let chatHistPage = 0
const CHAT_HIST_PAGE_SIZE = 8
const CHAT_HIST_MAX = 100

function postChatMessage (v) {
  composer.sendNow(v)
  logLine(`OUT chatbox: ${v}`)
  // De-dupe an identical most-recent entry so reposting doesn't pile up copies.
  if (!(chatHistory[0] && chatHistory[0].text === v)) {
    chatHistory.unshift({ text: v, ts: Date.now() })
    if (chatHistory.length > CHAT_HIST_MAX) chatHistory.length = CHAT_HIST_MAX
    api.saveSetting('chatHistory', chatHistory)
  }
  chatHistPage = 0
  renderChatHistory()
  updateHoldStatus()
}

$('chatSend').addEventListener('click', () => {
  const v = $('chatInput').value.trim()
  if (v) { postChatMessage(v); $('chatInput').value = '' }
})
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('chatSend').click() })

function renderChatHistory () {
  const list = $('chatHistoryList'); const pager = $('chatHistoryPager')
  if (!list) return
  if (!chatHistory.length) {
    list.innerHTML = '<div class="muted">No messages yet.</div>'
    if (pager) pager.style.display = 'none'
    return
  }
  const pages = Math.ceil(chatHistory.length / CHAT_HIST_PAGE_SIZE)
  if (chatHistPage >= pages) chatHistPage = pages - 1
  const start = chatHistPage * CHAT_HIST_PAGE_SIZE
  const slice = chatHistory.slice(start, start + CHAT_HIST_PAGE_SIZE)
  list.innerHTML = ''
  slice.forEach((entry, i) => {
    const idx = start + i
    const row = document.createElement('div')
    row.className = 'switch'; row.style.alignItems = 'center'; row.style.gap = '8px'
    const when = new Date(entry.ts).toLocaleString()
    const text = document.createElement('span')
    text.style.flex = '1'; text.style.overflow = 'hidden'; text.style.textOverflow = 'ellipsis'; text.style.whiteSpace = 'nowrap'
    text.title = `${entry.text}\n${when}`
    text.textContent = entry.text
    const repost = document.createElement('button')
    repost.className = 'btn'; repost.textContent = '↻ Repost'
    repost.addEventListener('click', () => postChatMessage(entry.text))
    const del = document.createElement('button')
    del.className = 'btn ghost'; del.textContent = '✕'; del.title = 'Remove'
    del.addEventListener('click', () => {
      chatHistory.splice(idx, 1); api.saveSetting('chatHistory', chatHistory); renderChatHistory()
    })
    row.appendChild(text); row.appendChild(repost); row.appendChild(del)
    list.appendChild(row)
  })
  if (pager) {
    pager.style.display = pages > 1 ? 'flex' : 'none'
    setText('chatHistPageInfo', `Page ${chatHistPage + 1} / ${pages} · ${chatHistory.length} messages`)
    $('chatHistPrev').disabled = chatHistPage === 0
    $('chatHistNext').disabled = chatHistPage >= pages - 1
  }
}

$('chatHistPrev').addEventListener('click', () => { if (chatHistPage > 0) { chatHistPage--; renderChatHistory() } })
$('chatHistNext').addEventListener('click', () => { chatHistPage++; renderChatHistory() })
$('chatHistClear').addEventListener('click', () => {
  chatHistory = []; chatHistPage = 0; api.saveSetting('chatHistory', chatHistory); renderChatHistory()
})

// Live countdown of the manual-message pin; returns to automated when it ends.
function updateHoldStatus () {
  const el = $('chatHoldStatus'); if (!el) return
  if (composer.holdActive()) {
    const s = composer.holdRemaining()
    const mm = Math.floor(s / 60); const ss = String(s % 60).padStart(2, '0')
    el.textContent = `📌 Pinned: "${composer.holdText}" — ${mm}:${ss} until automated status resumes.`
  } else {
    el.textContent = 'Sent messages stay pinned for 1m 30s, then the chatbox returns to automated status.'
  }
}
setInterval(updateHoldStatus, 1000)

$('aiRun').addEventListener('click', async () => {
  const text = $('chatInput').value.trim()
  if (!text) return
  setText('aiStatus', 'Thinking...')
  try {
    const out = await api.aiRewrite({
      baseUrl: $('aiBaseUrl').value,
      apiKey: $('aiKey').value,
      model: $('aiModel').value,
      mode: $('aiMode').value, text
    })
    $('chatInput').value = out; setText('aiStatus', 'Done')
  } catch (err) { setText('aiStatus', err.message) }
})

/* ---------------- live typing ---------------- */
const liveTyping = new LiveTypingSender({
  composer,
  translate: text => ($('liveTypingTranslate').checked ? translateWithSettings(text) : text)
})
liveTyping.onPreview = trimmed => setText('liveTypingPreview', trimmed)
$('liveTypingInput').addEventListener('input', e => {
  const v = e.target.value
  setText('liveTypingCount', `${v.length} chars${v.length > 144 ? ' (over 144 — VRChat will show the end, prefixed with "…")' : ''}`)
  liveTyping.setText(v)
})
$('liveTypingClear').addEventListener('click', () => {
  $('liveTypingInput').value = ''
  setText('liveTypingCount', '0 chars')
  liveTyping.setText('')
})
$('liveTypingTranslate').addEventListener('change', async e => {
  await api.saveSetting('liveTypingTranslate', e.target.checked)
})

// Build the per-source mode grid (Off / Own line / Rotate).
const SOURCES = [
  ['status', 'Status presets'], ['clock', 'Clock'], ['nowPlaying', 'Now playing'],
  ['world', 'World / instance'], ['stats', 'Component stats'], ['network', 'Network'],
  ['heartRate', 'Heart rate'], ['weather', 'Weather'], ['window', 'Window activity'], ['discord', 'Discord voice'],
  ['ton', 'Terrors of Nowhere'],
  ['tiktok', 'TikTok followers'], ['twitch', 'Twitch followers'], ['kick', 'Kick followers']
]
function buildModeGrid (savedModes) {
  const grid = $('modeGrid')
  grid.innerHTML = ''
  SOURCES.forEach(([key, label]) => {
    const mode = (savedModes && savedModes[key]) || composer.modes[key] || 'off'
    composer.setMode(key, mode)
    const wrap = document.createElement('div'); wrap.className = 'switch'
    wrap.innerHTML = `<span style="flex:1">${label}</span>`
    const sel = document.createElement('select'); sel.style.width = '120px'
    ;[['off', 'Off'], ['line', 'Own line'], ['rotate', 'Rotate']].forEach(([v, t]) => {
      const o = document.createElement('option'); o.value = v; o.text = t; if (v === mode) o.selected = true; sel.appendChild(o)
    })
    sel.addEventListener('change', async () => {
      composer.setMode(key, sel.value)
      await api.saveSetting('chatModes', currentModes())
      updatePreview()
    })
    sel.dataset.key = key
    wrap.appendChild(sel); grid.appendChild(wrap)
  })
}
function currentModes () {
  const m = {}
  $('modeGrid').querySelectorAll('select').forEach(s => { m[s.dataset.key] = s.value })
  return m
}
// Non-mutating preview of the multi-line chatbox.
function updatePreview () {
  composer.setPresets($('presetsText').value.split('\n'))
  const fixed = composer.fixedLines()
  const rot = composer.rotationItems()
  let lines = []
  const rotLine = rot[0] || ''
  if (rotLine && composer.rotationPosition === 'top') lines.push(rotLine + (rot.length > 1 ? '  ⟳' : ''))
  lines = lines.concat(fixed)
  if (rotLine && composer.rotationPosition === 'bottom') lines.push(rotLine + (rot.length > 1 ? '  ⟳' : ''))
  $('chatPreview').textContent = lines.join('\n') || '(nothing enabled)'
}

$('rotationPos').addEventListener('change', async e => {
  composer.setRotationPosition(e.target.value)
  await api.saveSetting('rotationPos', e.target.value); updatePreview()
})
$('rotateInterval').addEventListener('change', e => api.saveSetting('rotateInterval', parseInt(e.target.value, 10) || 4000))

let composerRunning = false
$('composerToggle').addEventListener('click', () => {
  composerRunning = !composerRunning
  if (composerRunning) {
    composer.setPresets($('presetsText').value.split('\n'))
    composer.start(parseInt($('rotateInterval').value, 10))
    $('composerToggle').textContent = 'Stop'; setPill('composerState', true, 'live')
  } else {
    composer.stop(); $('composerToggle').textContent = 'Start'; setPill('composerState', false)
  }
})
$('savePresets').addEventListener('click', async () => {
  await api.saveSetting('presets', $('presetsText').value)
  composer.setPresets($('presetsText').value.split('\n')); updatePreview()
})
// Auto-save status presets (debounced) so they persist without pressing Save.
let presetSaveTimer = null
$('presetsText').addEventListener('input', () => {
  composer.setPresets($('presetsText').value.split('\n'))
  if ($('chatPreview').offsetParent !== null) updatePreview()
  clearTimeout(presetSaveTimer)
  presetSaveTimer = setTimeout(() => api.saveSetting('presets', $('presetsText').value), 800)
})
// Refresh the preview only while the Chatbox tab is actually visible.
setInterval(() => {
  if (!composerRunning && $('chatPreview') && $('chatPreview').offsetParent !== null) updatePreview()
}, 2500)

/* ---------------- live: TikTok / Twitch / Kick ---------------- */
api.on('tiktok:update', s => {
  setPill('tiktokState', s.connected, 'live', s.error ? 'error' : 'offline')
  setText('tiktokFollowers', (s.followers || 0).toLocaleString())
  setText('tiktokMeta', `${s.viewers || 0} viewers · +${s.newFollows || 0} new${s.error ? ' · ' + s.error : ''}`)
  composer.update({
    tiktokFollowers: s.followers || 0, tiktokViewers: s.viewers || 0,
    tiktokLikes: s.likes || 0, tiktokNew: s.newFollows || 0, tiktokLive: !!s.connected
  })
})
$('tiktokConnect').addEventListener('click', async () => {
  await api.saveSetting('tiktokUser', $('tiktokUser').value)
  await api.saveSetting('tiktokSignKey', $('tiktokSignKey').value)
  api.tiktokConnect($('tiktokUser').value, $('tiktokSignKey').value)
})
$('tiktokDisconnect').addEventListener('click', () => api.tiktokDisconnect())

// Follower count without being live (reads the public profile).
api.on('tiktok:followers', s => {
  setText('tiktokFollowers', (s.followers || 0).toLocaleString())
  setText('tiktokMeta', s.connected ? `followers · ${(s.likes || 0).toLocaleString()} likes · ${s.videos || 0} videos` : (s.error || 'followers'))
  if (s.followers) {
    setPill('tiktokState', true, 'tracking')
    composer.update({ tiktokFollowers: s.followers, tiktokLikes: s.likes || 0, tiktokVideos: s.videos || 0 })
  }
})
$('tiktokFollowersStart').addEventListener('click', async () => {
  await api.saveSetting('tiktokUser', $('tiktokUser').value)
  api.tiktokFollowersStart($('tiktokUser').value)
})
$('tiktokFollowersStop').addEventListener('click', () => api.tiktokFollowersStop())

api.on('twitch:update', s => {
  setPill('twitchState', s.connected, 'on', s.error ? 'error' : 'offline')
  setText('twitchFollowers', (s.followers || 0).toLocaleString())
  composer.update({ twitchFollowers: s.followers || 0, twitchViewers: s.viewers || 0, twitchLive: !!s.connected })
  // the module may have auto-refreshed the access token; persist the new pair.
  if (s.token && (s.token !== $('twitchToken').value || s.refreshToken !== twitchRefreshToken)) {
    $('twitchToken').value = s.token
    twitchRefreshToken = s.refreshToken || twitchRefreshToken
    setTwitchTokenState()
    api.saveSetting('oauth.twitch', currentTwitchCfg())
  }
})
function setTwitchTokenState () {
  const has = !!$('twitchToken').value
  const login = $('twitchLogin').value.trim()
  const summary = has
    ? `Authorized${login ? ` as/for ${login}` : ''} · shared by Live and Twitch Interactive`
    : (login ? `${login} · application saved, login required` : 'Not configured')
  setPill('twitchTokenState', has, 'token ✓', 'no token')
  setText('oauthTwitchAccount', summary)
  setText('twitchLiveAccount', summary)
}
let twitchRefreshToken = ''
$('twitchLogin2').addEventListener('click', async () => {
  const clientId = $('twitchClientId').value.trim()
  const clientSecret = $('twitchClientSecret').value.trim() // optional: blank = implicit (no refresh)
  if (!clientId) { alert('Enter your Twitch Client ID first.'); return }
  await api.saveSetting('oauth.twitch', currentTwitchCfg())
  setText('twitchTokenState', 'logging in...')
  const r = await api.oauthTwitchLogin(clientId, clientSecret, 'moderator:read:followers chat:read channel:read:redemptions')
  if (r.ok) {
    $('twitchToken').value = r.accessToken
    twitchRefreshToken = r.refreshToken || ''
    await api.saveSetting('oauth.twitch', currentTwitchCfg())
    setTwitchTokenState()
  } else {
    setText('twitchTokenState', 'login failed')
    alert('Twitch login failed: ' + r.error)
  }
})
function currentTwitchCfg () {
  return {
    login: $('twitchLogin').value,
    clientId: $('twitchClientId').value,
    clientSecret: $('twitchClientSecret').value,
    token: $('twitchToken').value,
    refreshToken: twitchRefreshToken
  }
}
$('twitchConnect').addEventListener('click', async () => {
  const cfg = currentTwitchCfg()
  if (!cfg.token) { alert('Authorize Twitch in OAuth Accounts first.'); return }
  await api.saveSetting('oauth.twitch', cfg); api.twitchStart(cfg)
})
$('twitchDisconnect').addEventListener('click', () => api.twitchStop())
$('twitchOpenOAuth').addEventListener('click', () => document.querySelector('[data-tab="oauth"]').click())
$('twitchOAuthSave').addEventListener('click', async () => {
  await api.saveSetting('oauth.twitch', currentTwitchCfg())
  setTwitchTokenState()
})
$('twitchOAuthForget').addEventListener('click', async () => {
  $('twitchToken').value = ''
  twitchRefreshToken = ''
  await api.saveSetting('oauth.twitch', currentTwitchCfg())
  api.twitchStop()
  api.oscAppsTwitchInteractiveStop()
  setTwitchTokenState()
})
;['twitchLogin', 'twitchClientId', 'twitchClientSecret'].forEach(id => $(id).addEventListener('change', setTwitchTokenState))

api.on('kick:update', s => {
  setPill('kickState', s.connected, s.live ? 'live' : 'on', s.error ? 'error' : 'offline')
  setText('kickFollowers', (s.followers || 0).toLocaleString())
  composer.update({ kickFollowers: s.followers || 0, kickViewers: s.viewers || 0, kickLive: !!s.live })
})
$('kickConnect').addEventListener('click', async () => { await api.saveSetting('kickSlug', $('kickSlug').value); api.kickStart($('kickSlug').value) })
$('kickDisconnect').addEventListener('click', () => api.kickStop())

/* ---------------- stats / network / hr / window / vr ---------------- */
api.on('stats:update', s => {
  setText('statsOut', `CPU ${s.cpuLoad}% ${s.cpuTemp ? s.cpuTemp + '°C ' : ''}| GPU ${s.gpuLoad}% ${s.gpuTemp ? s.gpuTemp + '°C ' : ''}| RAM ${s.ramUsedGb}/${s.ramTotalGb}GB (${s.ramPct}%)`)
  composer.update({
    cpu: s.cpuLoad, cpuTemp: s.cpuTemp, gpu: s.gpuLoad, gpuTemp: s.gpuTemp,
    ramPct: s.ramPct, ramUsed: s.ramUsedGb, ramTotal: s.ramTotalGb
  })
})
$('enableStats').addEventListener('change', e => {
  setPill('statsState', e.target.checked, 'on'); e.target.checked ? api.statsStart(5000) : api.statsStop()
  api.saveSetting('statsEnabled', e.target.checked)
})
api.on('net:update', s => {
  setText('netOut', `↓ ${s.downMbps} Mbps · ↑ ${s.upMbps} Mbps${s.pingMs ? ' · ' + s.pingMs + 'ms' : ''} (${s.iface})`)
  composer.update({ down: s.downMbps, up: s.upMbps, ping: s.pingMs })
})
$('enableNet').addEventListener('change', e => { setPill('netState', e.target.checked, 'on'); e.target.checked ? api.netStart({ intervalMs: 5000 }) : api.netStop(); api.saveSetting('netEnabled', e.target.checked) })

api.on('hr:update', s => {
  setPill('hrState', s.online, 'live'); setText('hrOut', s.bpm || '—')
  setText('hrSub', s.online ? `bpm · avg ${s.avg || 0} · max ${s.max || 0} · min ${s.min || 0}` : 'bpm')
  composer.update({ hr: s.bpm, hrOnline: s.online, hrAvg: s.avg, hrMax: s.max, hrMin: s.min })
})
function hrCfg () {
  return {
    provider: $('hrProvider').value,
    token: $('pulsoidToken').value,
    apiKey: $('hyperateKey').value,
    deviceId: $('hyperateDevice').value,
    bridgePort: Number($('hrBridgePort').value) || 7392,
    relayToPulsoid: $('hrRelayPulsoid').checked,
    relayToken: $('hrRelayToken').value,
    oscProfiles: {
      vrcosc: $('hrOscVrcosc').checked,
      bekoLegacy: $('hrOscBekoLegacy').checked,
      heartEchoes: $('hrOscHeartEchoes').checked,
      akaryu: $('hrOscAkaryu').checked,
      akaryuMaxBpm: Math.max(40, Math.min(255, Number($('hrOscAkaryuMax').value) || 200))
    }
  }
}
function syncHrFields () {
  const hy = $('hrProvider').value === 'hyperate'
  const device = $('hrProvider').value === 'device'
  $('hrHyperateFields').style.display = hy ? '' : 'none'
  $('hrPulsoidFields').style.display = (!hy && !device) ? '' : 'none'
  $('hrDeviceFields').style.display = device ? '' : 'none'
  $('hrRelayFields').style.display = $('hrRelayPulsoid').checked ? '' : 'none'
}
$('hrProvider').addEventListener('change', () => { syncHrFields(); api.saveSetting('hrProvider', $('hrProvider').value) })
$('hrPulsoidAuthorize').addEventListener('click', async () => {
  const button = $('hrPulsoidAuthorize')
  button.disabled = true
  $('hrPulsoidAuthHint').textContent = 'Waiting for approval in Pulsoid...'
  try {
    const result = await api.hrPulsoidAuthorize()
    $('pulsoidToken').value = result.accessToken
    await api.saveSetting('pulsoidToken', result.accessToken)
    $('hrPulsoidAuthHint').textContent = 'Pulsoid read token authorized and saved.'
  } catch (err) {
    $('hrPulsoidAuthHint').textContent = `Pulsoid authorization failed: ${err.message}`
  } finally {
    button.disabled = false
  }
})
$('hrRelayPulsoid').addEventListener('change', syncHrFields)
$('hrPulsoidKeys').addEventListener('click', () => api.hrPulsoidKeys())
$('hrBridgePort').addEventListener('input', () => { $('hrBridgeEndpoint').textContent = `http://127.0.0.1:${Number($('hrBridgePort').value) || 7392}/heart-rate` })
;['hrOscVrcosc', 'hrOscBekoLegacy', 'hrOscHeartEchoes', 'hrOscAkaryu', 'hrOscAkaryuMax'].forEach(id => $(id).addEventListener('change', () => {
  api.saveSetting('hrOscProfiles', hrCfg().oscProfiles)
}))

const bleBrowserDevices = new Map()
const bleCachedDevices = new Map()
let bleScanPromise = null
let bleConnectedDevice = null
let bleHeartRateCharacteristic = null
let bleWriteCharacteristic = null
let bleMeasurementListener = null
let bleProtocol = ''
let bleRetriggerTimer = null
let bleWatchdogTimer = null
let bleReconnectTimer = null
let bleReconnectAttempts = 0
let bleLastDevice = null
let bleManualDisconnect = false
let bleConnectInProgress = false
let bleLastBpmLogAt = 0
let bleLastRawLogAt = 0
let bleLastReadingAt = 0
let bleLastBpmAt = 0
let bleLastFrameAt = 0
let bleLastSensorStatusAt = 0
let bleNoBpmWarningLogged = false
let bleGmansConnectedAt = 0
let bleGmansZeroFrames = 0
let bleGmansHandshakeAttempted = false
let bleGmansWakeTimer = null
let bleGmansCommandSequence = 2
let deviceProviderRunning = false
const relayBleMeasurement = createBleHeartRateRelay(({ bpm, platformId }) => submitBleBpm(bpm, platformId))

function setBleStatus (message) { setText('hrBleStatus', message) }
function bleLog (eventName, details = {}) { api.hrBleDebug(eventName, details).catch(() => {}) }
function bleWait (ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

function addBleDeviceOption (device, source) {
  if (!device || !device.id) return
  const select = $('hrBleDevices')
  let option = Array.from(select.options).find(item => item.value === device.id)
  if (!option) {
    if (select.options.length === 1 && !select.options[0].value) select.innerHTML = ''
    option = document.createElement('option')
    option.value = device.id
    select.appendChild(option)
  }
  const sourceLabel = source === 'remembered' ? 'remembered' : source === 'cached' ? 'AppData cache' : 'nearby'
  option.textContent = `${device.name || 'Unnamed BLE device'} (${sourceLabel})`
  option.dataset.source = source
}

api.on('hr:bleDevices', devices => {
  for (const device of devices || []) addBleDeviceOption(device, 'nearby')
  bleLog('scan-results', { count: (devices || []).length, devices: (devices || []).map(device => ({ id: device.id, name: device.name })) })
  setBleStatus(`${(devices || []).length} nearby BLE device(s) found. Select one and press Connect.`)
})

api.on('hr:blePairing', async details => {
  const name = details.deviceName || bleConnectedDevice?.name || details.deviceId || 'this device'
  let response = { confirmed: false }
  if (details.pairingKind === 'confirm') {
    response.confirmed = window.confirm(`Pair with ${name}?`)
  } else if (details.pairingKind === 'confirmPin') {
    response.confirmed = window.confirm(`Does PIN ${details.pin} match the PIN shown by ${name}?`)
  } else if (details.pairingKind === 'providePin') {
    const pin = window.prompt(`Enter the pairing PIN for ${name}:`, '')
    response = { confirmed: pin !== null && pin !== '', pin: pin || null }
  }
  await api.hrBlePairingResponse(response)
})

async function refreshBleRememberedDevices () {
  if (!navigator.bluetooth || typeof navigator.bluetooth.getDevices !== 'function') {
    setBleStatus('Bluetooth device access is unavailable in this Electron build.')
    return
  }
  try {
    const cachedResult = await api.hrBleCached()
    const cached = Array.isArray(cachedResult) ? cachedResult : []
    for (const device of cached) {
      bleCachedDevices.set(device.id, device)
      addBleDeviceOption(device, 'cached')
    }
    const devices = await navigator.bluetooth.getDevices()
    for (const device of devices) {
      bleBrowserDevices.set(device.id, device)
      addBleDeviceOption(device, 'remembered')
    }
    setBleStatus(devices.length
      ? `${devices.length} remembered device(s) loaded. Devices still need to be powered on and in range to connect.`
      : cached.length
        ? `${cached.length} cached device(s) loaded from AppData. Select one and press Connect to reacquire it.`
        : 'No remembered BLE devices. Use Scan nearby to grant access to one.')
    const saved = await api.getSetting('hrBleDevice', {})
    if (saved.id && Array.from($('hrBleDevices').options).some(option => option.value === saved.id)) $('hrBleDevices').value = saved.id
    const remembered = saved.id ? bleBrowserDevices.get(saved.id) : null
    if (remembered && $('hrBleAutoReconnect').checked && !bleConnectedDevice && !bleConnectInProgress) {
      setBleStatus(`Reconnecting remembered device ${remembered.name || saved.name || ''} in background...`)
      connectBleHeartRateDevice(remembered, { reconnect: true }).catch(() => {})
    }
    bleLog('remembered-devices', { browserGranted: devices.length, appDataCached: cached.length, savedLastId: saved.id || '' })
  } catch (err) {
    setBleStatus(`Could not load remembered BLE devices: ${err.message}`)
  }
}

async function scanNearbyBleDevices () {
  if (!navigator.bluetooth || typeof navigator.bluetooth.requestDevice !== 'function') {
    setBleStatus('Web Bluetooth is unavailable on this system.')
    return
  }
  if (bleScanPromise) return
  api.hrBleCancel()
  for (const option of Array.from($('hrBleDevices').options)) {
    if (option.dataset.source === 'nearby' && !bleBrowserDevices.has(option.value)) option.remove()
  }
  setBleStatus('Scanning for nearby Bluetooth LE devices...')
  bleLog('scan-started')
  let device = null
  try {
    bleScanPromise = navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_OPTIONAL_SERVICES
    })
    device = await bleScanPromise
    bleBrowserDevices.set(device.id, device)
    addBleDeviceOption(device, 'remembered')
    $('hrBleDevices').value = device.id
  } catch (err) {
    bleLog('scan-error', { name: err.name, message: err.message })
    if (err.name !== 'NotFoundError') setBleStatus(`BLE scan failed: ${err.message}`)
    else setBleStatus('Bluetooth scan cancelled.')
  } finally {
    bleScanPromise = null
  }
  if (device) {
    try { await connectBleHeartRateDevice(device) } catch (_) { /* connection function shows the error */ }
  }
}

async function ensureBleDeviceProvider () {
  if (deviceProviderRunning) return
  $('hrProvider').value = 'device'
  syncHrFields()
  const cfg = hrCfg()
  await api.saveSetting('hrProvider', 'device')
  await api.saveSetting('hrDeviceBridge', { port: cfg.bridgePort, relayToPulsoid: cfg.relayToPulsoid, relayToken: cfg.relayToken })
  const result = await api.hrStart(cfg)
  if (!result || result.ok === false) throw new Error(result?.error || 'Could not start local heart-rate receiver')
  deviceProviderRunning = true
}

function onGmansHeartRateMeasurement (event) {
  const value = event.target?.value
  bleLastFrameAt = Date.now()
  const bpm = relayBleMeasurement('goodmans', value)
  if (!bpm && value) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    const command = value.byteLength >= 12 ? value.getUint16(8, true) : 0
    const subcommand = value.byteLength >= 12 ? value.getUint16(10, true) : 0
    const isPpg = command === 0x000a && subcommand === 0x00ac
    const hasOpticalSignal = isPpg && Array.from(bytes.slice(13)).some(sample => sample !== 0)
    if (isPpg && !hasOpticalSignal) bleGmansZeroFrames += 1
    else if (isPpg) bleGmansZeroFrames = 0
    if (command === 0x00ff) bleLog('gmans-handshake-response', { subcommand, hex: Buffer.from(bytes).toString('hex') })
    if (Date.now() - bleLastRawLogAt > 30000) {
      bleLastRawLogAt = Date.now()
      bleLog('gmans-non-bpm-frame', { length: bytes.length, command, subcommand, hasOpticalSignal, hex: Buffer.from(bytes).toString('hex') })
    }
    if (isPpg && Date.now() - bleLastSensorStatusAt > 15000) {
      bleLastSensorStatusAt = Date.now()
      setBleStatus(hasOpticalSignal
        ? 'GMANS WATCH is connected and collecting optical pulse samples; waiting for BPM...'
        : 'GMANS WATCH is connected, but its optical sensor is returning zero signal. Wear it firmly and open the watch Heart Rate screen if its firmware requires that mode.')
    }
    if (isPpg && !hasOpticalSignal) scheduleGmansBackgroundWake()
  }
}

function submitBleBpm (bpm, protocol) {
  bleLastReadingAt = Date.now()
  bleLastBpmAt = bleLastReadingAt
  bleLastFrameAt = Date.now()
  bleNoBpmWarningLogged = false
  api.hrBleReading(bpm, Date.now())
  if (Date.now() - bleLastBpmLogAt > 30000) {
    bleLastBpmLogAt = Date.now()
    bleLog('heart-rate-received', { bpm, protocol })
  }
}

async function triggerGmansHeartRate () {
  const characteristic = bleWriteCharacteristic
  if (!characteristic) return
  await writeBleCommand(goodmansBlePlatform.startHeartRateCommand)
  bleLog('gmans-measurement-triggered')
}

async function configureGmansAutomaticHeartRate (enabled) {
  if (bleProtocol !== 'gmans' || !bleWriteCharacteristic) throw new Error('Connect GMANS WATCH first')
  const intervalMinutes = Math.max(1, Math.min(255, Number($('hrGmansAutoInterval').value) || 5))
  $('hrGmansAutoInterval').value = intervalMinutes
  const command = goodmansBlePlatform.buildAutomaticHeartRateCommand({
    enabled,
    startHour: 0,
    startMinute: 0,
    endHour: 23,
    endMinute: 59,
    intervalMinutes,
    sequence: bleGmansCommandSequence++ & 0xffff
  })
  await writeBleCommand(command)
  await api.saveSetting('hrGmansAutomatic', { enabled, intervalMinutes })
  bleLog('gmans-auto-heart-configured', { enabled, intervalMinutes, hex: Buffer.from(command).toString('hex') })
  setBleStatus(enabled
    ? `GMANS automatic heart-rate measurement enabled every ${intervalMinutes} minute(s). The watch may report these as periodic/history readings rather than a continuous live stream.`
    : 'GMANS automatic heart-rate measurement disabled on the watch.')
}

async function writeBleCommand (bytes) {
  const characteristic = bleWriteCharacteristic
  if (!characteristic) throw new Error('GMANS write characteristic is unavailable')
  // The official app fragmented long protocol frames at the default 20-byte
  // ATT payload boundary. Short commands remain a single write.
  for (let offset = 0; offset < bytes.length; offset += 20) {
    const chunk = bytes.slice(offset, Math.min(offset + 20, bytes.length))
    if (typeof characteristic.writeValueWithoutResponse === 'function') await characteristic.writeValueWithoutResponse(chunk)
    else await characteristic.writeValue(chunk)
    if (offset + 20 < bytes.length) await bleWait(35)
  }
}

async function triggerGmansBackgroundWake () {
  setBleStatus('GMANS optical sensor is idle; trying captured background wake handshake...')
  bleLog('gmans-background-wake-started', { zeroFrames: bleGmansZeroFrames })
  await writeBleCommand(goodmansBlePlatform.backgroundHandshake)
  await bleWait(250)
  await triggerGmansHeartRate()
  bleLog('gmans-background-wake-sent')
}

function scheduleGmansBackgroundWake () {
  if (bleGmansHandshakeAttempted || bleGmansWakeTimer || !$('hrGmansBackgroundWake').checked) return
  // This firmware can emit only one AC frame every ~30 seconds while its sensor
  // is asleep, so counting several frames delays the fallback for minutes.
  const elapsed = Date.now() - bleGmansConnectedAt
  const delay = Math.max(0, 10000 - elapsed)
  bleLog('gmans-background-wake-scheduled', { delay, zeroFrames: bleGmansZeroFrames })
  bleGmansWakeTimer = setTimeout(() => {
    bleGmansWakeTimer = null
    if (bleProtocol !== 'gmans' || bleGmansHandshakeAttempted || bleLastBpmAt > bleGmansConnectedAt) return
    bleGmansHandshakeAttempted = true
    triggerGmansBackgroundWake().catch(err => {
      bleLog('gmans-background-wake-error', { name: err.name, message: err.message })
      setBleStatus(`GMANS background sensor wake failed: ${err.message}`)
    })
  }, delay)
}

async function connectRegisteredBlePlatform (server, platform) {
  const service = await server.getPrimaryService(platform.serviceUuid)
  const characteristic = await service.getCharacteristic(platform.notifyCharacteristicUuid)
  const writeCharacteristic = platform.writeCharacteristicUuid
    ? await service.getCharacteristic(platform.writeCharacteristicUuid)
    : null
  await characteristic.startNotifications()
  const listener = event => relayBleMeasurement(platform.id, event.target?.value)
  characteristic.addEventListener('characteristicvaluechanged', listener)
  bleHeartRateCharacteristic = characteristic
  bleMeasurementListener = listener
  bleProtocol = platform.protocol || platform.id
  bleWriteCharacteristic = writeCharacteristic
  try {
    if (writeCharacteristic && platform.startHeartRateCommand) await writeBleCommand(platform.startHeartRateCommand)
  } catch (err) {
    characteristic.removeEventListener('characteristicvaluechanged', listener)
    try { await characteristic.stopNotifications() } catch (_) {}
    bleHeartRateCharacteristic = null
    bleMeasurementListener = null
    bleWriteCharacteristic = null
    bleProtocol = ''
    throw err
  }
}

async function connectGmansHeartRate (server) {
  const service = await server.getPrimaryService(goodmansBlePlatform.serviceUuid)
  const writeCharacteristic = await service.getCharacteristic(goodmansBlePlatform.writeCharacteristicUuid)
  const notifyCharacteristic = await service.getCharacteristic(goodmansBlePlatform.notifyCharacteristicUuid)
  await notifyCharacteristic.startNotifications()
  notifyCharacteristic.addEventListener('characteristicvaluechanged', onGmansHeartRateMeasurement)
  bleWriteCharacteristic = writeCharacteristic
  bleHeartRateCharacteristic = notifyCharacteristic
  bleMeasurementListener = onGmansHeartRateMeasurement
  bleProtocol = 'gmans'
  bleGmansConnectedAt = Date.now()
  bleLastBpmAt = 0
  bleGmansZeroFrames = 0
  bleGmansHandshakeAttempted = false
  if (bleGmansWakeTimer) clearTimeout(bleGmansWakeTimer)
  bleGmansWakeTimer = null
  if ($('hrGmansAutomatic').checked) {
    await configureGmansAutomaticHeartRate(true)
    await bleWait(150)
  }
  await triggerGmansHeartRate()
  bleRetriggerTimer = setInterval(() => {
    triggerGmansHeartRate().catch(err => {
      console.warn('GMANS heart-rate retrigger failed:', err.message)
      bleLog('gmans-trigger-error', { name: err.name, message: err.message })
    })
  }, 15000)
}

function startBleWatchdog () {
  if (bleWatchdogTimer) clearInterval(bleWatchdogTimer)
  bleLastReadingAt = Date.now()
  bleLastFrameAt = Date.now()
  bleNoBpmWarningLogged = false
  bleWatchdogTimer = setInterval(() => {
    if (!bleConnectedDevice || bleConnectInProgress) return
    // GMANS can stream raw AC/PPG frames for a while before producing an AB/BPM
    // frame. Any recent notification proves GATT is alive and must not trigger a
    // reconnect, otherwise we repeatedly reset the watch's measurement cycle.
    if (bleProtocol === 'gmans' && Date.now() - bleLastFrameAt < 60000) {
      if (!bleNoBpmWarningLogged && Date.now() - bleLastReadingAt >= 60000) {
        bleNoBpmWarningLogged = true
        bleLog('gmans-no-bpm-yet', { seconds: Math.round((Date.now() - bleLastReadingAt) / 1000), framesStillArriving: true })
      }
      return
    }
    if (Date.now() - bleLastReadingAt < 45000) return
    const stalledDevice = bleConnectedDevice
    clearInterval(bleWatchdogTimer)
    bleWatchdogTimer = null
    bleLog('heart-rate-stalled', { secondsWithoutReading: Math.round((Date.now() - bleLastReadingAt) / 1000), protocol: bleProtocol })
    setBleStatus('BLE is connected but heart rate stalled; restarting the GATT session...')
    connectBleHeartRateDevice(stalledDevice, { reconnect: true })
      .catch(err => scheduleBleReconnect(`heart-rate watchdog: ${err.message}`))
  }, 10000)
}

function onBleDisconnected (event) {
  if (event.target !== bleConnectedDevice) return
  const disconnectedDevice = bleConnectedDevice
  if (bleRetriggerTimer) clearInterval(bleRetriggerTimer)
  bleRetriggerTimer = null
  if (bleWatchdogTimer) clearInterval(bleWatchdogTimer)
  bleWatchdogTimer = null
  bleHeartRateCharacteristic = null
  bleWriteCharacteristic = null
  bleMeasurementListener = null
  bleProtocol = ''
  bleGmansConnectedAt = 0
  bleGmansZeroFrames = 0
  bleGmansHandshakeAttempted = false
  if (bleGmansWakeTimer) clearTimeout(bleGmansWakeTimer)
  bleGmansWakeTimer = null
  bleConnectedDevice = null
  bleLog('gatt-disconnected', { id: disconnectedDevice?.id, name: disconnectedDevice?.name, manual: bleManualDisconnect })
  if (!bleManualDisconnect) scheduleBleReconnect('unexpected disconnect')
  else setBleStatus('BLE device disconnected.')
}

function clearBleReconnectTimer () {
  if (bleReconnectTimer) clearTimeout(bleReconnectTimer)
  bleReconnectTimer = null
}

function scheduleBleReconnect (reason) {
  if (!$('hrBleAutoReconnect').checked || !bleLastDevice || bleManualDisconnect) {
    setBleStatus('BLE device disconnected. Select it and press Connect to reconnect.')
    return
  }
  clearBleReconnectTimer()
  const delays = [1000, 2500, 5000, 10000, 30000]
  const delay = delays[Math.min(bleReconnectAttempts, delays.length - 1)]
  bleReconnectAttempts += 1
  setBleStatus(`BLE disconnected; reconnect attempt ${bleReconnectAttempts} in ${Math.round(delay / 1000)}s...`)
  bleLog('reconnect-scheduled', { attempt: bleReconnectAttempts, delay, reason })
  bleReconnectTimer = setTimeout(() => {
    bleReconnectTimer = null
    connectBleHeartRateDevice(bleLastDevice, { reconnect: true })
      .catch(err => scheduleBleReconnect(err.message))
  }, delay)
}

async function disconnectBleHeartRateDevice (options = {}) {
  const manual = options.manual !== false
  const showStatus = options.showStatus !== false
  bleManualDisconnect = manual
  if (manual) clearBleReconnectTimer()
  const characteristic = bleHeartRateCharacteristic
  const device = bleConnectedDevice
  const measurementListener = bleMeasurementListener
  if (bleRetriggerTimer) clearInterval(bleRetriggerTimer)
  bleRetriggerTimer = null
  if (bleWatchdogTimer) clearInterval(bleWatchdogTimer)
  bleWatchdogTimer = null
  bleHeartRateCharacteristic = null
  bleWriteCharacteristic = null
  bleMeasurementListener = null
  bleProtocol = ''
  bleGmansConnectedAt = 0
  bleGmansZeroFrames = 0
  bleGmansHandshakeAttempted = false
  if (bleGmansWakeTimer) clearTimeout(bleGmansWakeTimer)
  bleGmansWakeTimer = null
  bleConnectedDevice = null
  if (characteristic) {
    try {
      if (measurementListener) characteristic.removeEventListener('characteristicvaluechanged', measurementListener)
    } catch (_) {}
    try { await characteristic.stopNotifications() } catch (_) {}
  }
  if (device) {
    try { device.removeEventListener('gattserverdisconnected', onBleDisconnected) } catch (_) {}
    try { if (device.gatt?.connected) device.gatt.disconnect() } catch (_) {}
  }
  if (showStatus) setBleStatus('BLE device disconnected.')
}

async function connectBleHeartRateDevice (device, options = {}) {
  if (!device?.gatt) throw new Error('Selected device does not expose Bluetooth GATT')
  if (bleConnectedDevice?.id === device.id && device.gatt.connected) {
    setBleStatus(`Already connected to ${device.name || 'BLE device'}; background monitoring is active.`)
    return
  }
  if (bleConnectInProgress) throw new Error('A BLE connection attempt is already running')
  bleConnectInProgress = true
  bleLastDevice = device
  bleManualDisconnect = false
  clearBleReconnectTimer()
  try {
    await disconnectBleHeartRateDevice({ manual: false, showStatus: false })
    // Windows can report "GATT Error Unknown" if a new connection starts before
    // the previous ATT session has finished closing.
    await bleWait(options.reconnect ? 1200 : 500)
    await ensureBleDeviceProvider()
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      setBleStatus(`${options.reconnect ? 'Reconnecting' : 'Connecting'} to ${device.name || 'BLE device'} (attempt ${attempt}/3)...`)
      bleLog('gatt-connect-attempt', { attempt, reconnect: !!options.reconnect, id: device.id, name: device.name || '' })
      try {
        if (device.gatt.connected) device.gatt.disconnect()
        if (attempt > 1) await bleWait(attempt * 1000)
        const server = await device.gatt.connect()
        const preferredPlatform = findBleHeartRatePlatform({ name: device.name })
        if (preferredPlatform) {
          if (preferredPlatform.id === 'goodmans') await connectGmansHeartRate(server)
          else await connectRegisteredBlePlatform(server, preferredPlatform)
        } else {
          let platformError = null
          for (const platform of getBleHeartRatePlatforms()) {
            try {
              if (platform.id === 'goodmans') await connectGmansHeartRate(server)
              else await connectRegisteredBlePlatform(server, platform)
              platformError = null
              break
            } catch (err) {
              platformError ||= err
            }
          }
          if (platformError) throw platformError
        }
        device.addEventListener('gattserverdisconnected', onBleDisconnected)
        bleConnectedDevice = device
        bleReconnectAttempts = 0
        startBleWatchdog()
        await api.saveSetting('hrBleDevice', { id: device.id, name: device.name || 'BLE heart-rate device', protocol: bleProtocol, lastConnectedAt: Date.now() })
        bleLog('gatt-connected', { id: device.id, name: device.name || '', protocol: bleProtocol, attempt })
        const activePlatform = getBleHeartRatePlatforms().find(platform => (platform.protocol || platform.id) === bleProtocol)
        setBleStatus(`Connected to ${device.name || 'BLE device'} using ${activePlatform?.displayName || bleProtocol}; background monitoring is active.`)
        return
      } catch (err) {
        lastError = err
        bleLog('gatt-connect-error', { attempt, name: err.name, message: err.message, connected: !!device.gatt.connected })
        await disconnectBleHeartRateDevice({ manual: false, showStatus: false })
        try { if (device.gatt.connected) device.gatt.disconnect() } catch (_) {}
      }
    }
    const err = lastError || new Error('Unknown GATT connection failure')
    const missingService = err.name === 'NotFoundError'
    setBleStatus(missingService
      ? `${device.name || 'Device'} did not expose a supported heart-rate service or adapter characteristics during this connection.`
      : `Could not connect to ${device.name || 'device'} after 3 attempts: ${err.message}. Ensure phone/Python apps are disconnected, then power-cycle the watch if Windows kept a stale GATT session.`)
    throw err
  } finally {
    bleConnectInProgress = false
  }
}

$('hrBleScan').addEventListener('click', scanNearbyBleDevices)
$('hrBlePaired').addEventListener('click', refreshBleRememberedDevices)
$('hrBleCancel').addEventListener('click', async () => {
  await api.hrBleCancel()
  for (const option of Array.from($('hrBleDevices').options)) {
    if (option.dataset.source === 'nearby' && !bleBrowserDevices.has(option.value)) option.remove()
  }
  setBleStatus('Bluetooth scan cancelled.')
})
$('hrBleConnect').addEventListener('click', async () => {
  const id = $('hrBleDevices').value
  if (!id) return setBleStatus('Select a BLE device first.')
  const remembered = bleBrowserDevices.get(id)
  const cached = bleCachedDevices.get(id)
  try {
    if (remembered) await connectBleHeartRateDevice(remembered)
    else if (cached) {
      // requestDevice must remain directly attached to this click. Main uses the
      // AppData cache to select the matching watch as soon as it appears.
      api.hrBlePrepareReconnect(cached)
      setBleStatus(`Looking for cached device ${cached.name || cached.id}...`)
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_OPTIONAL_SERVICES
      })
      bleBrowserDevices.set(device.id, device)
      addBleDeviceOption(device, 'remembered')
      await connectBleHeartRateDevice(device)
    }
    else if (!await api.hrBleSelect(id)) setBleStatus('That scan result expired. Scan again.')
  } catch (err) {
    bleLog('cached-or-selected-connect-error', { name: err.name, message: err.message, id })
    if (err.name === 'NotFoundError') setBleStatus('Cached BLE device was not found. Turn it on, keep it nearby, and try again.')
  }
})
$('hrBleDisconnect').addEventListener('click', disconnectBleHeartRateDevice)
$('hrBleDebug').addEventListener('click', () => api.hrBleOpenDebug())
$('hrBleAutoReconnect').addEventListener('change', async e => {
  await api.saveSetting('hrBleAutoReconnect', e.target.checked)
  bleLog('auto-reconnect-changed', { enabled: e.target.checked })
  if (!e.target.checked) clearBleReconnectTimer()
  else if (!bleConnectedDevice && bleLastDevice) scheduleBleReconnect('auto-reconnect enabled')
})
$('hrGmansAutomatic').addEventListener('change', async e => {
  const intervalMinutes = Math.max(1, Math.min(255, Number($('hrGmansAutoInterval').value) || 5))
  await api.saveSetting('hrGmansAutomatic', { enabled: e.target.checked, intervalMinutes })
  if (bleProtocol !== 'gmans') {
    setBleStatus(`GMANS automatic heart rate will be ${e.target.checked ? 'enabled' : 'disabled'} the next time the watch connects.`)
    return
  }
  try {
    await configureGmansAutomaticHeartRate(e.target.checked)
  } catch (err) {
    bleLog('gmans-auto-heart-error', { name: err.name, message: err.message })
    setBleStatus(`Could not configure GMANS automatic heart rate: ${err.message}`)
  }
})
$('hrGmansAutoInterval').addEventListener('change', async e => {
  const intervalMinutes = Math.max(1, Math.min(255, Number(e.target.value) || 5))
  e.target.value = intervalMinutes
  await api.saveSetting('hrGmansAutomatic', { enabled: $('hrGmansAutomatic').checked, intervalMinutes })
  if ($('hrGmansAutomatic').checked && bleProtocol === 'gmans') {
    try { await configureGmansAutomaticHeartRate(true) } catch (err) { setBleStatus(`Could not update GMANS interval: ${err.message}`) }
  }
})
$('hrGmansBackgroundWake').addEventListener('change', e => {
  api.saveSetting('hrGmansBackgroundWake', e.target.checked)
  bleLog('gmans-background-wake-changed', { enabled: e.target.checked })
})
document.addEventListener('visibilitychange', () => {
  bleLog('renderer-visibility', { state: document.visibilityState, connected: !!bleConnectedDevice, protocol: bleProtocol })
})

$('hrStart').addEventListener('click', async () => {
  const c = hrCfg()
  await api.saveSetting('pulsoidToken', c.token)
  await api.saveSetting('hrProvider', c.provider)
  await api.saveSetting('hyperate', { apiKey: c.apiKey, deviceId: c.deviceId })
  await api.saveSetting('hrDeviceBridge', { port: c.bridgePort, relayToPulsoid: c.relayToPulsoid, relayToken: c.relayToken })
  await api.saveSetting('hrOscProfiles', c.oscProfiles)
  try {
    const result = await api.hrStart(c)
    deviceProviderRunning = c.provider === 'device' && !!result?.ok
    if (result && result.ok === false) {
      setPill('hrState', false, '', 'offline')
      setText('hrSub', `Could not start receiver: ${result.error}`)
    } else if (c.provider === 'device') {
      setText('hrSub', `waiting at ${result.endpoint}`)
    }
  } catch (err) {
    setPill('hrState', false, '', 'offline')
    setText('hrSub', `Could not start heart rate: ${err.message}`)
  }
})
$('hrStop').addEventListener('click', async () => {
  await disconnectBleHeartRateDevice()
  await api.hrBleCancel()
  await api.hrStop()
  deviceProviderRunning = false
})
$('hrClear').addEventListener('click', async () => { await api.hrClearSessions(); renderHrSessions([]) })

function fmtDur (sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${m}m ${s}s` }
function renderHrSessions (list) {
  const el = $('hrSessions')
  if (!list || !list.length) { el.textContent = 'No saved sessions yet.'; return }
  el.innerHTML = list.map(x => {
    const d = new Date(x.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    return `<div style="padding:2px 0">❤️ ${d} · ${fmtDur(x.durationSec)} · avg ${x.avg} · ${x.min}–${x.max} <span style="opacity:.55">(${x.provider})</span></div>`
  }).join('')
}
api.on('hr:sessions', renderHrSessions)

/* ---------------- avatar locker ---------------- */
let lockerVault = null
let lockerSelectedAvatarId = ''
let lockerBusy = false

function lockerMessage (message, error = false) {
  const el = $('lockerMessage')
  el.textContent = message
  el.style.color = error ? 'var(--bad)' : 'var(--muted)'
}

function lockerSelectedRecord () {
  return lockerVault?.avatars?.find(record => record.ownershipPackage.license.avatarId === lockerSelectedAvatarId) || null
}

function lockerCheckedGroups () {
  return [...document.querySelectorAll('#lockerGroups input[data-group-id]:checked')].map(input => input.dataset.groupId)
}

function renderLocker () {
  const vault = lockerVault
  const avatars = vault?.avatars || []
  setText('lockerOwnedCount', avatars.length)
  setText('lockerUnlockedCount', avatars.filter(record => record.unlockMode !== 'locked').length)
  setText('lockerOscSummary', vault ? `${vault.oscSettings.host}:${vault.oscSettings.port}` : '127.0.0.1:9000')
  setText('lockerDeviceId', vault?.deviceId || 'loading')
  if (vault) {
    $('lockerOscHost').value = vault.oscSettings.host
    $('lockerOscPort').value = vault.oscSettings.port
  }

  if (lockerSelectedAvatarId && !avatars.some(record => record.ownershipPackage.license.avatarId === lockerSelectedAvatarId)) lockerSelectedAvatarId = ''
  if (!lockerSelectedAvatarId && avatars.length) lockerSelectedAvatarId = avatars[0].ownershipPackage.license.avatarId

  const list = $('lockerAvatarList')
  list.replaceChildren()
  if (!avatars.length) {
    const empty = document.createElement('div')
    empty.className = 'section-note'
    empty.textContent = 'No ownership packages imported.'
    list.appendChild(empty)
  }
  for (const record of avatars) {
    const license = record.ownershipPackage.license
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `locker-avatar${license.avatarId === lockerSelectedAvatarId ? ' active' : ''}`
    const title = document.createElement('b')
    title.textContent = license.avatarName
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = `${license.creatorDisplayName} · ${record.unlockMode} · ${license.lockGroups.length} group(s)`
    button.append(title, meta)
    button.addEventListener('click', () => { lockerSelectedAvatarId = license.avatarId; renderLocker() })
    list.appendChild(button)
  }

  const selected = lockerSelectedRecord()
  $('lockerNoSelection').style.display = selected ? 'none' : ''
  $('lockerSelected').style.display = selected ? '' : 'none'
  if (!selected) return
  const license = selected.ownershipPackage.license
  setText('lockerAvatarName', license.avatarName)
  setText('lockerAvatarCreator', `Verified package by ${license.creatorDisplayName}`)
  setText('lockerAvatarId', license.avatarId)
  setText('lockerAvatarMode', selected.unlockMode)
  $('lockerAvatarMode').className = `pill ${selected.unlockMode === 'locked' ? 'off' : 'on'}`
  document.querySelectorAll('.locker-mode').forEach(button => button.classList.toggle('active', button.dataset.lockerMode === selected.unlockMode))

  const groups = $('lockerGroups')
  groups.replaceChildren()
  if (!license.lockGroups.length) {
    const empty = document.createElement('div')
    empty.className = 'section-note'
    empty.textContent = 'This ownership package has no individual feature groups.'
    groups.appendChild(empty)
  }
  for (const group of license.lockGroups) {
    const label = document.createElement('label')
    label.className = 'locker-group'
    label.style.margin = '0'
    const text = document.createElement('span')
    const name = document.createElement('b')
    name.style.display = 'block'
    name.style.color = 'var(--text)'
    name.textContent = group.displayName
    const parameter = document.createElement('small')
    parameter.className = 'section-note'
    parameter.textContent = group.oscParameter
    text.append(name, parameter)
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.dataset.groupId = group.id
    checkbox.checked = selected.groupIds.includes(group.id)
    label.append(text, checkbox)
    groups.appendChild(label)
  }
}

async function runLocker (message, action) {
  if (lockerBusy) return
  lockerBusy = true
  lockerMessage(message)
  document.querySelectorAll('#avatarlocker button').forEach(button => { button.disabled = true })
  try {
    const result = await action()
    if (result?.avatars) lockerVault = result
    renderLocker()
    lockerMessage('Avatar Locker is ready.')
    return result
  } catch (err) {
    lockerMessage(err.message || String(err), true)
    return null
  } finally {
    lockerBusy = false
    document.querySelectorAll('#avatarlocker button').forEach(button => { button.disabled = false })
  }
}

async function loadLocker () {
  await runLocker('Loading encrypted vault...', () => api.lockerGetState())
  try {
    const legacy = await api.lockerLegacyStatus()
    $('lockerLegacy').style.display = legacy.available ? '' : 'none'
  } catch (_) {}
}

document.querySelector('[data-tab="avatarlocker"]').addEventListener('click', loadLocker)
$('lockerRefresh').addEventListener('click', loadLocker)
$('lockerImport').addEventListener('click', () => runLocker('Importing and verifying ownership package...', () => api.lockerImportOwnership()))
$('lockerLegacy').addEventListener('click', () => runLocker('Importing the original NekoAvatarLocker vault...', () => api.lockerImportLegacyVault()))
$('lockerFolder').addEventListener('click', () => api.lockerOpenUserData())
$('lockerSign').addEventListener('click', async () => {
  const result = await runLocker('Signing ownership template...', () => api.lockerSignOwnershipTemplate())
  if (result?.outputPath) lockerMessage(`Signed ${result.avatarName}: ${result.outputPath}`)
})
$('lockerExport').addEventListener('click', () => {
  if (lockerSelectedAvatarId) runLocker('Exporting ownership package...', () => api.lockerExportOwnership(lockerSelectedAvatarId))
})
document.querySelectorAll('.locker-mode').forEach(button => button.addEventListener('click', () => {
  if (!lockerSelectedAvatarId) return
  const mode = button.dataset.lockerMode
  const groups = mode === 'partial' ? lockerCheckedGroups() : []
  runLocker(`Sending ${mode} state to VRChat...`, () => api.lockerSetUnlock(lockerSelectedAvatarId, mode, groups))
}))
$('lockerSendPartial').addEventListener('click', () => {
  if (lockerSelectedAvatarId) runLocker('Sending selected feature groups...', () => api.lockerSetUnlock(lockerSelectedAvatarId, 'partial', lockerCheckedGroups()))
})
$('lockerSaveOsc').addEventListener('click', () => runLocker('Saving OSC target...', () => api.lockerUpdateOscSettings({ host: $('lockerOscHost').value, port: Number($('lockerOscPort').value) })))
$('lockerReset').addEventListener('click', () => {
  if (window.confirm('Remove every imported ownership package from the local Avatar Locker vault?')) runLocker('Clearing Avatar Locker vault...', () => api.lockerResetVault())
})

api.on('window:update', s => {
  setText('winOut', `${s.app || ''}${s.title ? ' — ' + s.title : ''}`)
  composer.update({ window: s.title, windowApp: s.app })
})
$('enableWindow').addEventListener('change', e => { setPill('winState', e.target.checked, 'on'); e.target.checked ? api.windowStart() : api.windowStop(); api.saveSetting('windowEnabled', e.target.checked) })
$('winShowTitle').addEventListener('change', e => { composer.setWindowShowTitle(e.target.checked); api.saveSetting('windowShowTitle', e.target.checked); updatePreview() })

// ToNSaveManager (Terrors of Nowhere)
function tonPortVal () { const p = parseInt($('tonPort') && $('tonPort').value, 10); return Number.isFinite(p) && p > 0 ? p : 11398 }
let tonStarted = false // whether the WS has been asked to connect (module auto-retries until connected)
function tonEnsureConnected () { if (!tonStarted) { tonStarted = true; api.tonStart({ port: tonPortVal() }) } }
let tonLastPlayerLoad = 0
function tonThrottledPlayer () { const t = Date.now(); if (t - tonLastPlayerLoad < 4000) return; tonLastPlayerLoad = t; loadTonPlayer() }

// Local milestone achievements derived from the lifetime stats ToNSaveManager
// reports (it has no native achievement feed). Each unlocks when its stat crosses
// the goal; lifetime stats only ever go up, so unlocks are permanent.
const TON_ACHIEVEMENTS = [
  { icon: '🩸', name: 'First Steps', desc: 'Play your first round', val: s => s.rounds, goal: 1 },
  { icon: '🎯', name: 'Getting the Hang', desc: 'Play 10 rounds', val: s => s.rounds, goal: 10 },
  { icon: '💯', name: 'Centurion', desc: 'Play 100 rounds', val: s => s.rounds, goal: 100 },
  { icon: '🏆', name: 'Veteran', desc: 'Play 500 rounds', val: s => s.rounds, goal: 500 },
  { icon: '🛡️', name: 'Survivor', desc: 'Survive 10 rounds', val: s => s.survivals, goal: 10 },
  { icon: '🛡️', name: 'Hardened', desc: 'Survive 50 rounds', val: s => s.survivals, goal: 50 },
  { icon: '👑', name: 'Untouchable', desc: 'Survive 100 rounds', val: s => s.survivals, goal: 100 },
  { icon: '☠️', name: 'It Happens', desc: 'Die for the first time', val: s => s.deaths, goal: 1 },
  { icon: '💀', name: 'Pain Tolerance', desc: 'Die 50 times', val: s => s.deaths, goal: 50 },
  { icon: '🤕', name: 'Damage Sponge', desc: 'Take 10,000 damage', val: s => s.damageTaken, goal: 10000 },
  { icon: '🧱', name: 'Iron Will', desc: 'Take 50,000 damage', val: s => s.damageTaken, goal: 50000 },
  { icon: '👊', name: 'Stunner', desc: 'Stun terrors 10 times', val: s => s.stunsAll, goal: 10 },
  { icon: '💥', name: 'Stun Master', desc: 'Stun terrors 50 times', val: s => s.stunsAll, goal: 50 },
  { icon: '🥇', name: 'Combo King', desc: 'Stun 5+ in a single round', val: s => s.topStunsAll, goal: 5 },
  { icon: '🌗', name: 'Coin Flip', desc: '50% survival rate (20+ rounds)', val: s => (s.rounds >= 20 ? Math.round((s.survivals / s.rounds) * 100) : 0), goal: 50 }
]
let tonUnlockedSeen = null // Set of names already unlocked, to detect fresh unlocks

function renderTonStats (s) {
  const el = $('tonStatsGrid'); if (!el) return
  const wr = s.rounds ? Math.round((s.survivals / s.rounds) * 100) + '%' : '—'
  const rows = [
    ['Rounds', (s.rounds || 0).toLocaleString()], ['Survivals', (s.survivals || 0).toLocaleString()],
    ['Deaths', (s.deaths || 0).toLocaleString()], ['Win rate', wr],
    ['Damage taken', (s.damageTaken || 0).toLocaleString()], ['Stuns', (s.stunsAll || 0).toLocaleString()],
    ['Best stuns/round', (s.topStunsAll || 0).toLocaleString()],
    ['This session', `${s.sessionSurvivals || 0}/${s.sessionRounds || 0} survived · ${s.sessionStuns || 0} stuns`]
  ]
  el.innerHTML = rows.map(([k, v]) =>
    `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span class="muted">${k}</span><b>${v}</b></div>`
  ).join('')
}

function renderTonAchievements (s) {
  const el = $('tonAchievements'); if (!el) return
  const computed = TON_ACHIEVEMENTS.map(a => {
    const v = a.val(s) || 0
    return { ...a, value: v, unlocked: v >= a.goal, pct: Math.min(100, Math.round((v / a.goal) * 100)) }
  })
  const done = computed.filter(a => a.unlocked).length
  // Detect freshly-unlocked achievements after the first render of a session.
  const nowSet = new Set(computed.filter(a => a.unlocked).map(a => a.name))
  if (tonUnlockedSeen) {
    computed.filter(a => a.unlocked && !tonUnlockedSeen.has(a.name))
      .forEach(a => setText('tonOut', `🏆 Achievement unlocked: ${a.icon} ${a.name}!`))
  }
  tonUnlockedSeen = nowSet
  const badge = a => {
    const title = `${a.desc} (${a.value.toLocaleString()}/${a.goal.toLocaleString()})`
    const style = a.unlocked
      ? 'background:var(--accent,#7c5cff);color:#fff;border:1px solid transparent'
      : 'opacity:.55;border:1px solid var(--line,#333);background:transparent'
    const label = a.unlocked ? `✓ ${a.icon} ${a.name}` : `🔒 ${a.icon} ${a.name} · ${a.pct}%`
    return `<span title="${title}" style="display:inline-block;padding:3px 8px;border-radius:10px;font-size:.72rem;margin:3px 4px 0 0;${style}">${label}</span>`
  }
  const unlocked = computed.filter(a => a.unlocked)
  const locked = computed.filter(a => !a.unlocked)
  const section = (heading, list) => list.length
    ? `<div class="muted" style="font-size:.72rem;margin:8px 0 2px">${heading}</div>${list.map(badge).join('')}`
    : ''
  el.innerHTML =
    `<div class="muted" style="font-size:.74rem;margin-bottom:2px">Achievements · ${done}/${TON_ACHIEVEMENTS.length} unlocked</div>` +
    section(`✓ Unlocked (${unlocked.length})`, unlocked) +
    section(`🔒 Locked (${locked.length})`, locked)
}

api.on('ton:update', s => {
  setPill('tonState', s.connected, s.roundActive ? 'in round' : 'connected', s.error ? 'error' : 'offline')
  if (s.connected) {
    const live = s.roundActive ? `${[s.roundType, s.terror].filter(Boolean).join(' · ') || 'Round'} · ${s.alive ? 'Alive' : 'Dead'}` : 'In lobby'
    setText('tonOut', `${live} · 👥 ${s.players} · ${s.survivals}/${s.rounds} survived · ☠ ${s.deaths}`)
  } else {
    setText('tonOut', s.error || 'Waiting for ToNSaveManager… (enable its WebSocket API)')
  }
  renderTonStats(s)
  renderTonAchievements(s)
  composer.update({
    tonConnected: !!s.connected, tonRoundActive: !!s.roundActive,
    tonRound: s.roundType || '', tonTerror: s.terror || '', tonMap: s.map || '',
    tonAlive: !!s.alive, tonPlayers: s.players || 0,
    tonRounds: s.rounds || 0, tonDeaths: s.deaths || 0, tonSurvivals: s.survivals || 0,
    tonDamage: s.damageTaken || 0, tonStuns: s.stunsAll || 0
  })
  // Terrors tab live connection status + rolling updates
  setPill('tonConnState', s.connected, s.roundActive ? 'in round' : 'connected', 'retrying…')
  setText('tonLiveInfo', s.connected
    ? (s.roundActive
        ? `🟢 Connected · ${[s.roundType, s.terror].filter(Boolean).join(' · ') || 'Round'} · ${s.alive ? 'Alive' : 'Dead'} · 👥 ${s.players} @ ${s.map || '?'}`
        : `🟢 Connected · In lobby${s.map ? ' · ' + s.map : ''} · 👥 ${s.players}`)
    : `🔴 Not connected${s.error ? ' — ' + s.error : ''} · retrying every 5s…`)
  if (s.connected) tonThrottledPlayer() // refresh stats/encounters/✓ markers live
})
$('enableTon').addEventListener('change', e => {
  setPill('tonState', e.target.checked, 'on') // ton:update will refine to connected / in round
  tonStarted = e.target.checked
  e.target.checked ? api.tonStart({ port: tonPortVal() }) : api.tonStop()
  api.saveSetting('tonEnabled', e.target.checked)
})
if ($('tonPort')) $('tonPort').addEventListener('change', e => {
  api.saveSetting('tonPort', tonPortVal())
  if ($('enableTon').checked) api.tonStart({ port: tonPortVal() }) // reconnect on the new port
})

/* ---------------- ToN Reference tab (fully native — renders from the offline cache) ---------------- */
const tonEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
let tonCacheData = null
let tonCat = 'achievements'
let tonFilter = 'all' // 'all' | 'unlocked' | 'locked'
let tonSeenData = { terrors: [], maps: [] }
// Unlock state per category (Sets hold both exact + lowercased names for matching).
let tonUnlock = { achievements: new Set(), items: new Set(), rounds: new Set(), terrors: new Set(), locations: new Set() }
const tonToSet = arr => { const s = new Set(); (arr || []).forEach(x => { s.add(x); s.add(String(x).toLowerCase()) }); return s }
const tonIsUnlocked = (cat, name) => { const s = tonUnlock[cat]; return !!s && (s.has(name) || s.has(String(name).toLowerCase())) }
// Locked/unlocked filter — true when an entry should be shown for the current filter.
const tonPassesFilter = (cat, name) => tonFilter === 'all' || (tonFilter === 'unlocked' ? tonIsUnlocked(cat, name) : !tonIsUnlocked(cat, name))

// Local cached icon (downloaded) with the remote URL as fallback; grayed when locked.
function tonImg (e, unlocked, size) {
  const remote = e.img || ''
  let src = remote
  if (e.icon && tonCacheData && tonCacheData.iconDir) src = 'file:///' + (tonCacheData.iconDir + '/' + e.icon).replace(/\\/g, '/').replace(/^\/+/, '')
  const filter = unlocked ? '' : 'filter:grayscale(1) brightness(.45);'
  return `<img src="${tonEsc(src)}" data-remote="${tonEsc(remote)}" loading="lazy" decoding="async"
     onerror="if(this.dataset.remote&&this.src!==this.dataset.remote){this.src=this.dataset.remote}else{this.style.visibility='hidden'}"
     style="width:${size}px;height:${size}px;border-radius:8px;object-fit:cover;flex:0 0 auto;${filter}"/>`
}
function tonSwatch (colors, unlocked) {
  const c = unlocked ? ((colors && colors[0]) || '#7c5cff') : '#555'
  return `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${tonEsc(c)};flex:0 0 auto"></span>`
}

function renderTonBoard () {
  const board = $('tonBoard'); if (!board) return
  const d = tonCacheData || {}
  const q = ($('tonSearch') ? $('tonSearch').value : '').trim().toLowerCase()
  const all = d[tonCat] || []
  const total = all.length
  const unlockedTotal = all.filter(e => tonIsUnlocked(tonCat, e.name)).length
  const rowOpen = (key, extra, title) => `<div class="tonItem" data-cat="${tonCat}" data-key="${tonEsc(key)}"${title ? ` title="${tonEsc(title)}"` : ''} style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line,#222);cursor:pointer;${extra || ''}">`
  let html = ''
  let shown = 0
  if (tonCat === 'achievements') {
    const list = all.filter(a => tonPassesFilter('achievements', a.name) && (!q || `${a.name} ${a.unlock} ${a.flavor}`.toLowerCase().includes(q)))
    shown = list.length
    html = list.map(a => {
      const u = tonIsUnlocked('achievements', a.name)
      return rowOpen(a.name, u ? '' : 'opacity:.85', a.tip) +
        `${tonImg(a, u, 40)}
         <div style="min-width:0;flex:1"><b style="font-size:.82rem">${u ? '✓ ' : '🔒 '}${tonEsc(a.name)}</b>
         <div class="muted" style="font-size:.74rem"><b>How to unlock:</b> ${tonEsc(a.unlock || a.flavor || '—')}</div></div></div>`
    }).join('')
  } else if (tonCat === 'terrors') {
    const list = all.filter(t => tonPassesFilter('terrors', t.name) && (!q || t.name.toLowerCase().includes(q)))
    shown = list.length
    html = '<div style="display:flex;flex-wrap:wrap;gap:8px">' + list.map(t => {
      const u = tonIsUnlocked('terrors', t.name)
      return `<div class="tonItem" data-cat="terrors" data-key="${tonEsc(t.name)}" title="${tonEsc(t.name)}${u ? ' (encountered — click to toggle)' : ' (click if you have met it)'}" style="width:80px;text-align:center;cursor:pointer;${u ? '' : 'opacity:.65'}">
        ${tonImg(t, u, 64).replace('border-radius:8px;', `border-radius:8px;border:1px solid ${u ? 'var(--accent,#7c5cff)' : 'var(--line,#333)'};`)}
        <div style="font-size:.68rem;margin-top:2px">${u ? '✓ ' : '🔒 '}${tonEsc(t.name)}</div></div>`
    }).join('') + '</div>'
  } else if (tonCat === 'items') {
    const list = all.filter(i => tonPassesFilter('items', i.name) && (!q || `${i.name} ${i.type}`.toLowerCase().includes(q)))
    shown = list.length
    html = list.map(i => {
      const u = tonIsUnlocked('items', i.name)
      return rowOpen(i.name, u ? '' : 'opacity:.7') + `<span style="flex:0 0 auto">${u ? '✓' : '🔒'}</span><b style="font-size:.82rem;flex:1">${tonEsc(i.name)}</b><span class="pill" style="font-size:.68rem">${tonEsc(i.type)}</span></div>`
    }).join('')
  } else if (tonCat === 'locations') {
    const list = all.filter(l => tonPassesFilter('locations', l.name) && (!q || l.name.toLowerCase().includes(q)))
    shown = list.length
    html = list.map(l => {
      const u = tonIsUnlocked('locations', l.name)
      return rowOpen(l.name, u ? '' : 'opacity:.7') + `${tonSwatch(l.colors, u)}<b style="font-size:.82rem;flex:1">${u ? '✓ ' : '🔒 '}${tonEsc(l.name)}</b>${u ? '<span class="pill" style="font-size:.68rem">visited</span>' : ''}</div>`
    }).join('')
  } else if (tonCat === 'rounds') {
    const list = all.filter(r => tonPassesFilter('rounds', r.name) && (!q || r.name.toLowerCase().includes(q)))
    shown = list.length
    html = list.map(r => {
      const u = tonIsUnlocked('rounds', r.name)
      return rowOpen(r.name, u ? '' : 'opacity:.7') + `${tonSwatch(r.colors, u)}<b style="font-size:.82rem">${u ? '✓ ' : '🔒 '}${tonEsc(r.name)}</b></div>`
    }).join('')
  }
  const filtered = tonFilter !== 'all' || q
  const header = `<div class="muted" style="font-size:.72rem;margin-bottom:6px">${unlockedTotal}/${total} unlocked${filtered ? ` · showing ${shown}` : ''} · click an entry to toggle ${tonCat === 'terrors' || tonCat === 'locations' ? '(auto-marked from live play)' : ''}</div>`
  board.innerHTML = header + (html || '<div class="muted">No matches.</div>')
}

async function loadTonUnlocks () {
  const u = await api.tonUnlocks()
  tonUnlock = { achievements: tonToSet(u.achievements), items: tonToSet(u.items), rounds: tonToSet(u.rounds), terrors: tonToSet(u.terrors), locations: tonToSet(u.locations) }
}

async function loadTonCache () {
  tonCacheData = await api.tonData()
  await loadTonUnlocks()
  const d = tonCacheData || {}
  const counts = `${(d.achievements || []).length} ach · ${(d.terrors || []).length} terrors · ${(d.items || []).length} items · ${(d.locations || []).length} maps · ${(d.rounds || []).length} rounds`
  setPill('tonCacheState', (d.achievements || []).length > 0, 'cached')
  const when = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString() : 'never'
  setText('tonCacheInfo', `${counts} · updated ${when}`)
  renderTonBoard()
}

async function loadTonRoundHistory () {
  const rows = await api.tonHistory(200)
  const el = $('tonRoundHistory'); if (!el) return
  if (!rows.length) { el.textContent = 'No rounds recorded yet.'; return }
  el.innerHTML = rows.map(r => {
    const res = r.result === 'Survived' ? '✅' : (r.result === 'Died' ? '☠' : '·')
    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid var(--line,#222)">
      <span>${res} ${tonEsc(r.roundType || 'Round')}${r.terror ? ' · ' + tonEsc(r.terror) : ''}</span>
      <span class="muted">${tonEsc(r.map || '')} · ${new Date(r.ts).toLocaleDateString()}</span></div>`
  }).join('')
}

async function loadTonPlayer () {
  const s = await api.tonGet()
  tonSeenData = await api.tonSeen()
  const wr = s.rounds ? Math.round((s.survivals / s.rounds) * 100) + '%' : '—'
  setText('tonPlayerStats', `Rounds ${s.rounds || 0} · Survived ${s.survivals || 0} (${wr}) · Deaths ${s.deaths || 0} · Stuns ${s.stunsAll || 0} · Damage ${(s.damageTaken || 0).toLocaleString()}`)
  const terrors = tonSeenData.terrors || []
  const total = tonCacheData ? (tonCacheData.terrors || []).length : 0
  $('tonEncounters').innerHTML =
    `<div class="muted" style="font-size:.78rem;margin-bottom:4px">👹 Terrors encountered: ${terrors.length}${total ? '/' + total : ''} · 🗺 Maps seen: ${(tonSeenData.maps || []).length}</div>` +
    terrors.map(t => `<span class="pill" style="margin:2px">${tonEsc(t)}</span>`).join('')
  if (tonCat === 'terrors' || tonCat === 'locations') { await loadTonUnlocks(); renderTonBoard() } // refresh ✓ markers
  loadTonRoundHistory()
}

// Click an entry to toggle its unlocked state (persisted); grayscale ↔ colour.
if ($('tonBoard')) $('tonBoard').addEventListener('click', async ev => {
  const el = ev.target.closest('.tonItem'); if (!el) return
  const cat = el.dataset.cat
  const key = el.dataset.key
  const now = await api.tonToggleUnlock(cat, key)
  const s = tonUnlock[cat]
  if (now) { s.add(key); s.add(key.toLowerCase()) } else { s.delete(key); s.delete(key.toLowerCase()) }
  renderTonBoard()
  if (cat === 'terrors' || cat === 'locations') loadTonPlayer() // keep encounter counts in sync
})

document.querySelectorAll('#tonref .tonCat').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tonref .tonCat').forEach(x => x.classList.remove('active'))
  b.classList.add('active')
  tonCat = b.dataset.toncat
  renderTonBoard()
}))
document.querySelectorAll('#tonref .tonFilter').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tonref .tonFilter').forEach(x => x.classList.remove('active'))
  b.classList.add('active')
  tonFilter = b.dataset.tonfilter
  renderTonBoard()
}))
if ($('tonSearch')) $('tonSearch').addEventListener('input', renderTonBoard)
if ($('tonRefresh')) $('tonRefresh').addEventListener('click', async () => {
  setText('tonCacheInfo', 'Updating cached data…')
  try { await api.tonDataRefresh(); await loadTonCache() } catch (_) { setText('tonCacheInfo', 'Update failed (offline?)') }
})
if ($('tonResetAll')) $('tonResetAll').addEventListener('click', async () => {
  const ok = await confirmDialog('Reset all ToN data? This clears every board unlock, all terrors/maps seen, and your round history. Save-code backups are kept (use the Save backups “Clear” button for those). This cannot be undone.')
  if (!ok) return
  const r = await api.tonResetAll()
  if (r && r.ok) {
    await loadTonUnlocks()
    renderTonBoard()
    loadTonPlayer()
    loadTonRoundHistory()
    setText('tonCacheInfo', `🗑 Reset done · cleared unlocks, seen & ${r.rounds} round(s) of history`)
  }
})
if ($('tonExport')) $('tonExport').addEventListener('click', async () => { const r = await api.tonExport(); if (r && r.ok) setText('tonCacheInfo', 'Exported to ' + r.path) })
if ($('tonImport')) $('tonImport').addEventListener('click', async () => { const r = await api.tonImport(); if (r && r.ok) { setText('tonCacheInfo', `Imported · ${r.terrors} terrors seen`); loadTonPlayer() } })

api.on('ton:round', () => { loadTonRoundHistory(); loadTonPlayer() })

// Achievements auto-decoded from a captured save code (log or ToNSaveManager) — refresh the board.
api.on('ton:unlocksUpdated', async s => {
  await loadTonUnlocks()
  if (tonCat === 'achievements') renderTonBoard()
  setText('tonCacheInfo', `🏆 ${(s && s.added) || 0} achievement(s) marked from your latest save`)
})

// Live achievement unlock from the game (WS TRACKER event) — light it up instantly.
api.on('ton:achievement', name => {
  tonUnlock.achievements.add(name); tonUnlock.achievements.add(String(name).toLowerCase())
  if (tonCat === 'achievements') renderTonBoard()
  setText('tonOut', `🏆 Achievement unlocked: ${name}!`)
  setText('tonCacheInfo', `🏆 Unlocked: ${name}`)
})

// Save backups — dated copies of the in-game save code (captured from the WS).
async function loadTonSaves () {
  const list = await api.tonSaves()
  const el = $('tonSavesList'); if (!el) return
  setPill('tonSaveState', list.length > 0, `${list.length} saved`)
  tonFillDiffSelects(list)
  if (!list.length) { el.textContent = 'No saves captured yet — they appear when the game saves, or paste one above to import.'; return }
  el.innerHTML = list.map(s => `<div class="tonSaveRow" data-ts="${s.ts}" title="Tap anywhere to copy this code" style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px;margin:4px 0;border:1px solid var(--line,#333);border-radius:8px;cursor:pointer">
      <span>💾 ${new Date(s.ts).toLocaleString()} <span class="muted">· ${s.length} chars</span></span>
      <button class="btn tonSaveCopy" style="padding:4px 14px;font-size:.74rem;flex:none">Copy</button></div>`).join('')
}
// Populate the A/B decode/diff pickers. Default A = newest, B = next-newest
// (so "Diff A → B" reads newest vs the one before it).
function tonFillDiffSelects (list) {
  const opts = (list || []).map(s => `<option value="${s.ts}">${new Date(s.ts).toLocaleString()} · ${s.length}c</option>`).join('')
  const a = $('tonDiffA'); const b = $('tonDiffB')
  if (a) { a.innerHTML = opts; if (list && list[0]) a.value = String(list[0].ts) }
  if (b) { b.innerHTML = opts; if (list && list[1]) b.value = String(list[1].ts) }
}
// Tap anywhere on a backup row to copy its code to the clipboard (VR-friendly — no
// need to highlight the text).
if ($('tonSavesList')) $('tonSavesList').addEventListener('click', async ev => {
  const row = ev.target.closest('.tonSaveRow'); if (!row) return
  const code = await api.tonSaveCode(Number(row.dataset.ts))
  if (!code) return
  await api.clipboardWrite(code)
  const btn = row.querySelector('.tonSaveCopy')
  if (btn) { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy' }, 1500) }
})
if ($('tonSavesClear')) $('tonSavesClear').addEventListener('click', async () => { await api.tonSavesClear(); loadTonSaves() })
api.on('ton:save', s => { loadTonSaves(); setText('tonCacheInfo', `💾 Save backed up · ${new Date(s.ts).toLocaleTimeString()}`) })

// Switch the board to the achievements view so freshly-applied unlocks are visible.
function tonShowAchievements () {
  document.querySelectorAll('#tonref .tonCat').forEach(x => x.classList.toggle('active', x.dataset.toncat === 'achievements'))
  tonCat = 'achievements'
  renderTonBoard()
}

// Import a pasted save code — then AUTOMATICALLY decode it and mark your achievements
// on the board. One click does everything; the technical tools below are optional.
if ($('tonSaveImportBtn')) $('tonSaveImportBtn').addEventListener('click', async () => {
  const code = ($('tonSaveImport') ? $('tonSaveImport').value : '').trim()
  const msg = $('tonSaveImportMsg')
  if (!code) { if (msg) msg.textContent = 'Paste a code first.'; return }
  if (msg) msg.textContent = 'Reading save…'
  const r = await api.tonSaveImport(code)
  if (!r || !r.ok) { if (msg) msg.textContent = `✗ ${(r && r.error) || 'not a valid save code'}`; return }
  if ($('tonSaveImport')) $('tonSaveImport').value = ''
  loadTonSaves()
  // Auto-decode the achievements from the pasted code and apply matched ones.
  const dec = await api.tonDecodeUnlocks({ code })
  if (!dec || !dec.ok) {
    if (msg) msg.textContent = `✓ Saved (${r.length} chars), but couldn't read achievements.`
    return
  }
  let added = 0
  if (dec.matched && dec.matched.length) {
    const ap = await api.tonApplyUnlocks({ names: dec.matched })
    added = (ap && ap.added) || 0
    await loadTonUnlocks()
    tonShowAchievements()
  }
  const who = dec.name ? ` from ${dec.name}` : ''
  if (msg) msg.textContent = `✓ Imported${who} — ${dec.unlockedCount}/${dec.total} achievements, ${added} newly added to your board.`
})

// Structural decode of save A — exact records → fields, values kept as strings.
if ($('tonDecodeBtn')) $('tonDecodeBtn').addEventListener('click', async () => {
  const out = $('tonDecodeOut'); if (!out) return
  const ts = Number($('tonDiffA') ? $('tonDiffA').value : 0)
  if (!ts) { out.textContent = 'No save selected.'; return }
  const d = await api.tonSaveDecode({ ts })
  if (!d || !d.ok) { out.textContent = `Could not decode (${(d && d.error) || 'error'}).`; return }
  const CAP = 200
  const shown = d.records.slice(0, CAP)
  out.textContent =
    `${d.recordCount} records · ${d.fieldCount} fields · ${d.length} chars\n` +
    `kinds: ${Object.entries(d.counts).map(([k, v]) => `${k}=${v}`).join(' · ')}\n` +
    '(fields are UNLABELED — proprietary format, no public schema)\n\n' +
    JSON.stringify(shown) +
    (d.records.length > CAP ? `\n\n… showing first ${CAP} of ${d.records.length} records` : '')
})

// Diff save A → B: which fields changed (the route to mapping fields to meaning).
if ($('tonDiffBtn')) $('tonDiffBtn').addEventListener('click', async () => {
  const out = $('tonDecodeOut'); if (!out) return
  const tsA = Number($('tonDiffA') ? $('tonDiffA').value : 0)
  const tsB = Number($('tonDiffB') ? $('tonDiffB').value : 0)
  if (!tsA || !tsB) { out.textContent = 'Pick two saves.'; return }
  if (tsA === tsB) { out.textContent = 'Pick two different saves for A and B.'; return }
  const r = await api.tonSaveDiff({ tsA, tsB })
  if (!r || !r.ok) { out.textContent = `Could not diff (${(r && r.error) || 'error'}).`; return }
  const CAP = 400
  const head = `${r.changeCount} field(s) changed  (A: ${r.fieldsA} fields → B: ${r.fieldsB} fields)` +
    `${r.structureChanged ? '  · ⚠ structure differs' : ''}\n\n`
  const lines = r.changes.slice(0, CAP)
    .map(c => `[rec ${c.record}, field ${c.field}]  ${c.a === null ? '∅' : c.a}  →  ${c.b === null ? '∅' : c.b}`)
    .join('\n')
  out.textContent = head + (lines || 'No differences.') +
    (r.changes.length > CAP ? `\n\n… +${r.changes.length - CAP} more` : '')
})

// Decode achievement unlocks from a save (full real decode) → preview → apply to board.
let tonDecodedMatched = null // canonical board names from the last decode, ready to apply
if ($('tonDecodeUnlockBtn')) $('tonDecodeUnlockBtn').addEventListener('click', async () => {
  const sum = $('tonUnlockSummary'); const prev = $('tonUnlockPreview')
  const ts = Number($('tonDiffA') ? $('tonDiffA').value : 0)
  if (!ts) { if (sum) sum.textContent = 'No save selected (pick save A above).'; return }
  const r = await api.tonDecodeUnlocks({ ts })
  tonDecodedMatched = null
  if ($('tonApplyUnlockBtn')) $('tonApplyUnlockBtn').disabled = true
  if (!r || !r.ok) { if (sum) sum.textContent = `Could not decode (${(r && r.error) || 'error'}).`; if (prev) prev.innerHTML = ''; return }
  tonDecodedMatched = r.matched
  if (sum) {
    const who = r.name ? ` · save owner: <b>${tonEsc(r.name)}</b>` : ''
    const chk = r.checksumOk ? '' : ' <span style="color:var(--bad,#e66)">⚠ checksum failed</span>'
    sum.innerHTML = `<b>${r.unlockedCount}/${r.total}</b> achievements unlocked${who}${chk} · ` +
      `${r.matched.length} match the board${r.unmatched.length ? ` · ${r.unmatched.length} name mismatch` : ''}.`
  }
  if (prev) {
    prev.innerHTML = r.preview.map(p =>
      `<div style="padding:2px 0;${p.onBoard ? '' : 'opacity:.5'}">${p.onBoard ? '✓' : '·'} ${tonEsc(p.name)}${p.onBoard ? '' : ' <span class="muted">(not on board)</span>'}</div>`
    ).join('')
  }
  if ($('tonApplyUnlockBtn')) $('tonApplyUnlockBtn').disabled = !r.matched.length
})
if ($('tonApplyUnlockBtn')) $('tonApplyUnlockBtn').addEventListener('click', async () => {
  if (!tonDecodedMatched || !tonDecodedMatched.length) return
  const r = await api.tonApplyUnlocks({ names: tonDecodedMatched })
  const sum = $('tonUnlockSummary')
  if (r && r.ok) {
    await loadTonUnlocks()
    // jump to the achievements board so the user sees the result light up
    document.querySelectorAll('#tonref .tonCat').forEach(x => x.classList.toggle('active', x.dataset.toncat === 'achievements'))
    tonCat = 'achievements'
    renderTonBoard()
    if (sum) sum.innerHTML += `<br><b>✓ Applied — ${r.added} newly marked on the board.</b>`
  } else if (sum) {
    sum.innerHTML += `<br>✗ ${(r && r.error) || 'apply failed'}`
  }
})

// Catch up the lifetime-stat milestone achievements from the latest ToNSaveManager stats.
if ($('tonStatsCatchup')) $('tonStatsCatchup').addEventListener('click', async () => {
  const s = await api.tonGet()
  renderTonStats(s)
  renderTonAchievements(s)
  const done = TON_ACHIEVEMENTS.filter(a => (a.val(s) || 0) >= a.goal).length
  const msg = $('tonStatsCatchupMsg')
  if (msg) {
    msg.textContent = (s.connected || s.rounds)
      ? `✓ ${done}/${TON_ACHIEVEMENTS.length} milestones from lifetime stats`
      : 'Connect to ToNSaveManager first to pull your stats'
  }
})

// Manage the ToNSaveManager app (download / run / stop / update in the background).
async function loadTonMgr () {
  const s = await api.tonMgrStatus()
  const label = !s.installed ? 'not installed' : (s.running ? 'running' : 'stopped')
  setPill('tonMgrState', s.installed && s.running, label, label)
}
function tonMgrBusy (id, txt) { const b = $(id); if (b) { b.disabled = true; b.dataset.t = b.textContent; b.textContent = txt } }
function tonMgrDone (id) { const b = $(id); if (b) { b.disabled = false; if (b.dataset.t) b.textContent = b.dataset.t } }
if ($('tonMgrInstall')) $('tonMgrInstall').addEventListener('click', async () => { tonMgrBusy('tonMgrInstall', 'Downloading…'); const r = await api.tonMgrInstall(); tonMgrDone('tonMgrInstall'); setText('tonCacheInfo', r.ok ? '✅ ToNSaveManager installed' : 'Install failed: ' + r.error); loadTonMgr() })
if ($('tonMgrUpdate')) $('tonMgrUpdate').addEventListener('click', async () => { tonMgrBusy('tonMgrUpdate', 'Updating…'); const r = await api.tonMgrUpdate(); tonMgrDone('tonMgrUpdate'); setText('tonCacheInfo', r.ok ? '✅ ToNSaveManager updated' : 'Update failed: ' + r.error); loadTonMgr() })
if ($('tonMgrStart')) $('tonMgrStart').addEventListener('click', async () => { const r = await api.tonMgrStart(); setText('tonCacheInfo', r.ok ? '▶ ToNSaveManager started' : 'Start failed: ' + r.error); setTimeout(loadTonMgr, 1500); setTimeout(tonEnsureConnected, 2500) })
if ($('tonMgrStop')) $('tonMgrStop').addEventListener('click', async () => { await api.tonMgrStop(); setText('tonCacheInfo', '■ ToNSaveManager stopped'); setTimeout(loadTonMgr, 800) })
if ($('tonMgrAuto')) $('tonMgrAuto').addEventListener('change', e => api.tonMgrSetAuto(e.target.checked))
api.on('tonmgr:status', () => loadTonMgr())

// ToN alerts (vrnotications: VR overlay ↔ Windows toast)
async function loadTonNotify () {
  const c = await api.tonNotifyGet()
  if ($('tonNotify')) $('tonNotify').checked = !!c.enabled
  if ($('tonNotifyTerrors')) $('tonNotifyTerrors').checked = !!c.terrors
  if ($('tonNotifyMode')) $('tonNotifyMode').value = c.mode || 'auto'
  api.tonNotifyDetect().then(d => { if ($('tonNotifyDetect')) setText('tonNotifyDetect', `detected: ${d.xsoverlay ? 'XSOverlay ' : ''}${d.ovrtoolkit ? 'OVRToolkit ' : ''}${d.steamvr ? 'SteamVR' : ''}`.trim() || 'detected: desktop (no VR)') })
}
function saveTonNotify () { api.tonNotifySet({ enabled: $('tonNotify').checked, terrors: $('tonNotifyTerrors').checked, mode: $('tonNotifyMode').value }) }
if ($('tonNotify')) $('tonNotify').addEventListener('change', saveTonNotify)
if ($('tonNotifyTerrors')) $('tonNotifyTerrors').addEventListener('change', saveTonNotify)
if ($('tonNotifyMode')) $('tonNotifyMode').addEventListener('change', saveTonNotify)
if ($('tonNotifyTest')) $('tonNotifyTest').addEventListener('click', async () => { const b = $('tonNotifyTest'); b.textContent = 'Sent ✓'; await api.tonNotifyTest(); setTimeout(() => { b.textContent = 'Test' }, 1500) })

const tonRefBtn = document.querySelector('[data-tab="tonref"]')
if (tonRefBtn) tonRefBtn.addEventListener('click', () => {
  tonEnsureConnected() // auto-connect the WS when viewing Terrors; module retries until connected
  loadTonCache(); loadTonPlayer(); loadTonSaves(); loadTonMgr(); loadTonNotify()
  api.tonMgrGetAuto().then(v => { if ($('tonMgrAuto')) $('tonMgrAuto').checked = !!v })
})

api.on('vr:update', s => {
  setPill('vrState', s.available, 'on')
  setText('vrOut', s.available ? s.devices.map(d => `${d.role}: ${Math.round(d.battery * 100)}%`).join(' · ') : 'No VR devices — needs a VR headset + SteamVR running (does not work on desktop).')
})
$('enableVr').addEventListener('change', e => { e.target.checked ? api.vrStart() : api.vrStop(); api.saveSetting('vrEnabled', e.target.checked) })

/* ---------------- VR overlay (experimental) ---------------- */
function renderVrOverlayState (running, error) {
  setPill('vrOverlayState', running, 'on')
  $('vrOverlayToggle').textContent = running ? 'Stop VR overlay' : 'Start VR overlay'
  setText('vrOverlayOut', error ? `Error: ${error}` : (running ? 'Running — check your headset.' : 'Stopped'))
}
api.on('vrOverlay:status', s => renderVrOverlayState(!!s.running, s.error))
$('vrOverlayToggle').addEventListener('click', async () => {
  $('vrOverlayToggle').disabled = true
  try {
    const running = await api.vrOverlayIsRunning()
    if (running) {
      await api.vrOverlayStop()
      renderVrOverlayState(false)
    } else {
      setText('vrOverlayOut', 'Starting…')
      const result = await api.vrOverlayStart()
      if (!result?.ok) renderVrOverlayState(false, result?.error || 'Could not start the VR overlay.')
      else renderVrOverlayState(true)
    }
  } finally {
    $('vrOverlayToggle').disabled = false
  }
})

/* ---------------- discord ---------------- */
let discordAccessToken = ''
function currentDiscordCfg () {
  return {
    clientId: DEFAULT_DISCORD_APP_ID, // fixed — see DEFAULT_DISCORD_APP_ID comment
    clientSecret: $('discordSecret').value,
    accessToken: discordAccessToken,
    enableRichPresence: $('discordRP').checked,
    enableVoice: $('discordVoice').checked,
    sendVoiceStateOsc: $('discordVoiceOsc').checked,
    sendMuteDeafenOsc: $('discordMuteOsc').checked,
    vrcStatus: $('discordVrcStatus').value,
    showWorld: $('discordShowWorld').checked,
    vrcProfileUrl: $('discordVrcProfile').value.trim(),
    showHeartRate: $('discordShowHr').checked,
    showNowPlaying: $('discordShowNp').checked
  }
}
$('discordStart').addEventListener('click', async () => {
  const cfg = currentDiscordCfg()
  await api.saveSetting('discord', cfg)
  setText('discordOut', 'Connecting...')
  const r = await api.discordStart(cfg)
  setPill('discordState', r.ok, r.voice ? 'voice' : 'on')
  if (!r.ok) setText('discordOut', 'Error: ' + (r.error || 'failed'))
  else if (r.note) setText('discordOut', r.note) // e.g. voice needs allowlist
})
$('discordStop').addEventListener('click', async () => { await api.discordStop(); setPill('discordState', false); setText('discordOut', 'Not connected') })
;['discordRP', 'discordVoice', 'discordVoiceOsc', 'discordMuteOsc'].forEach(id =>
  $(id).addEventListener('change', () => api.saveSetting('discord', currentDiscordCfg())))

// VRChat status / world-visibility / presence-content changes apply instantly.
;['discordVrcStatus', 'discordShowWorld', 'discordVrcProfile', 'discordShowHr', 'discordShowNp'].forEach(id =>
  $(id).addEventListener('change', () => {
    const cfg = currentDiscordCfg()
    api.saveSetting('discord', cfg)
    api.discordVrc({ vrcStatus: cfg.vrcStatus, showWorld: cfg.showWorld, vrcProfileUrl: cfg.vrcProfileUrl, showHeartRate: cfg.showHeartRate, showNowPlaying: cfg.showNowPlaying })
  }))

// Live world readout + radar from the VRChat log tracker. NOTE: this fires every
// few seconds — only touch the DOM when something actually changed (perf).
let _lastLoc = ''
let _lastRadarSig = ''
function applyWorld (w) {
  if (w && w.inWorld && w.worldName) setText('discordWorldOut', `World: ${w.worldName}`)
  else if (w && w.inWorld) setText('discordWorldOut', 'World: (joining…)')
  else setText('discordWorldOut', 'World: not in a world')
  renderRadar(w)
  if (w) {
    composer.update({ players: (w.players || []).length })
    const loc = (w.worldId && w.instanceId) ? `${w.worldId}:${w.instanceId}` : ''
    window.__myLocation = loc
    if ($('rbWorld')) {
      setText('rbWorld', w.inWorld ? (w.worldName || 'In a world') : 'Not in a world')
      setText('rbInstCount', w.inWorld ? `${(w.players || []).length} player(s) in instance` : '—')
    }
    // Re-render the friends panel only when our instance actually changes.
    if (loc !== _lastLoc) { _lastLoc = loc; if (typeof renderRightbar === 'function' && rbFriendsCache.online && rbFriendsCache.online.length) renderRightbar() }
  }
}
api.on('vrc:world', applyWorld)
// Prime the world/radar from the current log on startup (the live event fires in the
// main process before this window is listening, so fetch the current state directly).
api.vrcGet().then(w => { if (w) applyWorld(w) }).catch(() => {})
function renderRadar (w) {
  const players = (w && w.players) || []
  const sig = (w && w.inWorld ? '1' : '0') + ':' + players.join('|')
  if (sig === _lastRadarSig) return // nothing changed — skip DOM work
  _lastRadarSig = sig
  setText('radarCount', String(players.length))
  const el = $('radarList'); if (!el) return
  if (!w || !w.inWorld) { el.textContent = 'Not in a world.' } else if (!players.length) { el.textContent = 'No other players detected.' } else {
    el.innerHTML = players.map(p => `<div style="padding:2px 0">🧍 ${p.replace(/</g, '&lt;')}</div>`).join('')
  }
}

/* ---------------- tools: stopwatch ---------------- */
let swRunning = false; let swAccum = 0; let swStart = 0; let swTick = 0
const swElapsed = () => swAccum + (swRunning ? Date.now() - swStart : 0)
function fmtSw (ms) {
  const t = Math.max(0, ms)
  const h = Math.floor(t / 3600000); const m = Math.floor(t % 3600000 / 60000)
  const s = Math.floor(t % 60000 / 1000); const d = Math.floor(t % 1000 / 100)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}
setInterval(() => {
  if (!swRunning) return // idle — don't touch the DOM 10×/sec
  setText('swDisplay', fmtSw(swElapsed()))
  // Live-post once a second (10th 100ms tick) to respect VRChat's chatbox rate.
  if ($('swLiveChatbox').checked && (++swTick % 10 === 0)) sendChatboxMessage(`⏱ ${fmtSw(swElapsed())}`, false)
}, 100)
$('swStartStop').addEventListener('click', () => {
  if (swRunning) { swAccum = swElapsed(); swRunning = false; $('swStartStop').textContent = 'Start'; setText('swOut', 'Paused') } else { swStart = Date.now(); swRunning = true; $('swStartStop').textContent = 'Stop'; setText('swOut', 'Running') }
})
$('swReset').addEventListener('click', () => { swRunning = false; swAccum = 0; $('swStartStop').textContent = 'Start'; setText('swDisplay', fmtSw(0)); setText('swOut', 'Stopped') })
$('swSend').addEventListener('click', () => { const v = `⏱ ${fmtSw(swElapsed())}`; sendChatboxMessage(v, false); logLine(`OUT chatbox: ${v}`) })

/* ---------------- tools: calculator ---------------- */
let _mathEval = null
function calcEval () {
  const expr = $('calcInput').value.trim()
  if (!expr) return
  try {
    if (!_mathEval) _mathEval = require('mathjs').evaluate
    setText('calcResult', String(_mathEval(expr)))
  } catch (_) { setText('calcResult', 'Error') }
}
$('calcEval').addEventListener('click', calcEval)
$('calcInput').addEventListener('keydown', e => { if (e.key === 'Enter') calcEval() })
$('calcClear').addEventListener('click', () => { $('calcInput').value = ''; setText('calcResult', '0') })
$('calcSend').addEventListener('click', () => { const v = `${$('calcInput').value} = ${$('calcResult').textContent}`; sendChatboxMessage(v, false); logLine(`OUT chatbox: ${v}`) })

/* ---------------- tools: Param Lab ---------------- */
$('paramSend').addEventListener('click', () => {
  const addr = $('paramAddr').value.trim()
  if (!addr) { setText('paramOut', 'Enter a parameter address.'); return }
  const type = $('paramType').value
  const raw = $('paramValue').value.trim()
  let val = raw
  if (type === 'bool') val = /^(1|true|on|yes|t)$/i.test(raw)
  else if (type === 'int') val = parseInt(raw, 10) || 0
  else val = Number(raw) || 0
  try { sendParam(addr, val, type); setText('paramOut', `Sent ${type} ${addr} = ${val}`); logLine(`OUT ${addr} ${val}`) } catch (e) { setText('paramOut', 'Error: ' + e.message) }
})

/* ---------------- tools: ToN Tablet OSC ---------------- */
function renderTonOscParams (params) {
  if (!params || !params.length) { setText('tonOscOut', ''); return }
  $('tonOscOut').textContent = params.map(p => `${p.name} = ${p.value}`).join('\n')
}
async function loadTonOsc () {
  const st = await api.tonOscGet()
  $('tonOscEnable').checked = !!st.enabled
  renderTonOscParams(st.params)
}
$('tonOscEnable').addEventListener('change', async e => {
  const st = await api.tonOscSet(e.target.checked)
  renderTonOscParams(st.params)
})
$('tonOscRefresh').addEventListener('click', async () => { const sent = await api.tonOscResync(); renderTonOscParams(sent && sent.length ? sent : (await api.tonOscGet()).params) })
$('tonOscRaw').addEventListener('click', async () => {
  const raw = await api.tonOscRaw()
  $('tonOscOut').textContent = (raw || []).slice(0, 25).map(r => {
    const t = new Date(r.at).toLocaleTimeString()
    return `${t}  ${JSON.stringify(r.msg)}`
  }).join('\n') || 'No ToN WebSocket messages yet — connect ToNSaveManager and join a round.'
})
document.querySelector('[data-tab="tonref"]').addEventListener('click', loadTonOsc)

/* ---------------- OSC companion apps ---------------- */
let removeRealisticLeashListener = null
let realisticLeashLoaded = false
let oscQrLoaded = false
let shazamOscLoaded = false

function renderOscQrHistory (history = []) {
  $('oscQrHistory').innerHTML = history.length
    ? history.map(item => `<div class="section-note" style="padding:4px 0;border-bottom:1px solid var(--border)"><b>${item.spotify ? 'Spotify' : 'QR'}</b> · ${new Date(item.at).toLocaleTimeString()}<br>${esc(item.data)}</div>`).join('')
    : '<div class="section-note">No QR codes detected.</div>'
}

const oscQr = new OscQrController({
  sendParam: (address, value, type) => sendParam(address, value, type),
  onDetected: item => {
    if ($('oscQrChatbox').checked) sendChatboxMessage(`QR: ${item.data}`.slice(0, 144), false)
  },
  onUpdate: state => {
    setPill('oscQrState', state.enabled, 'scanning', 'off')
    setText('oscQrOut', state.error ? `Error: ${state.error}` : `${state.status}${state.lastData ? ` · ${state.lastData.slice(0, 80)}` : ''}`)
    renderOscQrHistory(state.history)
    if (state.event === 'detected' || state.event === 'history-cleared') api.saveSetting('oscApps.oscQrHistory', state.history)
  }
})

function oscQrConfig () {
  return {
    intervalMs: Number($('oscQrInterval').value) || 500,
    saveHistory: $('oscQrSaveHistory').checked
  }
}

function saveOscQrConfig () {
  const config = { ...oscQrConfig(), toChatbox: $('oscQrChatbox').checked }
  oscQr.configure(config)
  api.saveSetting('oscApps.oscQr', config)
}

async function restoreOscQr () {
  if (oscQrLoaded) return
  oscQrLoaded = true
  const saved = await api.getSetting('oscApps.oscQr', { intervalMs: 500, saveHistory: true, toChatbox: false })
  const history = await api.getSetting('oscApps.oscQrHistory', [])
  $('oscQrInterval').value = saved.intervalMs || 500
  $('oscQrSaveHistory').checked = saved.saveHistory !== false
  $('oscQrChatbox').checked = !!saved.toChatbox
  oscQr.configure({ ...saved, history })
  renderOscQrHistory(history)
}

function renderShazamHistory (saved = []) {
  $('shazamHistory').innerHTML = saved.length
    ? saved.map(song => `<div class="section-note" style="padding:4px 0;border-bottom:1px solid var(--border)"><b>${esc(song.artist || 'Unknown')}</b> — ${esc(song.title || 'Unknown')} <span class="muted">${esc(song.provider || '')}</span>${song.song_link ? `<br><button class="btn ghost shazam-open" data-url="${encodeURIComponent(song.song_link)}" style="padding:2px 7px;font-size:.68rem">Open song</button>` : ''}</div>`).join('')
    : '<div class="section-note">No recognized songs yet.</div>'
}

const shazamOsc = new ShazamOscController({
  sendParam: (address, value, type) => sendParam(address, value, type),
  recognize: request => api.oscAppsRecognizeSong(request),
  onRecognized: (match, config) => {
    if (config.toChatbox) sendChatboxMessage(`🎶 ${match.artist || 'Unknown'} — ${match.title || 'Unknown'}`.slice(0, 144), false)
  },
  onUpdate: state => {
    setPill('shazamOscState', state.live || state.busy || state.sharing, state.live ? 'live' : state.busy ? 'listening' : 'ready', 'ready')
    setText('shazamOut', state.error ? `Error: ${state.error}` : state.status)
    $('shazamLive').checked = state.live
    renderShazamHistory(state.saved)
    if (['recognized', 'saved-cleared'].includes(state.event)) api.saveSetting('oscApps.shazamHistory', state.saved)
  }
})

function shazamConfig () {
  return {
    provider: $('shazamProvider').value,
    token: $('shazamToken').value.trim(),
    acrHost: $('shazamAcrHost').value.trim(),
    acrAccessKey: $('shazamAcrKey').value.trim(),
    acrAccessSecret: $('shazamAcrSecret').value.trim(),
    clipSeconds: 10,
    liveSeconds: Number($('shazamLiveInterval').value) || 25,
    toChatbox: $('shazamChatbox').checked
  }
}

function saveShazamConfig () {
  const config = shazamConfig()
  shazamOsc.configure(config)
  api.saveSetting('oscApps.shazam', config)
}

async function restoreShazamOsc () {
  if (shazamOscLoaded) return
  shazamOscLoaded = true
  const saved = await api.getSetting('oscApps.shazam', { provider: 'auto', token: '', acrHost: '', acrAccessKey: '', acrAccessSecret: '', clipSeconds: 10, liveSeconds: 25, toChatbox: false })
  const history = await api.getSetting('oscApps.shazamHistory', [])
  $('shazamProvider').value = ['auto', 'audd', 'acrcloud', 'node-shazam'].includes(saved.provider) ? saved.provider : 'auto'
  $('shazamToken').value = saved.token || ''
  $('shazamAcrHost').value = saved.acrHost || ''
  $('shazamAcrKey').value = saved.acrAccessKey || ''
  $('shazamAcrSecret').value = saved.acrAccessSecret || ''
  $('shazamLiveInterval').value = saved.liveSeconds || 25
  $('shazamChatbox').checked = !!saved.toChatbox
  shazamOsc.configure({ ...saved, saved: history })
  renderShazamHistory(history)
  try {
    const providers = await api.oscAppsRecognitionProviders()
    setText('shazamProviderState', `AudD SDK ready · ACRCloud ready · node-shazam ${providers.nodeShazam ? 'available' : 'not installed (optional GPL-2.0 fallback)'}`)
  } catch (err) { setText('shazamProviderState', `Provider check failed: ${err.message}`) }
}
const realisticLeash = new RealisticOscLeashController({
  sendInput: (address, value, type) => sendParam(address, value, type),
  onUpdate: state => {
    setPill('realLeashState', state.enabled, 'on', 'off')
    setText('realLeashOut', `${state.directionLabel}${state.event.startsWith('jump') || state.event === 'jump' ? ' · jump triggered' : ''}`)
  }
})

let oscDigitalClockLoaded = false
const oscDigitalClock = new OscDigitalClock({
  sendParam: (address, value, type) => sendParam(address, value, type),
  onUpdate: state => {
    setPill('oscClockState', state.enabled, 'sending', 'off')
    const raw = state.values.raw
    const encoded = state.values.encoded
    const status = `${raw.MonthF}/${raw.DayF} ${String(raw.HourF).padStart(2, '0')}:${String(raw.MinuteF).padStart(2, '0')} · M ${encoded.MonthF} · D ${encoded.DayF} · H ${encoded.HourF} · Min ${encoded.MinuteF} · DOW ${encoded.DOWF}`
    setText('oscClockOut', state.lastError ? `Error: ${state.lastError}` : status)
  }
})

function oscDigitalClockConfig () {
  return {
    enabled: $('oscClockEnable').checked,
    intervalSeconds: Number($('oscClockInterval').value) || 10,
    legacyDoW: $('oscClockLegacyDow').checked,
    vrcoscClock: $('oscClockVrcosc').checked,
    clock24Hour: $('oscClock24Hour').checked,
    dateTimeInts: $('oscClockDateTimeInts').checked
  }
}

function applyOscDigitalClock (save = true) {
  const config = oscDigitalClockConfig()
  oscDigitalClock.configure(config)
  oscDigitalClock.setEnabled(config.enabled)
  if (save) api.saveSetting('oscApps.digitalClock', config)
}

async function restoreOscDigitalClock () {
  if (oscDigitalClockLoaded) return
  oscDigitalClockLoaded = true
  const saved = await api.getSetting('oscApps.digitalClock', { enabled: false, intervalSeconds: 10, legacyDoW: true, vrcoscClock: true, clock24Hour: false, dateTimeInts: true })
  $('oscClockEnable').checked = !!saved.enabled
  $('oscClockInterval').value = saved.intervalSeconds || 10
  $('oscClockLegacyDow').checked = saved.legacyDoW !== false
  $('oscClockVrcosc').checked = saved.vrcoscClock !== false
  $('oscClock24Hour').checked = !!saved.clock24Hour
  $('oscClockDateTimeInts').checked = saved.dateTimeInts !== false
  applyOscDigitalClock(false)
}

function realisticLeashConfig () {
  return {
    enabled: $('realLeashEnable').checked,
    strength: Number($('realLeashStrength').value) || 1,
    run: $('realLeashRun').checked,
    jumpQAction: $('realLeashJumpQ').value
  }
}

function applyRealisticLeash (save = true) {
  const config = realisticLeashConfig()
  realisticLeash.configure(config)
  if (config.enabled && !removeRealisticLeashListener) removeRealisticLeashListener = addOscListener((address, args) => realisticLeash.handleOsc(address, args), getRecvPort())
  if (!config.enabled && removeRealisticLeashListener) { removeRealisticLeashListener(); removeRealisticLeashListener = null }
  realisticLeash.setEnabled(config.enabled)
  if (save) api.saveSetting('oscApps.realisticLeash', config)
}

async function restoreRealisticLeash () {
  if (realisticLeashLoaded) return
  realisticLeashLoaded = true
  const saved = await api.getSetting('oscApps.realisticLeash', { enabled: false, strength: 1, run: false, jumpQAction: 'ignore' })
  $('realLeashEnable').checked = !!saved.enabled
  $('realLeashStrength').value = saved.strength || 1
  $('realLeashRun').checked = !!saved.run
  $('realLeashJumpQ').value = ['ignore', 'jump', 'forward', 'right'].includes(saved.jumpQAction) ? saved.jumpQAction : 'ignore'
  applyRealisticLeash(false)
}

function ruskOptions () {
  return {
    logDirectory: $('ruskLogDirectory').value.trim(),
    scanExisting: $('ruskScanExisting').checked,
    features: Object.fromEntries([...document.querySelectorAll('[data-rusk-feature]')].map(input => [input.dataset.ruskFeature, input.checked]))
  }
}

function renderRuskState (state) {
  if (!state) return
  setPill('ruskState', !!state.running, 'running', 'off')
  if (state.logDirectory && !$('ruskLogDirectory').value) $('ruskLogDirectory').value = state.logDirectory
  const values = state.values || {}
  const held = [values.pistol && 'Pistol', values.fire && 'Fire', values.weld && 'Welder', values.duoRight && 'Duo R', values.duoLeft && 'Duo L', values.aviWeapon && 'Avi weapon', values.uasrfWeapon && 'UASRF weapon'].filter(Boolean)
  setText('ruskValues', `Dead: ${!!values.dead} · Team: ${values.team || 0} · ${held.length ? held.join(', ') : 'no pickups held'}`)
  const logName = state.currentLog ? state.currentLog.split(/[\\/]/).pop() : 'waiting for a VRChat output log'
  setText('ruskOut', state.lastError ? `Error: ${state.lastError}` : `${state.running ? 'Watching' : 'Stopped'} · ${logName}`)
}

function twitchInteractiveOptions () {
  return {
    parameter: $('twitchInteractiveParameter').value.trim() || 'twitch',
    pulseMs: Math.max(100, Number($('twitchInteractivePulse').value) || 750),
    mappings: $('twitchInteractiveMappings').value,
    enabled: true
  }
}

function renderTwitchInteractive (state = {}) {
  setPill('twitchInteractiveState', !!state.running, state.running ? 'running' : 'off', 'off')
  const connections = state.running
    ? `Chat ${state.chatConnected ? 'connected' : 'connecting'} · Rewards ${state.rewardsConnected ? 'connected' : 'connecting'}`
    : 'Stopped'
  const last = state.lastTrigger
    ? ` · Last: ${state.lastTrigger.source} ${state.lastTrigger.match} → ${state.lastTrigger.value}${state.lastTrigger.user ? ` by ${state.lastTrigger.user}` : ''}`
    : ''
  setText('twitchInteractiveOut', state.error ? `Error: ${state.error}` : connections + last)
}

async function restoreTwitchInteractive (autoStart) {
  try {
    const state = await api.oscAppsTwitchInteractiveGet()
    const saved = state.saved || {}
    $('twitchInteractiveParameter').value = saved.parameter || 'twitch'
    $('twitchInteractivePulse').value = saved.pulseMs || 750
    $('twitchInteractiveMappings').value = saved.mappings || ''
    renderTwitchInteractive(state)
    if (autoStart && saved.enabled && !state.running) {
      try { renderTwitchInteractive(await api.oscAppsTwitchInteractiveStart(saved)) } catch (err) { setText('twitchInteractiveOut', `Error: ${err.message}`) }
    }
  } catch (err) { setText('twitchInteractiveOut', `Error: ${err.message}`) }
}

async function loadOscApps () {
  await restoreRealisticLeash()
  await restoreOscDigitalClock()
  await restoreOscQr()
  await restoreShazamOsc()
  await loadOscCaptureSources()
  await restoreTwitchInteractive(false)
  try {
    const rusk = await api.oscAppsRuskGet()
    const saved = rusk.saved || {}
    $('ruskLogDirectory').value = saved.logDirectory || rusk.logDirectory || ''
    $('ruskScanExisting').checked = !!saved.scanExisting
    document.querySelectorAll('[data-rusk-feature]').forEach(input => { input.checked = saved.features?.[input.dataset.ruskFeature] !== false })
    renderRuskState(rusk)
  } catch (err) { setText('ruskOut', `Error: ${err.message}`) }
}

$('ruskStart').addEventListener('click', async () => {
  try { renderRuskState(await api.oscAppsRuskStart(ruskOptions())) } catch (err) { setText('ruskOut', `Error: ${err.message}`) }
})
$('ruskStop').addEventListener('click', async () => { try { renderRuskState(await api.oscAppsRuskStop()) } catch (err) { setText('ruskOut', `Error: ${err.message}`) } })
api.on('oscApps:ruskUpdate', renderRuskState)
// Rusk/Twitch Interactive settings previously only persisted as a side
// effect of clicking Start - editing a field while already running (or
// before ever starting) had no way to save. Autosave the fields directly,
// preserving whatever "enabled" state is already stored so a field edit
// alone can never flip the feature to auto-start on next launch.
async function saveRuskOptionsOnly () {
  const current = await api.getSetting('oscApps.ruskLaserdome', {})
  await api.saveSetting('oscApps.ruskLaserdome', { ...current, ...ruskOptions(), enabled: current.enabled })
}
;['ruskLogDirectory', 'ruskScanExisting'].forEach(id => $(id).addEventListener('change', saveRuskOptionsOnly))
document.querySelectorAll('[data-rusk-feature]').forEach(input => input.addEventListener('change', saveRuskOptionsOnly))

$('twitchInteractiveStart').addEventListener('click', async () => {
  try {
    setText('twitchInteractiveOut', 'Connecting to Twitch chat and rewards…')
    renderTwitchInteractive(await api.oscAppsTwitchInteractiveStart(twitchInteractiveOptions()))
  } catch (err) { setText('twitchInteractiveOut', `Error: ${err.message}`) }
})
$('twitchInteractiveStop').addEventListener('click', async () => renderTwitchInteractive(await api.oscAppsTwitchInteractiveStop()))
api.on('oscApps:twitchInteractiveUpdate', renderTwitchInteractive)
async function saveTwitchInteractiveOptionsOnly () {
  const current = await api.getSetting('oscApps.twitchInteractive', {})
  await api.saveSetting('oscApps.twitchInteractive', { ...current, ...twitchInteractiveOptions(), enabled: current.enabled })
}
;['twitchInteractiveParameter', 'twitchInteractivePulse', 'twitchInteractiveMappings'].forEach(id => $(id).addEventListener('change', saveTwitchInteractiveOptionsOnly))
;['realLeashEnable', 'realLeashStrength', 'realLeashRun', 'realLeashJumpQ'].forEach(id => $(id).addEventListener('change', () => applyRealisticLeash(true)))
;['oscClockEnable', 'oscClockInterval', 'oscClockLegacyDow', 'oscClockVrcosc', 'oscClock24Hour', 'oscClockDateTimeInts'].forEach(id => $(id).addEventListener('change', () => applyOscDigitalClock(true)))
$('oscClockSync').addEventListener('click', () => oscDigitalClock.syncNow())
$('oscQrStart').addEventListener('click', async () => { saveOscQrConfig(); await oscQr.start() })
$('oscQrStop').addEventListener('click', () => oscQr.stop())
$('oscQrClear').addEventListener('click', () => oscQr.clearHistory())
;['oscQrInterval', 'oscQrChatbox', 'oscQrSaveHistory'].forEach(id => $(id).addEventListener('change', saveOscQrConfig))
$('shazamRecognize').addEventListener('click', async () => { saveShazamConfig(); await shazamOsc.recognizeNow() })
$('shazamStop').addEventListener('click', () => shazamOsc.stopAudio())
$('shazamLive').addEventListener('change', async e => { saveShazamConfig(); await shazamOsc.setLive(e.target.checked) })
;['shazamProvider', 'shazamToken', 'shazamAcrHost', 'shazamAcrKey', 'shazamAcrSecret', 'shazamLiveInterval', 'shazamChatbox'].forEach(id => $(id).addEventListener('change', saveShazamConfig))
$('shazamDashboard').addEventListener('click', () => api.openExternal($('shazamProvider').value === 'acrcloud' ? 'https://console.acrcloud.com/' : 'https://dashboard.audd.io/'))
$('shazamHistory').addEventListener('click', e => { const button = e.target.closest('.shazam-open'); if (button) api.openExternal(decodeURIComponent(button.dataset.url)) })
$('oscAppsCaptureRefresh').addEventListener('click', loadOscCaptureSources)
$('oscAppsCaptureSource').addEventListener('change', async e => {
  await api.oscAppsSelectCaptureSource(e.target.value)
  await api.saveSetting('oscApps.captureSource', e.target.value)
})
document.querySelector('[data-tab="oscapps"]').addEventListener('click', loadOscApps)

async function loadOscCaptureSources () {
  try {
    const saved = await api.getSetting('oscApps.captureSource', '')
    const result = await api.oscAppsCaptureSources()
    const select = $('oscAppsCaptureSource')
    select.innerHTML = '<option value="">Primary display</option>' + result.sources.map(source => `<option value="${source.id.replace(/"/g, '&quot;')}">${esc(source.name)}</option>`).join('')
    const selected = result.sources.some(source => source.id === saved) ? saved : result.selected
    select.value = result.sources.some(source => source.id === selected) ? selected : ''
    await api.oscAppsSelectCaptureSource(select.value)
    // Main resolves with an `error` field (rather than rejecting) when the
    // OS/compositor never returned a capture list (e.g. no Wayland portal) -
    // still falls back to "Primary display" above, but surface why nothing
    // else showed up instead of silently looking like there's just one screen.
    setText('oscQrOut', result.error ? `Could not list capture sources: ${result.error}` : '')
  } catch (err) { setText('oscQrOut', `Could not list capture sources: ${err.message}`) }
}

/* ---------------- tools: Emerald Sound System (rf_ESS) ---------------- */
function essSend (name, value, type) { try { sendParam('/avatar/parameters/rf_ESS/' + name, value, type) } catch (_) {} }
$('essAudio').addEventListener('change', e => { essAudioReactive = e.target.checked; api.saveSetting('essAudioReactive', essAudioReactive); setText('essOut', essAudioReactive ? 'rf_ESS/Float follows audio.' : 'Audio-reactive off.') })
$('essFloat').addEventListener('input', e => {
  const v = Number(e.target.value)
  setText('essFloatVal', v.toFixed(2))
  if (!essAudioReactive) essSend('Float', v, 'float') // manual only matters when not audio-driven
})
document.querySelectorAll('.ess-bool').forEach(cb => cb.addEventListener('change', () => {
  essSend(cb.dataset.ess, cb.checked, 'bool')
  setText('essOut', `rf_ESS/${cb.dataset.ess} = ${cb.checked}`)
}))

/* ---------------- tools: Photo Relay ---------------- */
function applyPhotoRelay () {
  const cfg = { enabled: $('photoRelayEnable').checked, webhook: $('photoWebhook').value.trim() }
  api.saveSetting('photoRelay', cfg)
  api.photoRelaySet(cfg)
  setText('photoRelayOut', cfg.enabled ? (cfg.webhook ? 'Watching for new VRChat photos…' : 'Enter a webhook URL.') : 'Off')
}
;['photoRelayEnable', 'photoWebhook'].forEach(id => $(id).addEventListener('change', applyPhotoRelay))
api.on('photoRelay:event', s => {
  if (s.sent) setText('photoRelayOut', '✅ Sent ' + s.sent)
  else if (s.error) setText('photoRelayOut', 'Error: ' + s.error)
  else if (s.watching) setText('photoRelayOut', 'Watching for new VRChat photos…')
})

/* ---------------- tools: Screenshot Metadata (VRCX-style) ---------------- */
if ($('screenshotMetaEnable')) {
  $('screenshotMetaEnable').addEventListener('change', async e => {
    const enabled = e.target.checked
    api.saveSetting('screenshotMetadata', enabled)
    await api.screenshotMetadataSet(enabled)
    setText('screenshotMetaOut', enabled ? 'Watching for new VRChat photos…' : 'Off')
  })
}

/* ---------------- tools: auto-afk ---------------- */
function afkCfg () {
  return {
    enabled: $('afkEnable').checked,
    thresholdSec: parseInt($('afkThreshold').value, 10) || 120,
    toChatbox: $('afkToChatbox').checked,
    message: $('afkMessage').value || '💤 AFK since {time} ({mins}m)',
    backMessage: $('afkBackMessage').value || '👋 Back!'
  }
}
function applyAfk () {
  const c = afkCfg()
  api.saveSetting('afk', c)
  if (c.enabled) api.afkStart({ thresholdSec: c.thresholdSec })
  else { api.afkStop(); setPill('afkState', false); setText('afkOut', 'Active') }
}
;['afkEnable', 'afkThreshold', 'afkToChatbox', 'afkMessage', 'afkBackMessage'].forEach(id => $(id).addEventListener('change', applyAfk))
api.on('afk:update', s => {
  const c = afkCfg()
  setPill('afkState', s.afk, 'on')
  if (s.afk) {
    const since = s.since || Date.now()
    const mins = Math.max(0, Math.round((Date.now() - since) / 60000))
    const time = new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const msg = c.message.replace(/\{mins\}/g, mins).replace(/\{time\}/g, time)
    setText('afkOut', `AFK — ${msg}`)
    if (c.toChatbox && c.enabled) { sendChatboxMessage(msg, false); logLine(`OUT chatbox: ${msg}`) }
  } else {
    setText('afkOut', 'Active')
    if (c.toChatbox && c.enabled && c.backMessage) { sendChatboxMessage(c.backMessage, false); logLine(`OUT chatbox: ${c.backMessage}`) }
  }
})

/* ---------------- vrchat account (auto status) ---------------- */
let vrc2faMethod = 'totp'
function setAcctState (loggedIn, txt) {
  setPill('vrcAcctState', loggedIn, 'on')
  $('vrcAcctState').textContent = loggedIn ? 'logged in' : 'logged out'
  if (txt) setText('vrcAcctOut', txt)
}
$('vrcLogin').addEventListener('click', async () => {
  const u = $('vrcUser').value.trim(); const p = $('vrcPass').value
  if (!u || !p) { setText('vrcAcctOut', 'Enter username + password'); return }
  setText('vrcAcctOut', 'Logging in…')
  const r = await api.vrchatLogin(u, p)
  $('vrcPass').value = ''
  if (r.ok && r.needs2fa) {
    vrc2faMethod = (r.methods || []).includes('emailOtp') ? 'emailotp' : 'totp'
    $('vrc2faRow').style.display = ''
    setText('vrc2faHint', vrc2faMethod === 'emailotp' ? '(emailed code)' : '(authenticator app)')
    setText('vrcAcctOut', '2FA required — enter your code')
  } else if (r.ok && r.user) {
    $('vrc2faRow').style.display = 'none'
    setAcctState(true, `Logged in as ${r.user.displayName} · status: ${r.user.status}`)
    await api.saveSetting('vrcUser', u)
    if ($('vrcAutoStatus').checked) api.vrchatAutoStatus(true)
    loadRightbar(); loadNotifications(); loadProfileEditor()
  } else setText('vrcAcctOut', 'Error: ' + (r.error || 'login failed'))
})
$('vrc2faVerify').addEventListener('click', async () => {
  const code = $('vrc2faCode').value.trim(); if (!code) return
  setText('vrcAcctOut', 'Verifying…')
  const r = await api.vrchatVerify2fa(code, vrc2faMethod)
  if (r.ok && r.user) {
    $('vrc2faRow').style.display = 'none'; $('vrc2faCode').value = ''
    setAcctState(true, `Logged in as ${r.user.displayName} · status: ${r.user.status}`)
    await api.saveSetting('vrcUser', $('vrcUser').value.trim())
    if ($('vrcAutoStatus').checked) api.vrchatAutoStatus(true)
    loadRightbar(); loadNotifications(); loadProfileEditor()
  } else setText('vrcAcctOut', 'Error: ' + (r.error || '2FA failed'))
})
$('vrcLogout').addEventListener('click', async () => { await api.vrchatLogout(); setAcctState(false, 'Logged out'); $('vrcAutoStatus').checked = false; api.saveSetting('vrcAutoStatus', false) })
$('vrcAutoStatus').addEventListener('change', e => { api.saveSetting('vrcAutoStatus', e.target.checked); api.vrchatAutoStatus(e.target.checked); $('discordVrcStatus').disabled = e.target.checked })
const STATUS_KEY = { 'join me': 'join', active: 'active', 'ask me': 'ask', busy: 'busy', offline: 'busy' }
api.on('vrchat:account', s => {
  if (s.ok) {
    setAcctState(true, `${s.displayName} · ${s.status}${s.statusDescription ? ' — ' + s.statusDescription : ''}`)
    // Reflect the live VRChat status in the gate dropdown + profile editor.
    const key = STATUS_KEY[String(s.status || '').toLowerCase()]
    if (key && $('vrcAutoStatus').checked) $('discordVrcStatus').value = key
    if (s.status) $('peStatus').value = s.status
    if (s.statusDescription != null) $('peStatusDesc').value = s.statusDescription
  } else if (s.needs2fa) { $('vrc2faRow').style.display = ''; setText('vrcAcctOut', '2FA required') } else if (s.error) setText('vrcAcctOut', 'Error: ' + s.error)
})

/* ---------------- weather ---------------- */
function weatherCfg () { return { city: $('weatherCity').value.trim(), units: $('weatherUnits').value } }
function applyWeather () {
  const c = weatherCfg()
  api.saveSetting('weather', { enabled: $('weatherEnable').checked, city: c.city, units: c.units })
  if ($('weatherEnable').checked && c.city) { setPill('weatherState', true, 'on'); api.weatherStart(c) } else { setPill('weatherState', false); api.weatherStop(); setText('weatherOut', '—') }
}
;['weatherEnable', 'weatherCity', 'weatherUnits'].forEach(id => $(id).addEventListener('change', applyWeather))
api.on('weather:update', s => {
  if (s && s.ok) {
    const weatherText = `${s.desc} · ${s.temp}${s.unit} (feels ${s.feels}${s.unit}) · wind ${s.wind} ${s.windUnit}`
    setText('weatherOut', `${s.desc} · ${s.temp}${s.unit} (feels ${s.feels}${s.unit})`)
    setText('weatherSub', `${s.city} · wind ${s.wind} ${s.windUnit} · toggle Weather on the Chatbox tab, or use {weather} in a preset`)
    composer.update({ weather: weatherText })
  } else { setText('weatherOut', '—'); if (s && s.error) setText('weatherSub', s.error) }
})

/* ---------------- discord voice bot ---------------- */
function botCfg () { return { token: $('botToken').value.trim(), userId: $('botUserId').value.trim(), appId: $('botAppId').value.trim() } }

function botMode () { return $('botMode').value === 'official' ? 'official' : 'own' }
function syncBotModeUI () {
  const official = botMode() === 'official'
  $('botOwnFields').style.display = official ? 'none' : ''
  $('botOfficialFields').style.display = official ? '' : 'none'
}
$('botMode').addEventListener('change', async () => {
  await api.saveSetting('discordBotMode', botMode())
  syncBotModeUI()
})

async function refreshDiscordIdentityStatus () {
  const loggedIn = await api.discordIdentityStatus()
  setText('discordIdentityOut', loggedIn ? 'Logged in with Discord' : 'Not logged in')
}
$('nekosuneBackendUrl').addEventListener('change', () => api.saveSetting('nekosuneBackendUrl', $('nekosuneBackendUrl').value.trim()))
$('discordIdentityLogin').addEventListener('click', async () => {
  setText('discordIdentityOut', 'Opening Discord login…')
  const r = await api.discordIdentityLogin()
  setText('discordIdentityOut', r.ok ? 'Logged in with Discord' : ('Error: ' + (r.error || 'login failed')))
})
$('discordIdentityLogout').addEventListener('click', async () => {
  await api.discordIdentityLogout()
  setText('discordIdentityOut', 'Not logged in')
})

$('botStart').addEventListener('click', async () => {
  setText('botOut', 'Connecting…')
  if (botMode() === 'official') {
    const r = await api.officialBotStart()
    if (!r.ok) setText('botOut', 'Error: ' + (r.error || 'failed'))
    return
  }
  const c = botCfg()
  await api.saveSetting('discordBotToken', c.token)
  await api.saveSetting('discordBot', { userId: c.userId, appId: c.appId })
  const r = await api.botStart(c)
  if (!r.ok) setText('botOut', 'Error: ' + (r.error || 'failed'))
})
$('botStop').addEventListener('click', async () => {
  await (botMode() === 'official' ? api.officialBotStop() : api.botStop())
  setPill('botState', false); setText('botOut', 'Stopped')
})
$('botInvite').addEventListener('click', async () => {
  const url = await api.botInvite($('botAppId').value.trim())
  setText('botOut', url ? ('Invite (copy): ' + url) : 'Connect first, or enter the Application ID for the invite link.')
})
api.on('bot:update', s => {
  setPill('botState', s.connected, 'on')
  if ($('discordOscEnable')?.checked) {
    setPill('discordOscState', s.connected, s.connected ? 'connected' : 'waiting', 'off')
    sendParam(DISCORD_OSC_METADATA, true, 'bool')
    sendParam('/avatar/parameters/VRCOSC/Discord/Ready', !!s.connected, 'bool')
    sendParam('/avatar/parameters/VRCOSC/Discord/Mic', !!s.selfMute, 'bool')
    sendParam('/avatar/parameters/VRCOSC/Discord/Deafen', !!s.selfDeaf, 'bool')
    sendParam('/avatar/parameters/VRCOSC/Discord/ChannelUserCount', Number(s.userCount) || 0, 'int')
    sendParam('/avatar/parameters/VRCOSC/Discord/VoiceConnectionState', s.inVoice ? 1 : 0, 'int')
    setText('discordOscOut', s.connected ? (s.inVoice ? `${s.channelName} · ${s.userCount || 0} users` : 'Connected · not in voice') : (s.error ? `Error: ${s.error}` : 'Waiting for Discord Voice Bot'))
  }
  if (!s.connected) { if (s.error) setText('botOut', 'Error: ' + s.error); return }
  const bits = []
  bits.push(s.inVoice ? `🔊 ${s.channelName} (${s.userCount})` : 'not in voice')
  if (s.selfMute) bits.push('🔇 muted')
  if (s.selfDeaf) bits.push('🔈 deafened')
  setText('botOut', bits.join(' · '))
  composer.update({ discordChannel: s.inVoice ? s.channelName : '', discordUsers: s.userCount || 0, discordMute: !!s.selfMute, discordDeaf: !!s.selfDeaf })
  if (s.callEvent === 'started') { logLine('Discord call started'); setText('discordOscOut', '📞 Call started') }
  if (s.callEvent === 'ended') { logLine('Discord call ended'); setText('discordOscOut', '📞 Call ended') }
})

/* ---------------- soundpad ---------------- */
function spOut (r) {
  const ok = !!(r && r.ok)
  setPill('soundpadState', ok, 'on'); $('soundpadState').textContent = ok ? 'ok' : 'error'
  setText('soundpadOut', ok ? 'OK' : ('Error: ' + ((r && r.error) || 'Soundpad not running?')))
}
$('soundpadPlay').addEventListener('click', async () => spOut(await api.soundpadCmd('play', parseInt($('soundpadIndex').value, 10) || 1)))
$('soundpadStop').addEventListener('click', async () => spOut(await api.soundpadCmd('stop')))
$('soundpadNext').addEventListener('click', async () => spOut(await api.soundpadCmd('next')))
$('soundpadPrev').addEventListener('click', async () => spOut(await api.soundpadCmd('previous')))
$('soundpadPause').addEventListener('click', async () => spOut(await api.soundpadCmd('pause')))
$('soundpadRandom').addEventListener('click', async () => spOut(await api.soundpadCmd('random')))
$('soundpadRefresh').addEventListener('click', async () => {
  const r = await api.soundpadList()
  if (r.ok) {
    $('soundpadList').innerHTML = r.list.map(x => `<div class="row" style="justify-content:space-between;padding:2px 0"><span>#${x.index} ${String(x.title).replace(/</g, '&lt;')}</span><button class="btn ghost sp-play" data-i="${x.index}" style="padding:2px 8px;font-size:.72rem">Play</button></div>`).join('') || 'Empty'
    spOut({ ok: true })
  } else spOut(r)
})
$('soundpadList').addEventListener('click', async e => { const b = e.target.closest('.sp-play'); if (b) spOut(await api.soundpadCmd('play', parseInt(b.dataset.i, 10))) })

/* ---------------- SpotiOSC + DiscordOSC (OSC-in → action) ---------------- */
const DISCORD_OSC_METADATA = '/avatar/parameters/VRCOSC/Metadata/Modules/YUCP.VIRA.yeusepesmodules.discordosc'
const SPOTI_OSC_METADATA = '/avatar/parameters/VRCOSC/Metadata/Modules/YUCP.VIRA.yeusepesmodules.spotiosc'
let lastSpotiTrack = ''

function saveOscAppControl (id) {
  api.saveSetting(id, $(id).checked)
  if (id === 'discordOscEnable') {
    sendParam(DISCORD_OSC_METADATA, $(id).checked, 'bool')
    setPill('discordOscState', $(id).checked, $(id).checked ? 'waiting' : 'off', 'off')
  }
  if (id === 'spotiOscEnable') {
    sendParam(SPOTI_OSC_METADATA, $(id).checked, 'bool')
    sendParam('/avatar/parameters/SpotiOSC/Enabled', $(id).checked, 'bool')
    setPill('spotiOscState', $(id).checked, 'on', 'off')
    if ($(id).checked) refreshNowPlaying()
  }
}

;['spotiOscEnable', 'discordOscEnable'].forEach(id => $(id).addEventListener('change', () => saveOscAppControl(id)))
const SPOTI_MAP = {
  '/avatar/parameters/VRCOSC/Spotify/PlayPause': 'playpause',
  '/avatar/parameters/VRCOSC/Spotify/Next': 'next',
  '/avatar/parameters/VRCOSC/Spotify/Previous': 'previous',
  '/avatar/parameters/VRCOSC/Spotify/Stop': 'stop',
  '/avatar/parameters/VRCOSC/Media/Skip': 'next',
  '/avatar/parameters/VRCOSC/Media/Next': 'next',
  '/avatar/parameters/VRCOSC/Media/Previous': 'previous',
  '/avatar/parameters/SpotiOSC/Pause': 'playpause',
  '/avatar/parameters/SpotiOSC/NextTrack': 'next',
  '/avatar/parameters/SpotiOSC/PreviousTrack': 'previous'
}
let lastVrcoscMediaPlay = null

function publishSpotiState (media) {
  if (!$('spotiOscEnable')?.checked) return
  const found = !!media?.found
  const playing = found && media.status === 'Playing'
  const track = found ? `${media.artist || ''}|${media.title || ''}` : ''
  lastVrcoscMediaPlay = playing
  sendParam(SPOTI_OSC_METADATA, true, 'bool')
  sendParam('/avatar/parameters/SpotiOSC/Enabled', true, 'bool')
  sendParam('/avatar/parameters/SpotiOSC/IsPlaying', playing, 'bool')
  sendParam('/avatar/parameters/SpotiOSC/PlaybackPosition', Number(media?.progressMs) || 0, 'float')
  sendParam('/avatar/parameters/SpotiOSC/TrackDurationMs', Number(media?.durationMs) || 0, 'float')
  sendParam('/avatar/parameters/SpotiOSC/Timestamp', media?.durationMs ? Math.min(1, media.progressMs / media.durationMs) : 0, 'float')
  sendParam('/avatar/parameters/VRCOSC/Media/Play', playing, 'bool')
  if (track && track !== lastSpotiTrack) {
    lastSpotiTrack = track
    sendParam('/avatar/parameters/SpotiOSC/TrackChangedEvent', true, 'bool')
    setTimeout(() => sendParam('/avatar/parameters/SpotiOSC/TrackChangedEvent', false, 'bool'), 250)
  }
  setPill('spotiOscState', true, found ? (playing ? 'playing' : 'paused') : 'waiting', 'off')
  setText('spotiOscOut', found ? `${media.artist || 'Unknown artist'} — ${media.title || 'Unknown title'} · ${media.status || 'Active'}` : 'Waiting for a Windows media session')
}

addOscListener((address, args) => {
  const val = args && args[0]
  oscQr.handleOsc(address, args)
  shazamOsc.handleOsc(address, args)
  if (address === '/avatar/change') {
    if ($('discordOscEnable')?.checked) sendParam(DISCORD_OSC_METADATA, true, 'bool')
    if ($('spotiOscEnable')?.checked) sendParam(SPOTI_OSC_METADATA, true, 'bool')
  }
  if ($('spotiOscEnable') && $('spotiOscEnable').checked && SPOTI_MAP[address] && val === true) {
    api.mediaKey(SPOTI_MAP[address]); setText('spotiOscOut', `🎵 Media: ${SPOTI_MAP[address]}`)
  }
  if ($('spotiOscEnable')?.checked && address === '/avatar/parameters/VRCOSC/Media/Play') {
    const playing = !!val
    if (lastVrcoscMediaPlay !== null && lastVrcoscMediaPlay !== playing) {
      api.mediaKey('playpause'); setText('spotiOscOut', `🎵 Media: ${playing ? 'play' : 'pause'}`)
    }
    lastVrcoscMediaPlay = playing
  }
  if ($('discordOscEnable') && $('discordOscEnable').checked) {
    const setMute = botMode() === 'official' ? api.officialBotSetMute : api.botSetMute
    const setDeaf = botMode() === 'official' ? api.officialBotSetDeaf : api.botSetDeaf
    if (address === '/avatar/parameters/VRCOSC/Discord/Mute' || address === '/avatar/parameters/VRCOSC/Discord/Mic') { setMute(!!val); setText('discordOscOut', `🎙 mute: ${!!val}`) }
    if (address === '/avatar/parameters/VRCOSC/Discord/Deafen') { setDeaf(!!val); setText('discordOscOut', `🎙 deafen: ${!!val}`) }
  }
}, getRecvPort())

$('spotiJamJoin').addEventListener('click', () => {
  const url = $('spotiJamUrl').value.trim()
  if (!/^https:\/\/(?:spotify\.link|open\.spotify\.com)\//i.test(url)) { setText('spotiOscOut', 'Enter a Spotify Jam invite link first.'); return }
  api.saveSetting('oscApps.spotiJamUrl', url)
  api.openExternal(url)
  setText('spotiOscOut', 'Opened the Jam invite in Spotify.')
})
$('spotiJamCreate').addEventListener('click', () => {
  api.openExternal('https://open.spotify.com/')
  setText('spotiOscOut', 'Spotify opened · use the current-device menu and choose Start a Jam, then paste its invite link here.')
})

/* ---------------- vrchat maintenance tools ---------------- */
function fmtBytes (b) {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++ }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i]
}
$('ytFix').addEventListener('click', async () => {
  setText('ytFixOut', 'Downloading latest yt-dlp…'); $('ytFix').disabled = true
  const r = await api.vrcToolsYtDlp()
  $('ytFix').disabled = false
  setText('ytFixOut', r.ok ? `✅ Updated yt-dlp (${fmtBytes(r.bytes)}). Restart any open VRChat video player.` : ('Error: ' + (r.error || 'failed')))
})
$('cacheCheck').addEventListener('click', async () => {
  const r = await api.vrcToolsCacheSize()
  setText('cacheOut', r.exists ? `Cache size: ${fmtBytes(r.bytes)}` : 'No cache folder found')
})
$('cacheClear').addEventListener('click', async () => {
  setText('cacheOut', 'Clearing…')
  const r = await api.vrcToolsClearCache()
  setText('cacheOut', r.ok ? `✅ Cleared ${fmtBytes(r.freedBytes)}` : ('Error: ' + (r.error || 'failed')))
})
document.querySelectorAll('[data-folder]').forEach(b => b.addEventListener('click', () => api.vrcToolsOpenFolder(b.dataset.folder)))

async function refreshVvcStatus () {
  const s = await api.vvcStatus()
  if (s && s.ok) setText('vvcOut', `${s.installed ? 'Installed' : 'Not installed'} · ${s.running ? '🟢 running' : '⚪ stopped'}`)
}
$('vvcInstall').addEventListener('click', async () => {
  setText('vvcOut', 'Downloading VRCVideoCacher…'); $('vvcInstall').disabled = true
  const r = await api.vvcInstall()
  $('vvcInstall').disabled = false
  setText('vvcOut', r.ok ? `✅ Installed (${fmtBytes(r.bytes)}).` : ('Error: ' + (r.error || 'failed') + ' — set a custom URL with the vvcUrl setting if the release asset changed.'))
})
$('vvcStart').addEventListener('click', async () => {
  const r = await api.vvcStart()
  setText('vvcOut', r.ok ? (r.already ? 'Already running.' : '🟢 Started.') : ('Error: ' + (r.error || 'failed')))
})
$('vvcStop').addEventListener('click', async () => {
  const r = await api.vvcStop()
  setText('vvcOut', r.ok ? '⏹️ Stopped.' : ('Error: ' + (r.error || 'failed')))
})
document.querySelector('[data-tab="vrctools"]').addEventListener('click', refreshVvcStatus)

/* ---------------- reusable client-side pager (less lag on big lists) ---------------- */
const _pageState = {}
function renderPaged (el, items, pageSize, itemHtml, key, wrapClass, afterRender) {
  const total = items.length
  const pages = Math.max(1, Math.ceil(total / pageSize))
  let page = _pageState[key] || 0
  if (page >= pages) page = pages - 1
  if (page < 0) page = 0
  _pageState[key] = page
  const slice = items.slice(page * pageSize, page * pageSize + pageSize)
  const body = slice.map(itemHtml).join('')
  const inner = wrapClass ? `<div class="${wrapClass}">${body}</div>` : body
  const nav = pages > 1 ? `<div class="row" style="justify-content:center;gap:10px;margin-top:10px"><button class="btn ghost pg-prev" ${page === 0 ? 'disabled' : ''}>‹ Prev</button><span class="muted" style="font-size:.78rem">${page + 1}/${pages} · ${total}</span><button class="btn ghost pg-next" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button></div>` : `<div class="muted" style="text-align:center;font-size:.72rem;margin-top:6px">${total}</div>`
  el.innerHTML = inner + nav
  const prev = el.querySelector('.pg-prev'); const next = el.querySelector('.pg-next')
  if (prev) prev.addEventListener('click', () => { _pageState[key]--; renderPaged(el, items, pageSize, itemHtml, key, wrapClass, afterRender) })
  if (next) next.addEventListener('click', () => { _pageState[key]++; renderPaged(el, items, pageSize, itemHtml, key, wrapClass, afterRender) })
  if (afterRender) afterRender(el)
}

/* ---------------- Friend Den ---------------- */
const STATUS_DOT = { 'join me': '🔵', active: '🟢', 'ask me': '🟠', busy: '🔴', offline: '⚫' }
// VRChat spoken-language tags (language_xxx) -> flag emoji + readable name, so the
// friend lists can show at a glance which language(s) someone speaks.
const LANG_FLAG = {
  eng: ['🇬🇧', 'English'], jpn: ['🇯🇵', 'Japanese'], kor: ['🇰🇷', 'Korean'], zho: ['🇨🇳', 'Chinese'],
  fra: ['🇫🇷', 'French'], deu: ['🇩🇪', 'German'], spa: ['🇪🇸', 'Spanish'], por: ['🇵🇹', 'Portuguese'],
  rus: ['🇷🇺', 'Russian'], ita: ['🇮🇹', 'Italian'], nld: ['🇳🇱', 'Dutch'], pol: ['🇵🇱', 'Polish'],
  swe: ['🇸🇪', 'Swedish'], nor: ['🇳🇴', 'Norwegian'], dan: ['🇩🇰', 'Danish'], fin: ['🇫🇮', 'Finnish'],
  tha: ['🇹🇭', 'Thai'], vie: ['🇻🇳', 'Vietnamese'], ind: ['🇮🇩', 'Indonesian'], tur: ['🇹🇷', 'Turkish'],
  ara: ['🇸🇦', 'Arabic'], heb: ['🇮🇱', 'Hebrew'], hin: ['🇮🇳', 'Hindi'], ukr: ['🇺🇦', 'Ukrainian'],
  ces: ['🇨🇿', 'Czech'], hun: ['🇭🇺', 'Hungarian'], ron: ['🇷🇴', 'Romanian'], ell: ['🇬🇷', 'Greek'],
  gre: ['🇬🇷', 'Greek'], slv: ['🇸🇮', 'Slovenian'], hrv: ['🇭🇷', 'Croatian'], bul: ['🇧🇬', 'Bulgarian'],
  srp: ['🇷🇸', 'Serbian'], est: ['🇪🇪', 'Estonian'], lav: ['🇱🇻', 'Latvian'], lit: ['🇱🇹', 'Lithuanian'],
  isl: ['🇮🇸', 'Icelandic'], gle: ['🇮🇪', 'Irish'], cym: ['🏴', 'Welsh'], afr: ['🇿🇦', 'Afrikaans'],
  msa: ['🇲🇾', 'Malay'], zsm: ['🇲🇾', 'Malay'], fil: ['🇵🇭', 'Filipino'], tgl: ['🇵🇭', 'Tagalog'],
  cat: ['🇪🇸', 'Catalan'], glg: ['🇪🇸', 'Galician'], eus: ['🏴', 'Basque'], mlt: ['🇲🇹', 'Maltese'],
  sqi: ['🇦🇱', 'Albanian'], ase: ['🤟', 'ASL'], bfi: ['🤟', 'BSL'], tok: ['🌐', 'Toki Pona']
}
// Render up to 3 language flag badges from a list of VRChat language codes.
function langBadges (languages) {
  const codes = (languages || []).filter(Boolean)
  if (!codes.length) return ''
  const shown = codes.slice(0, 3).map(c => {
    const m = LANG_FLAG[c] || ['🌐', c.toUpperCase()]
    return `<span class="lang-badge" title="${m[1]}">${m[0]}</span>`
  }).join('')
  const extra = codes.length > 3 ? `<span class="lang-badge" title="${codes.length - 3} more">+${codes.length - 3}</span>` : ''
  return `<span class="lang-badges">${shown}${extra}</span>`
}
// Community-rank feature state, mirrored from main so friend lists know whether to
// show rank badges and whether the OG tiers (Veteran/Legend) are visible.
let ranksUi = { enabled: false, ogMode: true }
const TRUSTED_COLOR = '#2DD4BF'
// Resolve a friend's estimated community rank for display, applying the OG cap.
function rankDisplay (cr) {
  if (!cr) return null
  if (cr.isOg && ranksUi.ogMode === false) return { label: 'Trusted User', color: TRUSTED_COLOR, tier: 4, isOg: false, vrcPlus: cr.vrcPlus }
  return { label: cr.shortLabel, color: cr.color, tier: cr.tier, isOg: cr.isOg, vrcPlus: cr.vrcPlus }
}
// A compact rank pill. minTier filters out the common low tiers in dense lists
// (default 5 = only Veteran/Legend); pass 0 to always show (e.g. the profile modal).
function rankPill (cr, opts = {}) {
  if (!ranksUi.enabled) return ''
  const d = rankDisplay(cr); if (!d) return ''
  if (d.tier < (opts.minTier != null ? opts.minTier : 5)) return ''
  const og = d.isOg ? ' rank-og' : ''
  return `<span class="rank-pill${og}" title="${esc(d.label)} — estimated from VRChat trust" style="border-color:${d.color};color:${d.color}">🏅 ${esc(d.label)}</span>`
}
// Parse a VRChat location string -> world/instance + access type (mirror of the
// API helper, for places that only have the raw location string).
function parseLoc (loc) {
  if (!loc || loc === 'offline' || loc === 'traveling') return { type: loc || 'offline', private: false, joinable: false }
  if (loc === 'private') return { type: 'private', private: true, joinable: false }
  const m = String(loc).match(/^(wrld_[^:]+):([^~]+)(~.*)?$/)
  if (!m) return { type: 'unknown', private: false, joinable: false }
  const tags = m[3] || ''
  let type = 'public'
  if (/~group\(/.test(tags)) { const ga = (tags.match(/~groupAccessType\((\w+)\)/) || [])[1] || 'members'; type = ga === 'public' ? 'group' : (ga === 'plus' ? 'group+' : 'groupMembers') } else if (/~private\(/.test(tags)) type = /~canRequestInvite/.test(tags) ? 'invite+' : 'invite'
  else if (/~friends\(/.test(tags)) type = 'friends'
  else if (/~hidden\(/.test(tags)) type = 'friends+'
  const isPriv = type === 'invite' || type === 'invite+' || type === 'groupMembers'
  return { worldId: m[1], instanceId: m[2] + tags, type, private: isPriv, joinable: !isPriv && type !== 'unknown' }
}
const INSTANCE_LABEL = { public: 'Public', 'friends+': 'Friends+', friends: 'Friends', group: 'Group', 'group+': 'Group+', invite: 'Invite', 'invite+': 'Invite+', groupMembers: 'Group (members)' }

// Privacy-aware location label. Private/invite-only instances show "In private
// world" (never the world name); joinable ones show the world name (resolved
// lazily into the .wn span) + the instance type.
const worldNameCache = {}
function fmtLocation (loc) {
  if (!loc || loc === 'offline') return 'Offline'
  if (loc === 'traveling') return '✈️ Traveling'
  const i = parseLoc(loc)
  if (i.private || loc === 'private') return '🔒 In private world'
  if (i.joinable && i.worldId) {
    const tl = INSTANCE_LABEL[i.type] || ''
    const cached = worldNameCache[i.worldId]
    return `🌐 <span class="wn"${cached ? '' : ` data-world="${i.worldId}"`}>${cached ? esc(cached) : '…'}</span>${tl ? ` <span class="muted" style="font-size:.72rem">(${tl})</span>` : ''}`
  }
  if (String(loc).startsWith('wrld_')) return '🌐 In a world'
  return esc(loc)
}
// Fill in world names for any .wn[data-world] spans (memoised; sequential to stay
// gentle on the API).
async function resolveWorldNames (root) {
  const ids = [...new Set([...(root || document).querySelectorAll('.wn[data-world]')].map(s => s.dataset.world))]
  for (const id of ids) {
    let name = worldNameCache[id]
    if (!name) { try { const r = await api.vrchatWorldName(id); name = (r && r.ok && r.name) ? r.name : 'In a world' } catch (_) { name = 'In a world' } worldNameCache[id] = name }
    document.querySelectorAll(`.wn[data-world="${id}"]`).forEach(s => { s.textContent = name; s.removeAttribute('data-world') })
  }
}
async function loadFriends () {
  const el = $('friendList'); el.textContent = 'Loading…'
  // The COMPLETE list (online + offline + reconciled stragglers) so nobody is missing.
  const r = await api.vrchatAllFriends()
  if (!r.ok) { el.textContent = 'Error: ' + (r.error || 'failed') + ' — log in on the VRChat tab.'; setText('friendCount', '0'); return }
  const isOnline = f => f.online === true
  // Online first, then alphabetical — keeps the people you can actually join up top.
  const fr = r.friends.slice().sort((a, b) =>
    (isOnline(b) - isOnline(a)) || String(a.displayName || '').localeCompare(String(b.displayName || '')))
  const onlineN = r.onlineCount != null ? r.onlineCount : fr.filter(isOnline).length
  setText('friendCount', `${onlineN}/${r.expected || fr.length}`)
  // Surface any friends VRChat's API still wouldn't return, so the count is honest.
  const prevNote = document.getElementById('fdMissingNote'); if (prevNote) prevNote.remove()
  if (r.stillMissing) { const note = document.createElement('div'); note.id = 'fdMissingNote'; note.className = 'muted'; note.style.cssText = 'font-size:.72rem;margin-bottom:4px'; note.textContent = `${r.stillMissing} friend(s) couldn't be loaded from VRChat right now.`; el.before(note) }
  if (!fr.length) { el.textContent = 'No friends found.'; return }
  _pageState.friendden = 0
  renderPaged(el, fr, 60, f => {
    const st = friendState(f) // online (in-world) | active (website) | offline
    const dot = st === 'offline' ? '⚫' : (st === 'active' ? '🌐' : (STATUS_DOT[String(f.status || '').toLowerCase()] || '🟢'))
    const name = String(f.displayName || '?').replace(/</g, '&lt;')
    const desc = f.statusDescription ? ' · ' + String(f.statusDescription).replace(/</g, '&lt;') : ''
    const loc = st === 'active' ? 'On the website' : (st === 'offline' ? 'Offline' : fmtLocation(f.location))
    return `<div class="fd-friend" data-id="${f.id}" style="padding:3px 0;cursor:pointer">${dot} <b>${name}</b> ${langBadges(f.languages)} ${rankPill(f.communityRank, { minTier: 4 })} — ${loc}${desc}</div>`
  }, 'friendden', null, resolveWorldNames)
}
$('friendList').addEventListener('click', e => { const row = e.target.closest('.fd-friend'); if (row && row.dataset.id) openUserModal(row.dataset.id) })
let friendTimer = null
function syncFriendAuto () {
  if ($('friendAuto').checked) { if (!friendTimer) friendTimer = setInterval(() => { if ($('friendden').offsetParent !== null) loadFriends() }, 60000) } else if (friendTimer) { clearInterval(friendTimer); friendTimer = null }
}
$('friendRefresh').addEventListener('click', loadFriends)
$('friendAuto').addEventListener('change', () => { api.saveSetting('friendAuto', $('friendAuto').checked); syncFriendAuto() })
document.querySelector('[data-tab="friendden"]').addEventListener('click', loadFriends)

/* ---------------- Community Ranks (NekoSuneAPPS OG ranks) ---------------- */
const RANK_BAR = [ // factor key -> label, for the breakdown bars
  ['joinAge', 'VRChat join age'], ['yearsActive', 'Years active'], ['accountAge', 'App account age'],
  ['worldUploads', 'World uploads'], ['avatarUploads', 'Avatar uploads'], ['creatorActivity', 'Creator activity'],
  ['contributions', 'Contributions'], ['events', 'Event participation'], ['reputation', 'Reputation'],
  ['recognition', 'Staff recognition']
]
function renderRankCard (r) {
  const el = $('ranksCard')
  if (!r || r.enabled === false) { el.textContent = 'Enable the feature to compute your rank.'; return }
  if (!r.rank) { el.textContent = 'Could not compute a rank yet — log in on the VRChat tab, then Refresh.'; return }
  const pct = Math.round((r.score / 1000) * 100)
  const bars = RANK_BAR.map(([k, lbl]) => {
    const v = Math.round((r.breakdown && r.breakdown[k]) || 0); const mx = (r.maxByFactor && r.maxByFactor[k]) || 1
    return `<div style="margin:3px 0"><div class="row" style="justify-content:space-between;font-size:.72rem"><span>${lbl}</span><span class="muted">${v}/${mx}</span></div><div style="height:6px;background:var(--panel2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(v / mx * 100)}%;background:${r.rank.color}"></div></div></div>`
  }).join('')
  const pend = (r.eligibility && r.eligibility.pendingGates && r.eligibility.pendingGates.length)
    ? `<div class="muted" style="font-size:.72rem;margin-top:8px">To reach the next tier: ${r.eligibility.pendingGates.map(esc).join(' · ')}</div>` : ''
  const next = (r.eligibility && r.eligibility.nextRank)
    ? `<div class="muted" style="font-size:.72rem">${r.eligibility.scoreToNext} pts to <b>${esc(r.eligibility.nextRank)}</b></div>` : ''
  el.innerHTML =
    `<div class="row" style="align-items:center;gap:12px">
       <div style="width:64px;height:64px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.6rem;background:${r.rank.color}22;border:2px solid ${r.rank.color}">🏅</div>
       <div style="min-width:0">
         <div style="font-weight:800;font-size:1.05rem;color:${r.rank.color}">${esc(r.rank.shortLabel)}</div>
         <div class="muted" style="font-size:.7rem">${esc(r.rank.label)}</div>
         <div style="font-weight:700;margin-top:2px">${r.score} <span class="muted" style="font-weight:400">/ 1000</span></div>
       </div>
     </div>
     <div style="height:8px;background:var(--panel2);border-radius:5px;overflow:hidden;margin:10px 0 4px"><div style="height:100%;width:${pct}%;background:${r.rank.color}"></div></div>
     ${next}${pend}
     <div style="margin-top:12px">${bars}</div>
     <div class="muted" style="font-size:.66rem;margin-top:10px">${esc(r.disclaimer || '')}</div>`
}
async function loadRanksLeaderboard () {
  const el = $('ranksLeaderboard')
  const rows = await api.ranksLeaderboard(50)
  if (!rows || !rows.length) { el.textContent = 'No ranked members yet.'; return }
  el.innerHTML = rows.map(e => `<div class="row" style="justify-content:space-between;padding:3px 0"><span>#${e.position} <b>${esc(e.displayName)}</b></span><span class="muted">${esc(e.rank)} · ${e.score}</span></div>`).join('')
}
// Refresh whatever friend surfaces are visible so rank badges appear/disappear live.
function refreshFriendBadges () {
  if (rbFriendsCache.online.length || rbFriendsCache.offline.length) renderRightbar()
  if ($('friendden') && $('friendden').offsetParent !== null) loadFriends()
}
async function loadRanks () {
  const cfg = await api.ranksConfig()
  ranksUi = { enabled: !!cfg.enabled, ogMode: cfg.ogMode !== false }
  $('ranksEnabled').checked = !!cfg.enabled
  $('ranksOgMode').checked = cfg.ogMode !== false
  if (cfg.enabled) { renderRankCard(await api.ranksGet()); loadRanksLeaderboard() }
  else renderRankCard({ enabled: false })
}
async function saveRanksCfg () {
  const next = await api.ranksSetConfig({ enabled: $('ranksEnabled').checked, ogMode: $('ranksOgMode').checked })
  ranksUi = { enabled: !!next.enabled, ogMode: next.ogMode !== false }
  $('ranksEnabled').checked = !!next.enabled; $('ranksOgMode').checked = next.ogMode !== false
  if (next.enabled) { renderRankCard(await api.ranksGet()); loadRanksLeaderboard() }
  else renderRankCard({ enabled: false })
  refreshFriendBadges()
}
// Load the feature state at startup so badges show without opening the Ranks tab.
api.ranksConfig().then(c => { ranksUi = { enabled: !!c.enabled, ogMode: c.ogMode !== false }; if (ranksUi.enabled) refreshFriendBadges() }).catch(() => {})
$('ranksEnabled').addEventListener('change', saveRanksCfg)
$('ranksOgMode').addEventListener('change', saveRanksCfg)
$('ranksRefresh').addEventListener('click', async () => { $('ranksCard').textContent = 'Computing…'; renderRankCard(await api.ranksRefresh()); loadRanksLeaderboard() })
api.on('ranks:update', r => { if ($('ranks') && $('ranks').offsetParent !== null) renderRankCard(r) })
document.querySelector('[data-tab="ranks"]').addEventListener('click', loadRanks)

/* ---------------- Event Scout (multi-group) ---------------- */
let trackedGroups = []
async function loadGroups () {
  const el = $('eventGroups'); el.textContent = 'Loading…'
  const r = await api.vrchatGroups()
  if (!r.ok) { el.textContent = 'Error: ' + (r.error || 'failed') + ' — log in on the VRChat tab.'; return }
  el.innerHTML = r.groups.map(g => `<label class="switch" style="margin:4px 0"><input type="checkbox" class="evgrp" data-id="${g.id}" ${trackedGroups.includes(g.id) ? 'checked' : ''}> ${String(g.name || g.id).replace(/</g, '&lt;')}</label>`).join('') || 'You are in no groups.'
  el.querySelectorAll('.evgrp').forEach(c => c.addEventListener('change', () => {
    trackedGroups = Array.from(el.querySelectorAll('.evgrp')).filter(x => x.checked).map(x => x.dataset.id)
    api.saveSetting('eventGroups', trackedGroups); loadEvents()
  }))
}
async function loadEvents () {
  const el = $('eventList')
  if (!trackedGroups.length) { el.textContent = 'Load your groups and tick one or more to track.'; return }
  el.textContent = 'Loading…'
  let all = []
  for (const gid of trackedGroups) { const r = await api.vrchatGroupEvents(gid); if (r.ok) all = all.concat(r.events) }
  all.sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0))
  el.innerHTML = all.length
    ? all.map(e => {
      const when = e.startsAt ? new Date(e.startsAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'TBA'
      return `<div style="padding:3px 0">🔭 <b>${String(e.title || 'Event').replace(/</g, '&lt;')}</b> — ${when}</div>`
    }).join('')
    : 'No upcoming events for the selected groups.'
}
$('eventLoadGroups').addEventListener('click', loadGroups)
$('eventRefresh').addEventListener('click', loadEvents)

/* ---------------- Pawprints ---------------- */
function fmtDuration (secs) { const h = Math.floor(secs / 3600); const m = Math.floor(secs % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m` }
async function loadPawprints () {
  const map = await api.pawprintsList()
  const el = $('pawList')
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1])
  el.innerHTML = entries.length
    ? entries.map(([w, secs]) => `<div class="row" style="justify-content:space-between;padding:3px 0"><span>🐾 ${String(w).replace(/</g, '&lt;')}</span><span>${fmtDuration(secs)}</span></div>`).join('')
    : 'No data yet — spend time in a world.'
}
$('pawRefresh').addEventListener('click', loadPawprints)
$('pawClear').addEventListener('click', async () => { await api.pawprintsClear(); loadPawprints() })
document.querySelector('[data-tab="pawprints"]').addEventListener('click', loadPawprints)

/* ---------------- My Groups + My Content pages ---------------- */
async function loadMyGroups () {
  const el = $('myGroupsList'); el.textContent = 'Loading…'
  const r = await api.vrchatGroups()
  if (!r.ok) { el.textContent = (r.error || 'Could not load') + ' — log in on the VRChat tab.'; return }
  if (!r.groups.length) { el.textContent = 'You are in no groups.'; return }
  _pageState.mygroups = 0
  renderPaged(el, r.groups, 24, groupCard, 'mygroups', 'card-grid')
}
$('myGroupsRefresh').addEventListener('click', loadMyGroups)
document.querySelector('[data-tab="groups"]').addEventListener('click', loadMyGroups)

async function loadMyContent (kind) {
  const el = $('myContentBody'); el.textContent = 'Loading…'
  if (kind === 'avatars') {
    const r = await api.vrchatMyAvatars()
    if (!r.ok) { el.textContent = (r.error || 'Could not load') + ' — log in on the VRChat tab.'; return }
    el.innerHTML = r.avatars.length ? `<div class="card-grid">${r.avatars.map(a => `<div class="mini-card" data-kind="avatar" data-id="${a.id}" style="cursor:pointer;flex-direction:column;align-items:stretch"><div style="display:flex;gap:9px;align-items:center"><img src="${a.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="muted" style="font-size:.72rem">${esc(a.releaseStatus || '')}</div></div></div><div class="row" style="margin-top:6px;gap:6px"><button class="btn av-switch" data-id="${a.id}" style="padding:3px 10px;font-size:.72rem">Wear</button><button class="btn danger av-del" data-id="${a.id}" data-name="${esc(a.name)}" style="padding:3px 10px;font-size:.72rem">Delete</button></div></div>`).join('')}</div>` : 'No avatars.'
  } else {
    const r = await api.vrchatMyWorlds()
    if (!r.ok) { el.textContent = (r.error || 'Could not load') + ' — log in on the VRChat tab.'; return }
    el.innerHTML = r.worlds.length ? `<div class="card-grid">${r.worlds.map(worldCard).join('')}</div>` : 'No worlds uploaded.'
  }
}
document.querySelectorAll('[data-ctab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-ctab]').forEach(x => x.classList.toggle('active', x === b))
  loadMyContent(b.dataset.ctab)
}))
document.querySelector('[data-tab="content"]').addEventListener('click', () => loadMyContent('worlds'))
// Avatar Wear / Delete actions
$('myContentBody').addEventListener('click', async e => {
  const sw = e.target.closest('.av-switch'); const del = e.target.closest('.av-del')
  if (sw) { sw.textContent = '…'; const r = await api.vrchatSelectAvatar(sw.dataset.id); sw.textContent = r.ok ? '✓ Worn' : '✗'; if (!r.ok) console.warn(r.error) }
  if (del) {
    const ok = await confirmDialog(`Delete avatar “${del.dataset.name}”? This cannot be undone.`)
    if (!ok) return
    del.textContent = '…'; const r = await api.vrchatDeleteAvatar(del.dataset.id)
    if (r.ok) loadMyContent('avatars'); else { del.textContent = 'Delete'; alert('Delete failed: ' + (r.error || '')) }
  }
})

/* ---------------- Inventory (icons/emoji/stickers/prints) ---------------- */
async function loadInventory (kind) {
  const el = $('invGrid'); el.textContent = 'Loading…'
  const r = kind === 'prints' ? await api.vrchatPrints() : await api.vrchatInventory(kind)
  if (!r.ok) { el.textContent = (r.error || 'failed') + ' — log in on the VRChat tab.'; return }
  if (!r.items.length) { el.textContent = 'Nothing here.'; return }
  el.innerHTML = r.items.map(i => `<div class="mini-card" title="${esc(i.name)}" style="flex-direction:column;align-items:stretch;padding:0;overflow:hidden"><img data-src="${esc(i.url)}" src="assets/logo.png" referrerpolicy="no-referrer" loading="lazy" decoding="async" style="width:100%;height:100px;object-fit:cover" /></div>`).join('')
  // Proxy the auth-gated VRChat images → data URLs (sequential to avoid hammering).
  for (const img of el.querySelectorAll('img[data-src]')) {
    const res = await api.vrchatImage(img.dataset.src)
    if (res.ok) img.src = res.data
  }
}
document.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-inv]').forEach(x => x.classList.toggle('active', x === b))
  loadInventory(b.dataset.inv)
}))
document.querySelector('[data-tab="inventory"]').addEventListener('click', () => loadInventory(document.querySelector('[data-inv].active').dataset.inv))

/* ---------------- Avatar browse (avtrdb + custom providers) ---------------- */
let avProviders = []
async function loadAvProviders () {
  let defaults = []
  try { defaults = await api.avatarsDefaultProviders() } catch (_) {}
  const custom = await api.getSetting('avatarProviders', [])
  avProviders = [...defaults, ...custom]
  $('avProvider').innerHTML = avProviders.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')
}
async function doAvatarSearch () {
  const p = avProviders[$('avProvider').value]; if (!p) return
  const q = $('avQuery').value.trim(); if (!q) return
  const el = $('avResults'); el.innerHTML = '<div class="muted">Searching…</div>'
  const r = await api.avatarsSearch(p.url, q, 1)
  if (!r.ok) { el.innerHTML = `<div class="muted">Error: ${esc(r.error)}</div>`; return }
  el.innerHTML = r.avatars.length ? r.avatars.map(a => `<div class="mini-card" data-kind="avatar" data-id="${a.id}" style="cursor:pointer;flex-direction:column;align-items:stretch;padding:0;overflow:hidden"><img src="${a.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" style="width:100%;height:120px;object-fit:cover" /><div style="padding:5px 7px;min-width:0"><div class="nm">${esc(a.name)}</div><div class="muted" style="font-size:.7rem">${esc(a.author || '')}</div></div></div>`).join('') : '<div class="muted">No results (or this provider’s response format isn’t recognised).</div>'
}
$('avSearch').addEventListener('click', doAvatarSearch)
$('avQuery').addEventListener('keydown', e => { if (e.key === 'Enter') doAvatarSearch() })
$('avAddProvider').addEventListener('click', async () => {
  const url = $('avCustomUrl').value.trim(); if (!url) return
  let name = 'custom'; try { name = new URL(url.replace('{query}', 'x').replace('{page}', '1')).hostname } catch (_) {}
  const custom = await api.getSetting('avatarProviders', []); custom.push({ name, url }); await api.saveSetting('avatarProviders', custom)
  $('avCustomUrl').value = ''; loadAvProviders()
})
document.querySelector('[data-tab="avatars"]').addEventListener('click', loadAvProviders)

/* ---------------- Messenger (message slots) ---------------- */
async function loadMessages () {
  const el = $('msgList'); el.textContent = 'Loading…'
  const type = $('msgType').value
  const r = await api.vrchatMessages(type)
  if (!r.ok) { el.textContent = (r.error || 'failed') + ' — log in on the VRChat tab.'; return }
  el.innerHTML = r.messages.map(m => `<div class="row" style="margin:6px 0"><input type="text" class="msg-in" data-slot="${m.slot}" value="${String(m.message || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" style="flex:1" /><button class="btn ghost msg-save" data-slot="${m.slot}" style="padding:4px 10px;font-size:.74rem">Save</button></div>`).join('') || 'No message slots.'
  el.querySelectorAll('.msg-save').forEach(b => b.addEventListener('click', async () => {
    const inp = el.querySelector(`.msg-in[data-slot="${b.dataset.slot}"]`)
    b.textContent = '…'
    const res = await api.vrchatUpdateMessage(type, b.dataset.slot, inp.value)
    b.textContent = res.ok ? '✓' : '✗'; setTimeout(() => { b.textContent = 'Save' }, 1500)
  }))
}
$('msgType').addEventListener('change', loadMessages)
document.querySelector('[data-tab="messenger"]').addEventListener('click', loadMessages)

/* ---------------- Search + ID/URL loader + detail modals ---------------- */
async function doSearch () {
  const q = $('searchQuery').value.trim(); if (!q) return
  const type = $('searchType').value
  const el = $('searchResults'); el.textContent = 'Searching…'
  if (type === 'friends') {
    const ql = q.toLowerCase()
    const all = [...(rbFriendsCache.online || []), ...(rbFriendsCache.offline || [])].filter(f => String(f.displayName || '').toLowerCase().includes(ql))
    el.innerHTML = all.length ? `<div class="card-grid">${all.map(f => `<div class="mini-card" data-kind="user" data-id="${f.id}" style="cursor:pointer"><img src="${f.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(f.displayName)}</div><div class="muted" style="font-size:.72rem">${esc(fmtLocation(f.location))}</div></div></div>`).join('')}</div>` : 'No matching friends (open the friends panel once to load them).'
    return
  }
  if (type === 'users') {
    const r = await api.vrchatSearchUsers(q)
    if (!r.ok) { el.textContent = r.error || 'Search failed'; return }
    el.innerHTML = r.users.length ? `<div class="card-grid">${r.users.map(u => `<div class="mini-card" data-kind="user" data-id="${u.id}" style="cursor:pointer"><img src="${u.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(u.displayName)}</div><div class="muted" style="font-size:.72rem">${esc(u.statusDescription || u.status || '')}</div></div></div>`).join('')}</div>` : 'No users found.'
  } else if (type === 'worlds') {
    const r = await api.vrchatSearchWorlds(q)
    if (!r.ok) { el.textContent = r.error || 'Search failed'; return }
    el.innerHTML = r.worlds.length ? `<div class="card-grid">${r.worlds.map(worldCard).join('')}</div>` : 'No worlds found.'
  } else {
    const r = await api.vrchatSearchGroups(q)
    if (!r.ok) { el.textContent = r.error || 'Search failed'; return }
    el.innerHTML = r.groups.length ? `<div class="card-grid">${r.groups.map(groupCard).join('')}</div>` : 'No groups found.'
  }
}
$('searchBtn').addEventListener('click', doSearch)
$('searchQuery').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch() })
// user result cards open the user modal
$('searchResults').addEventListener('click', e => { const c = e.target.closest('.mini-card[data-kind="user"]'); if (c) openUserModal(c.dataset.id) })

/* ---------------- History page ---------------- */
const HIST_ICON = { join: '➡️', leave: '⬅️', friend_add: '➕', friend_remove: '➖', name_change: '✏️', world: '🌐', video: '🎬', portal: '🌀', alert: '🔔', group: '👥' }
function renderHeatmap (rows) {
  const el = $('histHeatmap'); if (!el) return
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  for (const r of rows) { const d = new Date(r.ts); grid[d.getDay()][d.getHours()]++ }
  const max = Math.max(1, ...grid.flat())
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  let html = '<div class="um-sec">Activity heatmap</div><div style="display:grid;grid-template-columns:28px repeat(24,1fr);gap:2px;font-size:.58rem">'
  html += '<div></div>' + Array.from({ length: 24 }, (_, h) => `<div class="muted" style="text-align:center">${h % 6 === 0 ? h : ''}</div>`).join('')
  for (let d = 0; d < 7; d++) html += `<div class="muted">${days[d]}</div>` + grid[d].map(c => `<div title="${c} events" style="height:12px;border-radius:2px;background:rgba(34,197,94,${(0.1 + (c / max) * 0.9).toFixed(2)})"></div>`).join('')
  html += '</div>'
  el.innerHTML = html
}
async function loadHistory () {
  const el = $('histList'); el.textContent = 'Loading…'
  api.historyList({ limit: 5000 }).then(renderHeatmap)
  const rows = await api.historyList({ type: $('histType').value || undefined, limit: 300 })
  if (!rows || !rows.length) { el.textContent = 'No history yet — it fills as you use VRChat with the app open.'; return }
  el.innerHTML = rows.map(r => {
    const when = new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    // Person-type rows: make the name clickable to open that user's profile.
    const isPerson = HIST_PERSON_TYPES.has(r.type) && r.name
    const nameHtml = isPerson
      ? `<b class="hist-user" data-name="${esc(r.name)}" title="View profile" style="cursor:pointer;text-decoration:underline dotted">${esc(r.name)}</b>`
      : `<b>${esc(r.name || r.type)}</b>`
    return `<div style="display:flex;gap:8px;padding:5px 0;border-top:1px solid var(--border)"><span>${HIST_ICON[r.type] || '•'}</span><div class="grow" style="min-width:0"><div>${nameHtml} <span class="muted">${esc(r.detail || '')}</span></div><div class="muted" style="font-size:.72rem">${when}${r.world ? ' · ' + esc(r.world) : ''}</div></div></div>`
  }).join('')
}
// History event types whose `name` is a person (so the name resolves to a profile).
const HIST_PERSON_TYPES = new Set(['join', 'leave', 'friend_add', 'friend_remove', 'name_change', 'alert'])
// History only stores display names, not user ids — resolve the name via search,
// then open the profile (exact match preferred, else the first result).
async function openUserByName (name, anchorEl) {
  if (!name) return
  const old = anchorEl ? anchorEl.textContent : ''
  if (anchorEl) anchorEl.textContent = '…'
  try {
    const r = await api.vrchatSearchUsers(name)
    const users = (r && r.ok && r.users) || []
    const exact = users.find(u => String(u.displayName || '').toLowerCase() === String(name).toLowerCase())
    const pick = exact || users[0]
    if (pick && pick.id) openUserModal(pick.id)
    else if (anchorEl) { anchorEl.textContent = old; anchorEl.title = 'No VRChat user found by that name' }
  } catch (_) { /* ignore */ }
  finally { if (anchorEl && anchorEl.textContent === '…') anchorEl.textContent = old }
}
$('histList').addEventListener('click', e => {
  const u = e.target.closest('.hist-user')
  if (u && u.dataset.name) openUserByName(u.dataset.name, u)
})
// Reconstruct a user's previous display names from local name_change history.
// Each name_change event stores the new name and `was "<old>"` in its detail, so
// we walk the chain backwards from the current name. Returns ready-to-inject HTML.
async function pastNamesBlock (currentName) {
  if (!currentName) return ''
  let events = []
  try { events = await api.historyList({ type: 'name_change', limit: 5000 }) } catch (_) { return '' }
  const prevOf = new Map() // newName(lower) -> old name (most recent change kept)
  for (const e of (events || [])) {
    const m = /was\s+"(.+)"\s*$/.exec(e.detail || '')
    if (e.name && m) { const k = String(e.name).toLowerCase(); if (!prevOf.has(k)) prevOf.set(k, m[1]) }
  }
  const past = []; const seen = new Set(); let cur = String(currentName).toLowerCase()
  while (prevOf.has(cur) && !seen.has(cur) && past.length < 20) { seen.add(cur); const old = prevOf.get(cur); past.push(old); cur = String(old).toLowerCase() }
  if (!past.length) return ''
  return `<div class="um-sec">Previously known as</div><div class="row" style="flex-wrap:wrap;gap:6px">${past.map(n => `<span class="tagchip" title="Former display name">🪪 ${esc(n)}</span>`).join('')}</div>`
}
$('histRefresh').addEventListener('click', loadHistory)
$('histType').addEventListener('change', loadHistory)
$('histClear').addEventListener('click', async () => { await api.historyClear(); loadHistory() })
$('histImport').addEventListener('click', async () => {
  $('histList').textContent = 'Importing from VRCX…'
  const r = await api.historyImportVrcx()
  if (r.ok) { setText('histList', `✅ Imported ${r.imported} VRCX events.`); loadHistory() } else setText('histList', 'Import failed: ' + (r.error || ''))
})
document.querySelector('[data-tab="history"]').addEventListener('click', loadHistory)

/* ---------------- Auto-Greeter ---------------- */
function greeterCfg () { return { enabled: $('greeterEnable').checked, mode: $('greeterMode').value, allow: $('greeterAllow').value.split(',').map(s => s.trim()).filter(Boolean) } }
function applyGreeter () { const c = greeterCfg(); api.saveSetting('greeter', c); api.greeterSet(c); setText('greeterOut', c.enabled ? 'On — watching for friend requests.' : 'Off') }
;['greeterEnable', 'greeterMode', 'greeterAllow'].forEach(id => $(id).addEventListener('change', applyGreeter))
api.on('greeter:accepted', s => setText('greeterOut', '✅ Auto-accepted ' + (s.name || 'a request')))

function parseVrcId (s) {
  s = String(s || '').trim()
  let m
  if ((m = s.match(/usr_[0-9a-fA-F-]+/))) return { type: 'user', id: m[0] }
  if ((m = s.match(/wrld_[0-9a-fA-F-]+/))) return { type: 'world', id: m[0] }
  if ((m = s.match(/grp_[0-9a-fA-F-]+/))) return { type: 'group', id: m[0] }
  if ((m = s.match(/avtr_[0-9a-fA-F-]+/))) return { type: 'avatar', id: m[0] }
  return null
}
$('idLoadBtn').addEventListener('click', () => {
  const p = parseVrcId($('idLoadInput').value)
  if (!p) { setText('idLoadOut', 'No usr_/wrld_/grp_ id found in that text.'); return }
  setText('idLoadOut', `Opening ${p.type}…`)
  if (p.type === 'user') openUserModal(p.id)
  else if (p.type === 'world') openWorldModal(p.id)
  else if (p.type === 'group') openGroupModal(p.id)
  else setText('idLoadOut', 'Avatars of other users can’t be opened (VRChat API restricts them).')
})
$('idLoadInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('idLoadBtn').click() })

function closeDetailModal () { $('detailModal').style.display = 'none' }
$('detailModalClose').addEventListener('click', closeDetailModal)
$('detailModal').addEventListener('click', e => { if (e.target === $('detailModal')) closeDetailModal() })
// Favorite / unfavorite buttons inside the detail modal
$('dmActions').addEventListener('click', async e => {
  const b = e.target.closest('[data-fav]'); if (!b) return
  const orig = b.textContent; b.textContent = '…'; b.disabled = true
  const r = b.dataset.fav === 'add' ? await api.vrchatAddFav(b.dataset.type || 'world', b.dataset.id) : await api.vrchatRemoveFav(b.dataset.id)
  b.disabled = false; b.textContent = r.ok ? '✓ Done' : '✗ ' + (r.error || 'failed')
  setTimeout(() => { b.textContent = orig }, 2500)
})
function dmInfo (rows) { return `<div class="um-sec">Info</div><div class="um-info">${rows.filter(r => r[1] !== '' && r[1] != null).map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` }
async function openWorldModal (id) {
  $('detailModal').style.display = 'flex'
  $('dmName').textContent = 'Loading…'; setText('dmSub', ''); $('dmActions').innerHTML = ''; $('dmBody').innerHTML = ''
  const r = await api.vrchatWorld(id)
  if (!r.ok) { $('dmName').textContent = 'Error'; $('dmBody').innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
  const w = r.world
  $('dmName').textContent = w.name || '—'
  setText('dmSub', 'World by ' + (w.authorName || '?'))
  $('dmImage').src = w.thumbnailImageUrl || w.imageUrl || 'assets/logo.png'
  $('dmBanner').style.backgroundImage = (w.imageUrl || w.thumbnailImageUrl) ? `url("${w.imageUrl || w.thumbnailImageUrl}")` : ''
  $('dmActions').innerHTML = `<a class="btn" href="https://vrchat.com/home/world/${w.id}" target="_blank">Open on VRChat</a><button class="btn ghost" data-fav="add" data-type="world" data-id="${w.id}">⭐ Favorite</button><button class="btn ghost" data-fav="rm" data-id="${w.id}">✖ Unfavorite</button>`
  $('dmBody').innerHTML = (w.description ? `<div class="um-bio">${esc(w.description)}</div>` : '') + dmInfo([
    ['Players', w.occupants || 0], ['Capacity', w.capacity || '?'], ['Visits', w.visits || 0],
    ['Favorites', w.favorites || 0], ['Status', w.releaseStatus || ''],
    ['Updated', w.updated_at ? new Date(w.updated_at).toLocaleDateString() : '']
  ]) +
    `<div class="um-sec">Create instance</div>
     <div class="row" style="flex-wrap:wrap;gap:8px">
       <select id="instAccess" style="max-width:150px"><option value="public">Public</option><option value="friends+">Friends+</option><option value="friends">Friends</option><option value="invite+">Invite+</option><option value="invite">Invite</option></select>
       <button class="btn" id="instCreate">Create + Self-invite</button>
       <button class="btn ghost" id="instInvite">Invite friends…</button>
     </div>
     <div class="muted" id="instOut" style="margin-top:6px;font-size:.78rem;word-break:break-all"></div>`
  bindWorldInstance(w.id)
}
let lastInstance = null
function bindWorldInstance (worldId) {
  lastInstance = null
  $('instCreate').addEventListener('click', async () => {
    setText('instOut', 'Creating instance…')
    const r = await api.vrchatCreateInstance(worldId, $('instAccess').value)
    if (!r.ok) { setText('instOut', 'Error: ' + (r.error || 'failed')); return }
    lastInstance = r
    await api.vrchatInviteSelf(r.location)
    setText('instOut', `✅ Created + self-invited. Link: https://vrchat.com/home/launch?worldId=${worldId}&instanceId=${encodeURIComponent(r.instanceId)}`)
  })
  $('instInvite').addEventListener('click', async () => {
    let loc = lastInstance && lastInstance.location
    if (!loc) { const r = await api.vrchatCreateInstance(worldId, $('instAccess').value); if (!r.ok) { setText('instOut', 'Error: ' + (r.error || 'failed')); return } lastInstance = r; loc = r.location }
    const ids = await pickFriends('Invite to instance')
    if (!ids.length) return
    setText('instOut', `Inviting ${ids.length}…`)
    let ok = 0
    for (const id of ids) { const res = await api.vrchatInvite(id, loc); if (res.ok) ok++ }
    setText('instOut', `✅ Invited ${ok}/${ids.length}`)
  })
}
async function openGroupModal (id) {
  $('detailModal').style.display = 'flex'
  $('dmName').textContent = 'Loading…'; setText('dmSub', ''); $('dmActions').innerHTML = ''; $('dmBody').innerHTML = ''
  const r = await api.vrchatGroup(id)
  if (!r.ok) { $('dmName').textContent = 'Error'; $('dmBody').innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
  const g = r.group
  $('dmName').textContent = g.name || '—'
  setText('dmSub', (g.shortCode ? '@' + g.shortCode + ' · ' : '') + (g.memberCount || 0) + ' members')
  $('dmImage').src = g.iconUrl || 'assets/logo.png'
  $('dmBanner').style.backgroundImage = g.bannerUrl ? `url("${g.bannerUrl}")` : ''
  $('dmActions').innerHTML = `<a class="btn" href="https://vrchat.com/home/group/${g.id}" target="_blank">Open on VRChat</a><button class="btn ghost" id="grpInvite">Invite people…</button><button class="btn ghost" id="grpMakeInst">Create instance…</button>`
  $('grpInvite').addEventListener('click', async () => {
    const ids = await pickFriends('Invite to ' + (g.name || 'group'))
    if (!ids.length) return
    let ok = 0
    for (const id of ids) { const r = await api.vrchatGroupInvite(g.id, id); if (r.ok) ok++ }
    setText('dmSub', `Invited ${ok}/${ids.length} to the group`)
  })
  $('grpMakeInst').addEventListener('click', () => makeGroupInstance(g))
  $('dmBody').innerHTML = (g.description ? `<div class="um-bio">${esc(g.description)}</div>` : '') + dmInfo([
    ['Members', g.memberCount || 0], ['Code', g.shortCode ? '@' + g.shortCode : ''],
    ['Privacy', g.privacy || ''], ['Created', g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '']
  ]) +
    (g.myMember ? `<div class="um-sec">Your membership</div><div class="muted" style="font-size:.8rem">${(g.myMember.roleIds || []).length} role(s) · ${(g.myMember.permissions || []).length} permission(s)</div>` : '') +
    '<div class="um-sec">Members</div><div id="grpMembers" class="muted">Loading…</div>' +
    '<div class="um-sec">Roles</div><div id="grpRoles" class="muted">Loading…</div>' +
    '<div class="um-sec">Posts</div><div id="grpPosts" class="muted">Loading…</div><div class="um-sec">Gallery</div><div id="grpGallery" class="muted">Loading…</div>'
  loadGroupExtras(g.id)
}
// Build a quick world picker + access/region selectors and POST a group instance.
async function makeGroupInstance (g) {
  let ov = $('giOverlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'giOverlay'; ov.className = 'modal'; ov.style.display = 'none'
    ov.innerHTML = `<div class="modal-box" style="max-width:520px">
      <div class="modal-head"><h3 style="margin:0">Create group instance</h3><button class="btn ghost" id="giClose">✕</button></div>
      <div style="padding:12px">
        <label>World</label>
        <input type="text" id="giWorld" placeholder="search your worlds / favourites, or paste wrld_… / a world URL" />
        <div id="giWorldList" class="card-grid" style="max-height:220px;overflow:auto;margin:6px 0"></div>
        <div class="grid cols-2">
          <div><label>Access</label><select id="giAccess"><option value="members">Group members</option><option value="plus">Group + (friends of members)</option><option value="public">Public</option></select></div>
          <div><label>Region</label><select id="giRegion"><option value="us">US West</option><option value="use">US East</option><option value="eu">Europe</option><option value="jp">Japan</option></select></div>
        </div>
        <div class="row" style="margin-top:10px"><button class="btn" id="giCreate">Create instance</button></div>
        <div class="muted" id="giOut" style="margin-top:6px;font-size:.8rem"></div>
      </div></div>`
    document.body.appendChild(ov)
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none' })
    $('giClose').addEventListener('click', () => { ov.style.display = 'none' })
  }
  ov.dataset.group = g.id
  $('giWorld').value = ''; setText('giOut', ''); $('giWorldList').innerHTML = '<div class="muted">Loading your worlds…</div>'
  let selectedWorld = ''
  ov.style.display = 'flex'

  const renderWorlds = list => {
    $('giWorldList').innerHTML = list.length
      ? list.map(w => `<div class="rb-friend gi-w" data-id="${w.id}" style="cursor:pointer"><img class="ava" src="${w.thumbnailImageUrl || w.imageUrl || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div class="meta grow"><div class="nm">${esc(w.name || w.id)}</div></div></div>`).join('')
      : '<div class="muted">No worlds — paste a world id/URL above.</div>'
    $('giWorldList').querySelectorAll('.gi-w').forEach(row => row.addEventListener('click', () => {
      selectedWorld = row.dataset.id; $('giWorld').value = row.querySelector('.nm').textContent
      $('giWorldList').querySelectorAll('.gi-w').forEach(r => (r.style.outline = ''))
      row.style.outline = '2px solid var(--accent)'
    }))
  }
  const [mine, favs] = await Promise.all([api.vrchatMyWorlds().catch(() => ({})), api.vrchatFavWorlds().catch(() => ({}))])
  const all = []
  if (mine && mine.ok) all.push(...mine.worlds)
  if (favs && favs.ok) for (const w of favs.worlds) if (!all.some(x => x.id === w.id)) all.push(w)
  renderWorlds(all)
  $('giWorld').oninput = () => {
    const q = $('giWorld').value.trim()
    const m = q.match(/wrld_[0-9a-fA-F-]+/)
    if (m) selectedWorld = m[0]
    renderWorlds(all.filter(w => (w.name || '').toLowerCase().includes(q.toLowerCase())))
  }
  $('giCreate').onclick = async () => {
    const typed = $('giWorld').value.match(/wrld_[0-9a-fA-F-]+/)
    const worldId = typed ? typed[0] : selectedWorld
    if (!worldId) { setText('giOut', 'Pick or paste a world first.'); return }
    setText('giOut', 'Creating…')
    const r = await api.vrchatCreateGroupInstance(worldId, ov.dataset.group, $('giAccess').value, $('giRegion').value)
    if (r && r.ok) {
      setText('giOut', '✅ Instance created.')
      if (r.location) { const m = r.location.match(/^(wrld_[^:]+):(.+)$/); if (m) api.vrchatInviteSelf(r.location) }
    } else setText('giOut', 'Error: ' + ((r && r.error) || 'failed (need group-instance permission)'))
  }
}
async function loadGroupExtras (gid) {
  const mr = await api.vrchatGroupMembers(gid)
  if ($('grpMembers')) {
    $('grpMembers').innerHTML = (mr.ok && mr.members.length)
      ? `<div class="card-grid">${mr.members.map(m => `<div class="rb-friend" data-id="${m.id}" style="cursor:pointer"><img class="ava" src="${m.icon || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div class="meta grow"><div class="nm">${esc(m.name)}</div></div></div>`).join('')}</div>`
      : (mr.ok ? 'No members visible.' : esc(mr.error))
    $('grpMembers').querySelectorAll('.rb-friend').forEach(row => row.addEventListener('click', () => openUserModal(row.dataset.id)))
  }
  const rr = await api.vrchatGroupRoles(gid)
  if ($('grpRoles')) $('grpRoles').innerHTML = (rr.ok && rr.roles.length) ? rr.roles.map(r => `<span class="tagchip">${esc(r.name)}</span>`).join(' ') : (rr.ok ? 'No roles.' : esc(rr.error))
  const pr = await api.vrchatGroupPosts(gid)
  if ($('grpPosts')) $('grpPosts').innerHTML = (pr.ok && pr.posts.length) ? pr.posts.map(p => `<div style="padding:5px 0;border-top:1px solid var(--border)"><b>${esc(p.title || 'Post')}</b><div class="muted" style="font-size:.78rem">${esc(p.text || '')}</div></div>`).join('') : 'No posts.'
  const gal = await api.vrchatGroupGalleries(gid)
  if (gal.ok && gal.galleries.length) {
    const imgs = await api.vrchatGroupGalleryImages(gid, gal.galleries[0].id)
    if ($('grpGallery')) $('grpGallery').innerHTML = (imgs.ok && imgs.images.length) ? `<div class="card-grid">${imgs.images.map(u => `<img src="${u}" referrerpolicy="no-referrer" loading="lazy" decoding="async" style="width:100%;height:110px;object-fit:cover;border-radius:8px" />`).join('')}</div>` : 'No images.'
  } else if ($('grpGallery')) $('grpGallery').textContent = 'No galleries.'
}

/* ---------------- rail clock + launch ---------------- */
function tickRailClock () { if ($('railClock')) $('railClock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
tickRailClock(); setInterval(tickRailClock, 15000)
$('launchVrc').addEventListener('click', () => api.launchVRChat())

/* ---------------- notifications flyout (tabbed · unread badge) ---------------- */
const notifPanel = $('notifPanel')
let notifCache = [] // last fetched list (with read flags)
let notifTab = 'friendRequest'
// Bucket each notification into one of the four bell tabs.
function notifCat (n) {
  if (n.type === 'friendRequest') return 'friendRequest'
  if (/invite/i.test(n.type || '')) return 'invite' // invite, requestInvite, inviteResponse…
  if (n.type === 'group') return 'group'
  return 'vrchat'
}
$('notifBell').addEventListener('click', e => {
  e.stopPropagation()
  const show = notifPanel.style.display === 'none'
  notifPanel.style.display = show ? 'block' : 'none'
  if (show) loadNotifications().then(markNotifsReadOnView) // opening = reviewed → badge clears
})
document.addEventListener('click', e => {
  if (notifPanel.style.display !== 'none' && !notifPanel.contains(e.target) && !$('notifBell').contains(e.target)) notifPanel.style.display = 'none'
})
$('notifRefresh').addEventListener('click', loadNotifications)
if ($('notifRefreshPage')) $('notifRefreshPage').addEventListener('click', loadNotifications)
if ($('notifClearAll')) $('notifClearAll').addEventListener('click', async () => { await api.notifClear(); loadNotifications() })
if ($('notifMarkRead')) $('notifMarkRead').addEventListener('click', () => markAllNotifsRead(true))
if ($('notifMarkReadPage')) $('notifMarkReadPage').addEventListener('click', () => markAllNotifsRead(true))
document.querySelector('[data-tab="notify"]').addEventListener('click', loadNotifications)
document.querySelectorAll('#notifPanel .ntab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#notifPanel .ntab').forEach(x => x.classList.remove('active'))
  b.classList.add('active'); notifTab = b.dataset.ntab; renderNotifList()
}))

function setNotifCount (n) { const c = $('notifCount'); if (!c) return; if (n > 0) { c.style.display = 'flex'; c.textContent = n > 99 ? '99+' : String(n) } else c.style.display = 'none' }
async function refreshNotifBadge () { try { setNotifCount(await api.notifUnreadCount()) } catch (_) {} }
// Mark everything read. rerender=true also clears the "unread" highlight immediately
// (used by the buttons); on-view marking keeps highlights for the current glance.
async function markAllNotifsRead (rerender) {
  await api.notifMarkAllRead()
  notifCache.forEach(n => { n.read = 1 })
  setNotifCount(0)
  if (rerender) renderNotifList(); else updateNotifTabCounts()
}
function markNotifsReadOnView () { if (notifCache.some(n => !n.read)) markAllNotifsRead(false) }

function notifItemHtml (n) {
  const when = new Date(n.ts || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  let title
  if (n.type === 'friendRequest') title = `Friend request from <b>${esc(n.sender)}</b>`
  else if (n.type === 'invite') title = `<b>${esc(n.sender)}</b> invited you${n.world ? ` to <b>${esc(n.world)}</b>` : ''}`
  else if (n.type === 'requestInvite') title = `<b>${esc(n.sender)}</b> requested an invite`
  else if (n.type === 'boop') title = `<b>${esc(n.sender)}</b> booped you 👉`
  else if (n.type === 'group') title = `📣 <b>${esc(n.sender || 'Group')}</b>`
  else title = `<b>${esc(n.sender || n.type)}</b> ${esc(n.message || '')}`
  const sub = (n.message && n.type !== 'friendRequest' && n.type !== 'boop') ? `<div class="muted" style="font-size:.74rem">${esc(n.message)}</div>` : ''
  const accept = n.type === 'friendRequest' ? `<button class="btn nf-accept" data-id="${n.id}" style="padding:3px 9px;font-size:.72rem">Accept</button>` : ''
  const join = (n.link) ? `<a class="btn nf-join" href="${n.link}" target="_blank" style="padding:3px 9px;font-size:.72rem">Join</a>` : ''
  const unread = n.read ? '' : 'border-left:3px solid var(--accent,#7c5cff);padding-left:7px;'
  return `<div class="notif-item" style="${unread}"><div class="grow">${title}${sub}<div class="when">${when}</div></div>${accept}${join}<button class="btn ghost nf-dismiss" data-id="${n.id}" title="Dismiss" style="padding:3px 8px;font-size:.72rem">×</button></div>`
}
function updateNotifTabCounts () {
  const cats = { friendRequest: 0, invite: 0, vrchat: 0, group: 0 }
  notifCache.forEach(n => { if (!n.read) cats[notifCat(n)]++ })
  document.querySelectorAll('#notifPanel .ntab').forEach(b => {
    const span = b.querySelector('.ntab-c'); if (span) span.textContent = cats[b.dataset.ntab] ? `(${cats[b.dataset.ntab]})` : ''
  })
}
function renderNotifList () {
  updateNotifTabCounts()
  const items = notifCache.filter(n => notifCat(n) === notifTab)
  if ($('notifList')) $('notifList').innerHTML = items.length ? items.map(notifItemHtml).join('') : '<div class="muted">Nothing here.</div>'
  if ($('notifPageList')) $('notifPageList').innerHTML = notifCache.length ? notifCache.map(notifItemHtml).join('') : '<div class="muted">No notifications.</div>'
}
async function loadNotifications () {
  notifCache = await api.notifList()
  renderNotifList()
  refreshNotifBadge()
}
// Delegated accept/dismiss for notification items (flyout + page).
document.addEventListener('click', async e => {
  const acc = e.target.closest('.nf-accept'); const dis = e.target.closest('.nf-dismiss')
  if (acc) { acc.disabled = true; acc.textContent = '…'; await api.notifAccept(acc.dataset.id); loadNotifications() }
  if (dis) { dis.disabled = true; await api.notifDismiss(dis.dataset.id); loadNotifications() }
})
api.on('notif:new', n => { toast(`<b>🔔 ${esc(n.sender || 'VRChat')}</b><br>${esc((n.type === 'invite' ? 'invited you' + (n.world ? ' to ' + n.world : '') : n.type === 'boop' ? 'booped you 👉' : n.type === 'friendRequest' ? 'friend request' : n.message || n.type))}`) })
api.on('notif:update', () => loadNotifications())

/* ---------------- right friends panel ---------------- */
const RB_COLOR = { 'join me': '#3b82f6', active: '#22c55e', 'ask me': '#f59e0b', busy: '#ef4444', offline: '#6b7280' }
let rbFriendsCache = { online: [], offline: [] }
let favFriendIds = new Set()
let favFriendGroups = {} // friend id -> favorite group name
let favGroupNames = {} // group name -> display name
let myUserId = ''
const rbCollapsed = { same: false, online: false, web: false, offline: true } // offline collapsed by default
// VRCX-style state, derived from the API bucket (f.online) + location, NOT the
// unreliable `state` field: online = in a world, active = on the website, offline.
function friendState (f) {
  if (!f.online) return 'offline'
  if (!f.location || f.location === 'offline') return 'active' // online account, on the website
  return 'online' // in a world / instance (incl. private / traveling)
}
function rbFriendRow (f) {
  const st = friendState(f)
  const color = st === 'offline' ? '#6b7280' : (st === 'active' ? '#f59e0b' : (RB_COLOR[String(f.status || '').toLowerCase()] || '#22c55e'))
  const name = String(f.displayName || '?').replace(/</g, '&lt;')
  // fmtLocation returns safe HTML (the .wn world-name span, with its own escaping) —
  // do NOT re-escape it or the span shows up as literal text.
  const loc = st === 'active' ? '🌐 On the website' : (st === 'offline' ? '⚫ Offline' : fmtLocation(f.location))
  const ava = `<img class="ava" src="${f.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" onerror="this.src='assets/logo.png'" />`
  return `<div class="rb-friend" data-id="${f.id}">${ava}<span class="dot" style="background:${color}"></span><div class="meta grow"><div class="nm">${name} ${langBadges(f.languages)} ${rankPill(f.communityRank, { minTier: 5 })}</div><div class="lo">${loc}</div></div></div>`
}
function rbSection (key, title, friends) {
  if (!friends.length && key !== 'offline') return ''
  const collapsed = rbCollapsed[key]
  // Sidebar shows ALL friends in the group (no paging cap) — paging only lives on
  // the left-hand Friends menu.
  const rows = collapsed
    ? ''
    : (friends.map(rbFriendRow).join('') || '<div class="muted" style="padding:4px 6px;font-size:.78rem">None</div>')
  return `<div class="rb-group rb-toggle" data-grp="${key}">${collapsed ? '▸' : '▾'} ${title} — ${friends.length}</div>${rows}`
}
function renderRightbar () {
  const q = ($('rbSearch').value || '').toLowerCase()
  const myLoc = window.__myLocation || ''
  const match = f => !q || String(f.displayName || '').toLowerCase().includes(q)
  const online = (rbFriendsCache.online || []).filter(match)
  const offline = (rbFriendsCache.offline || []).filter(match)
  // VRCX-style buckets. Precedence for online-account friends: same world → your
  // favorite categories → in-game (Online) → website-only (Active).
  const same = []; const inGame = []; const web = []; const favBuckets = {}
  for (const f of online) {
    const st = friendState(f)
    if (st === 'active') { web.push(f); continue } // on the website, not in a world
    if (myLoc && f.location === myLoc) { same.push(f); continue }
    if (favFriendIds.has(f.id)) { const g = favFriendGroups[f.id] || 'group_0'; (favBuckets[g] = favBuckets[g] || []).push(f) } else inGame.push(f)
  }
  let html = rbSection('same', '🏠 Same World', same)
  // Your favorite-friend categories (the groups you set up in VRChat).
  for (const g of Object.keys(favBuckets).sort()) html += rbSection('fav:' + g, '⭐ ' + (favGroupNames[g] || 'Favorites'), favBuckets[g])
  html += rbSection('online', '🟢 Online — in a world', inGame)
  html += rbSection('web', '🌐 Active — on the website', web)
  html += rbSection('offline', '⚫ Offline', offline)
  $('rbFriends').innerHTML = html
  resolveWorldNames($('rbFriends'))
}
async function loadRightbar () {
  if (!await api.vrchatIsLoggedIn()) { $('rbFriends').textContent = 'Log in on the VRChat tab.'; return }
  // One reconciled call gets the WHOLE friend list (including the stragglers the
  // paginated buckets drop), then we split it online/offline ourselves.
  const [all, me] = await Promise.all([api.vrchatAllFriends(), api.vrchatStatus()])
  if (me && me.ok && me.user) {
    myUserId = me.user.id || ''
    setText('rbName', me.user.displayName || '—')
    setText('rbStatus', me.user.statusDescription || me.user.status || '')
    const avatarUrl = me.user.userIcon || 'assets/vrchat.png'
    $('rbAvatar').src = avatarUrl
    const sa = $('sidebarAvatar')
    if (sa) {
      sa.src = avatarUrl
      sa.title = me.user.displayName || ''
      sa.style.display = ''
    }
  }
  if (all && all.ok) {
    // Trust the API's online/offline buckets (see getAllFriends) — not per-friend state.
    rbFriendsCache.online = all.online || all.friends.filter(f => f.online)
    rbFriendsCache.offline = all.offline || all.friends.filter(f => !f.online)
  }
  try { const fav = await api.vrchatFavFriendIds(); if (fav.ok) { favFriendIds = new Set(fav.ids); favFriendGroups = fav.groups || {} } } catch (_) {}
  try { const fg = await api.vrchatFavGroups('friend'); if (fg.ok) { favGroupNames = {}; fg.groups.forEach(g => { favGroupNames[g.name] = g.displayName || g.name }) } } catch (_) {}
  if (all && all.ok) renderRightbar()
  else $('rbFriends').textContent = (all && all.error) || 'Could not load friends.'
}
$('rbSearch').addEventListener('input', renderRightbar)
setInterval(loadRightbar, 120000)
$('rbFriends').addEventListener('click', e => {
  const toggle = e.target.closest('.rb-toggle')
  if (toggle) { const k = toggle.dataset.grp; rbCollapsed[k] = !rbCollapsed[k]; renderRightbar(); return }
  const row = e.target.closest('.rb-friend')
  if (row && row.dataset.id) openUserModal(row.dataset.id)
})
// Click your own profile header or sidebar avatar to open your full profile.
const rbProfileEl = document.querySelector('.rb-profile')
if (rbProfileEl) { rbProfileEl.style.cursor = 'pointer'; rbProfileEl.addEventListener('click', () => { if (myUserId) openUserModal(myUserId) }) }
const sidebarAvatarEl = $('sidebarAvatar')
if (sidebarAvatarEl) sidebarAvatarEl.addEventListener('click', () => { if (myUserId) openUserModal(myUserId) })

/* ---------------- user profile modal ---------------- */
function trustRank (tags) {
  tags = tags || []
  if (tags.includes('system_trust_veteran')) return { label: 'Trusted User', color: '#8b5cf6' }
  if (tags.includes('system_trust_trusted')) return { label: 'Known User', color: '#f59e0b' }
  if (tags.includes('system_trust_known')) return { label: 'User', color: '#22c55e' }
  if (tags.includes('system_trust_basic')) return { label: 'New User', color: '#3b82f6' }
  return { label: 'Visitor', color: '#9ca3af' }
}
function esc (s) { return String(s == null ? '' : s).replace(/</g, '&lt;') }
let umCurrentId = null
let umUser = null
function closeUserModal () { $('userModal').style.display = 'none' }
$('userModalClose').addEventListener('click', closeUserModal)
$('userModal').addEventListener('click', e => { if (e.target === $('userModal')) closeUserModal() })
function umLocationLine (u) {
  if (u.location && u.location !== 'offline') return `📍 ${fmtLocation(u.location)}`
  return u.state === 'online' ? '🟢 Active on the website' : '⚫ Offline'
}
// Self-invite / copy-URL for a user's instance — only when it's a joinable
// (non-private) instance. Private instances just point to Request Invite.
function umJoinActions (u) {
  const i = parseLoc(u.location)
  if (!i.worldId) return ''
  if (i.private) return '<div class="muted" style="font-size:.74rem;margin-top:6px">🔒 In a private world — use Request Invite below.</div>'
  const url = `https://vrchat.com/home/launch?worldId=${i.worldId}&instanceId=${encodeURIComponent(i.instanceId)}`
  return `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
    <button class="btn ghost" id="umSelfInvite" data-loc="${esc(u.location)}" style="padding:4px 10px;font-size:.75rem">➡️ Invite me here</button>
    <button class="btn ghost" id="umCopyUrl" data-url="${esc(url)}" style="padding:4px 10px;font-size:.75rem">📋 Copy world URL</button>
  </div>`
}
async function openUserModal (id) {
  umCurrentId = id; umUser = null
  $('userModal').style.display = 'flex'
  $('umName').textContent = 'Loading…'
  setText('umStatusDesc', ''); $('umTags').innerHTML = ''; setText('umActionOut', '')
  $('umTabBody').innerHTML = '<div class="muted">Loading…</div>'
  const r = await api.vrchatUser(id)
  if (!r.ok) { $('umName').textContent = 'Error'; setText('umActionOut', r.error || 'Could not load user'); $('umTabBody').innerHTML = ''; return }
  umUser = r.user
  const u = umUser
  $('umName').textContent = u.displayName || '—'
  setText('umStatusDesc', u.statusDescription || u.status || '')
  $('umAvatar').src = u.userIcon || u.profilePicOverride || u.currentAvatarThumbnailImageUrl || 'assets/logo.png'
  // Banner: VRC+ users' custom profile image if set, otherwise their avatar image.
  const isVrcPlus = (u.tags || []).includes('system_supporter')
  const bannerUrl = (isVrcPlus && u.profilePicOverride) ? u.profilePicOverride : (u.currentAvatarImageUrl || u.profilePicOverride || '')
  $('umBanner').style.backgroundImage = bannerUrl ? `url("${bannerUrl}")` : ''
  const tr = trustRank(u.tags)
  const chips = [`<span class="tagchip" style="border-color:${tr.color};color:${tr.color}">${tr.label}</span>`]
  // NekoSuneAPPS Community Rank, estimated from VRChat trust (shows Veteran/Legend
  // when earned). Only when the feature is enabled.
  if (ranksUi.enabled) {
    try {
      const cr = await api.ranksEstimate(u.tags, u.date_joined)
      const isOgShown = cr && (cr.key === 'veteran' || cr.key === 'legend')
      if (cr) { chips.push(`<span class="tagchip rank-pill${isOgShown ? ' rank-og' : ''}" title="Estimated from VRChat trust" style="border-color:${cr.color};color:${cr.color}">🏅 ${esc(cr.shortLabel)}</span>`); if (cr.vrcPlus) chips.push('<span class="tagchip" title="VRChat Plus supporter">✦ VRC+</span>') }
    } catch (_) {}
  }
  if (u.last_platform) chips.push(`<span class="tagchip">${u.last_platform === 'standalonewindows' ? 'PC' : (u.last_platform === 'android' ? 'Quest' : u.last_platform)}</span>`)
  if ((u.tags || []).includes('system_supporter')) chips.push('<span class="tagchip">VRC+</span>')
  if (u.ageVerified || (u.tags || []).includes('system_age_verified')) chips.push('<span class="tagchip">18+</span>')
  // Spoken languages, derived from the user's language_xxx tags → flag chips.
  const umLangs = (u.tags || []).filter(t => typeof t === 'string' && t.startsWith('language_')).map(t => t.slice(9))
  for (const c of umLangs) { const m = LANG_FLAG[c] || ['🌐', c.toUpperCase()]; chips.push(`<span class="tagchip" title="${m[1]}">${m[0]} ${m[1]}</span>`) }
  $('umTags').innerHTML = chips.join('')
  $('umAddFriend').textContent = u.isFriend ? '➖ Unfriend' : '➕ Add Friend'
  $('umAddFriend').classList.toggle('danger', !!u.isFriend)
  // On your OWN profile, hide friend/invite/boop actions (they don't apply to you).
  if (!myUserId) { try { const me = await api.vrchatStatus(); if (me && me.ok) myUserId = me.user.id } catch (_) {} }
  const isMe = u.id === myUserId
  ;['umAddFriend', 'umInvite', 'umRequestInvite', 'umFav', 'umBoop', 'umMute', 'umBlock'].forEach(k => { $(k).style.display = isMe ? 'none' : '' })
  _umBlocked = false; _umMuted = false
  $('umBlock').textContent = '🚫 Block'; $('umMute').textContent = '🔇 Mute'
  renderMTab('info')
}
async function renderMTab (tab) {
  document.querySelectorAll('.mtab').forEach(t => t.classList.toggle('active', t.dataset.mtab === tab))
  const body = $('umTabBody'); const u = umUser; if (!u) return
  if (tab === 'info') {
    const links = (u.bioLinks || []).filter(Boolean).map(l => { let h = l; try { h = new URL(l).hostname } catch (_) {} return `<a href="${l}" target="_blank" class="btn ghost" style="padding:3px 10px;font-size:.74rem">🔗 ${esc(h)}</a>` }).join('')
    const badges = (u.badges || []).filter(b => b.badgeImageUrl).map(b => `<img class="badge-img" src="${b.badgeImageUrl}" title="${esc(b.badgeName)}${b.badgeDescription ? ' — ' + esc(b.badgeDescription) : ''}" referrerpolicy="no-referrer" loading="lazy" decoding="async" />`).join('')
    const rows = [['Platform', u.last_platform === 'standalonewindows' ? 'PC' : (u.last_platform || '—')]]
    if (u.date_joined) rows.push(['Joined', u.date_joined])
    if (u.last_login) { try { rows.push(['Last login', new Date(u.last_login).toLocaleDateString()]) } catch (_) {} }
    rows.push(['Age verified', u.ageVerified ? 'Yes' : 'No'])
    rows.push(['Avatar cloning', u.allowAvatarCopying ? 'On' : 'Off'])
    const trustLadder = (() => {
      const LEVELS = [
        { tag: null, label: 'Visitor', color: '#9ca3af' },
        { tag: 'system_trust_basic', label: 'New User', color: '#3b82f6' },
        { tag: 'system_trust_known', label: 'User', color: '#22c55e' },
        { tag: 'system_trust_trusted', label: 'Known User', color: '#f59e0b' },
        { tag: 'system_trust_veteran', label: 'Trusted User', color: '#8b5cf6' },
      ]
      const tags = u.tags || []; let cur = 0
      LEVELS.forEach((l, i) => { if (l.tag && tags.includes(l.tag)) cur = i })
      const steps = LEVELS.map((l, i) =>
        `<span style="padding:3px 9px;border-radius:20px;font-size:.72rem;font-weight:${i===cur?700:400};border:1.5px solid ${i===cur?l.color:'var(--border)'};color:${i===cur?l.color:'var(--muted)'};background:${i===cur?l.color+'22':'transparent'}">${i===cur?'●':'○'} ${l.label}</span>`
      ).join('<span class="muted" style="font-size:.7rem">›</span>')
      return `<div class="um-sec">Trust Level</div><div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:8px">${steps}</div>`
    })()
    const noteBlock = (u.id !== myUserId)
      ? `<div class="um-sec">Your note</div><textarea id="umNote" rows="2" placeholder="Private note about this user">${esc(u.note || '')}</textarea><div class="row" style="margin-top:6px"><button class="btn ghost" id="umNoteSave" style="padding:4px 10px;font-size:.75rem">Save note</button><span class="muted" id="umNoteOut" style="font-size:.74rem"></span></div>`
      : ''
    // Previous display names, reconstructed from the local name-change history.
    const pastBlock = await pastNamesBlock(u.displayName)
    body.innerHTML =
      `<div class="rb-card">${umLocationLine(u)}${umJoinActions(u)}</div>` +
      (u.bio ? `<div class="um-bio">${esc(u.bio)}</div>` : '') +
      (links ? `<div class="row" style="flex-wrap:wrap;gap:8px">${links}</div>` : '') +
      (badges ? `<div class="um-sec">Badges</div><div class="badge-grid">${badges}</div>` : '') +
      pastBlock +
      trustLadder +
      `<div class="um-sec">Info</div><div class="um-info">${rows.map(r => `<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` +
      noteBlock
    resolveWorldNames(body) // fill in the world name for a joinable instance
    const ns = $('umNoteSave')
    if (ns) ns.addEventListener('click', async () => { setText('umNoteOut', 'Saving…'); const r = await api.vrchatSetNote(u.id, $('umNote').value); setText('umNoteOut', r.ok ? '✅ Saved' : 'Error: ' + (r.error || 'failed')) })
    const si = $('umSelfInvite')
    if (si) si.addEventListener('click', async () => { setText('umActionOut', 'Inviting…'); const r = await api.vrchatInviteSelf(si.dataset.loc); setText('umActionOut', r && r.ok ? '✅ Invited yourself — accept it in VRChat' : 'Error: ' + ((r && r.error) || 'failed')) })
    const cu = $('umCopyUrl')
    if (cu) cu.addEventListener('click', async () => { await api.clipboardWrite(cu.dataset.url); cu.textContent = 'Copied ✓'; setTimeout(() => { cu.textContent = '📋 Copy world URL' }, 1500) })
    // Time-together / last-seen from local History (matched by display name).
    if (u.id !== myUserId) {
      api.historyList({ limit: 3000 }).then(rows => {
        const meets = (rows || []).filter(h => h.type === 'join' && h.name === u.displayName)
        if (meets.length && $('umTabBody')) {
          const last = new Date(meets[0].ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          const note = document.createElement('div'); note.className = 'muted'; note.style.cssText = 'font-size:.78rem;margin-top:6px'
          note.textContent = `🐾 Seen together ${meets.length}× · last ${last}`
          $('umTabBody').appendChild(note)
        }
      })
    }
  } else if (tab === 'groups') {
    body.innerHTML = '<div class="muted">Loading groups…</div>'
    const r = await api.vrchatUserGroups(u.id)
    if (!r.ok) { body.innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
    if (!r.groups.length) { body.innerHTML = '<div class="muted">No groups.</div>'; return }
    const own = r.groups.filter(g => g.ownerId === u.id)
    const mem = r.groups.filter(g => g.ownerId !== u.id)
    let html = ''
    if (own.length) html += `<div class="mgroup">Own Groups — ${own.length}</div><div class="card-grid">${own.map(groupCard).join('')}</div>`
    if (mem.length) html += `<div class="mgroup">Groups — ${mem.length}</div><div class="card-grid">${mem.map(groupCard).join('')}</div>`
    body.innerHTML = html
  } else if (tab === 'content') {
    body.innerHTML = '<div class="muted">Loading worlds…</div>'
    const r = await api.vrchatUserWorlds(u.id)
    body.innerHTML = !r.ok ? `<div class="muted">${esc(r.error)}</div>` : (r.worlds.length ? `<div class="card-grid">${r.worlds.map(w => `<div class="mini-card"><img src="${w.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(w.name)}</div><div class="muted" style="font-size:.72rem">👤 ${w.visits || 0} · ⭐ ${w.favorites || 0}</div></div></div>`).join('')}</div>` : '<div class="muted">No public worlds.</div>')
  } else if (tab === 'mutuals') {
    body.innerHTML = '<div class="modal-tabs" style="padding:0 0 10px"><button class="mtab active" data-msub="friends">Friends</button><button class="mtab" data-msub="groups">Groups</button></div><div id="umMutBody"></div>'
    body.querySelectorAll('[data-msub]').forEach(b => b.addEventListener('click', () => { body.querySelectorAll('[data-msub]').forEach(x => x.classList.toggle('active', x === b)); renderMutSub(b.dataset.msub) }))
    renderMutSub('friends')
  } else if (tab === 'favs') {
    if (umUser.id !== myUserId) { body.innerHTML = '<div class="muted">No public favorite worlds. (A user’s favorites are only visible if they’ve made them public.)</div>'; return }
    body.innerHTML = '<div class="muted">Loading favorites…</div>'
    const r = await api.vrchatFavWorlds()
    if (!r.ok) { body.innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
    if (!r.worlds.length) { body.innerHTML = '<div class="muted">No favorite worlds.</div>'; return }
    _pageState.favtab = 0
    renderPaged(body, r.worlds, 24, worldCard, 'favtab', 'card-grid')
  }
}
function worldCard (w) {
  return `<div class="mini-card" data-kind="world" data-id="${w.id}" style="cursor:pointer"><img src="${w.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(w.name)}</div><div class="muted" style="font-size:.72rem">👤 ${w.visits || w.occupants || 0} · ⭐ ${w.favorites || 0}</div></div></div>`
}
function groupCard (g) {
  return `<div class="mini-card" data-kind="group" data-id="${g.id}" style="cursor:pointer"><img src="${g.icon || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div style="min-width:0"><div class="nm">${esc(g.name)}</div><div class="muted" style="font-size:.72rem">${g.members ? g.members + ' members' : (g.shortCode ? '@' + esc(g.shortCode) : '')}</div></div></div>`
}
// Any clickable world/group/avatar mini-card opens its detail modal.
document.addEventListener('click', e => {
  if (e.target.closest('button') || e.target.closest('a')) return // let buttons/links act
  const c = e.target.closest('.mini-card[data-id]')
  if (!c) return
  if (c.dataset.kind === 'world') openWorldModal(c.dataset.id)
  else if (c.dataset.kind === 'group') openGroupModal(c.dataset.id)
  else if (c.dataset.kind === 'avatar') openAvatarModal(c.dataset.id)
})
async function openAvatarModal (id) {
  $('detailModal').style.display = 'flex'
  $('dmName').textContent = 'Loading…'; setText('dmSub', ''); $('dmActions').innerHTML = ''; $('dmBody').innerHTML = ''
  const r = await api.vrchatAvatar(id)
  if (!r.ok) { $('dmName').textContent = 'Error'; $('dmBody').innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
  const a = r.avatar
  $('dmName').textContent = a.name || '—'; setText('dmSub', 'Avatar by ' + (a.author || '?'))
  $('dmImage').src = a.image || 'assets/logo.png'; $('dmBanner').style.backgroundImage = a.image ? `url("${a.image}")` : ''
  $('dmActions').innerHTML = `<button class="btn" id="avWear">Wear</button><button class="btn ghost" id="avFav">⭐ Favorite</button>`
  $('avWear').addEventListener('click', async () => { $('avWear').textContent = '…'; const w = await api.vrchatSelectAvatar(a.id); $('avWear').textContent = w.ok ? '✓ Worn' : '✗ ' + (w.error || '') })
  $('avFav').addEventListener('click', async () => { const f = await api.vrchatAddFav('avatar', a.id); setText('dmSub', f.ok ? '⭐ Favorited' : 'Error: ' + (f.error || '')) })
  $('dmBody').innerHTML = (a.description ? `<div class="um-bio">${esc(a.description)}</div>` : '') + dmInfo([
    ['Platforms', (a.platforms || []).map(p => p === 'standalonewindows' ? 'PC' : p === 'android' ? 'Quest' : p).join(', ') || '—'],
    ['Performance', (a.performance || []).join(', ') || '—'],
    ['Status', a.releaseStatus || ''], ['Updated', a.updated ? new Date(a.updated).toLocaleDateString() : '']
  ])
}
async function renderMutSub (sub) {
  const el = $('umMutBody'); if (!el || !umUser) return
  el.innerHTML = '<div class="muted">Loading…</div>'
  if (sub === 'friends') {
    const r = await api.vrchatMutuals(umUser.id)
    if (r.off) { el.innerHTML = '<div class="muted">This user has Shared Connections turned off.</div>'; return }
    if (!r.ok) { el.innerHTML = `<div class="muted">${esc(r.error)}</div>`; return }
    if (!r.friends.length) { el.innerHTML = '<div class="muted">No mutual friends.</div>'; return }
    _pageState.mutf = 0
    renderPaged(el, r.friends, 40, f => `<div class="rb-friend" data-id="${f.id}" style="cursor:pointer"><img class="ava" src="${f.image || 'assets/logo.png'}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /><div class="meta grow"><div class="nm">${esc(f.displayName)}</div></div></div>`, 'mutf', '', c => c.querySelectorAll('.rb-friend').forEach(row => { row.onclick = () => openUserModal(row.dataset.id) }))
  } else {
    const [tg, mg] = await Promise.all([api.vrchatUserGroups(umUser.id), api.vrchatGroups()])
    if (!tg.ok) { el.innerHTML = `<div class="muted">${esc(tg.error)}</div>`; return }
    const mine = new Set((mg.ok ? mg.groups : []).map(g => g.id))
    const shared = tg.groups.filter(g => mine.has(g.id))
    if (!shared.length) { el.innerHTML = '<div class="muted">No mutual groups.</div>'; return }
    _pageState.mutg = 0
    renderPaged(el, shared, 24, groupCard, 'mutg', 'card-grid')
  }
}
document.querySelectorAll('.mtab[data-mtab]').forEach(t => t.addEventListener('click', () => renderMTab(t.dataset.mtab)))
$('umAddFriend').addEventListener('click', async () => {
  if (!umCurrentId || !umUser) return
  const isFriend = umUser.isFriend
  setText('umActionOut', isFriend ? 'Removing friend…' : 'Sending friend request…')
  const r = isFriend ? await api.vrchatUnfriend(umCurrentId) : await api.vrchatFriendRequest(umCurrentId)
  if (r.ok && isFriend) { umUser.isFriend = false; $('umAddFriend').textContent = '➕ Add Friend'; $('umAddFriend').classList.remove('danger') }
  setText('umActionOut', r.ok ? (isFriend ? '✅ Unfriended' : '✅ Friend request sent') : 'Error: ' + (r.error || 'failed'))
})
$('umInvite').addEventListener('click', async () => {
  if (!umCurrentId) return
  const myLoc = window.__myLocation || ''
  if (!myLoc) { setText('umActionOut', 'You must be in a VRChat world to invite someone to your instance.'); return }
  setText('umActionOut', 'Inviting…')
  const r = await api.vrchatInvite(umCurrentId, myLoc)
  setText('umActionOut', r.ok ? '✅ Invite sent' : 'Error: ' + (r.error || 'failed'))
})
$('umRequestInvite').addEventListener('click', async () => {
  if (!umCurrentId) return
  setText('umActionOut', 'Requesting invite…')
  const r = await api.vrchatRequestInvite(umCurrentId)
  setText('umActionOut', r.ok ? '✅ Invite requested' : 'Error: ' + (r.error || 'failed'))
})
$('umBoop').addEventListener('click', async () => {
  if (!umCurrentId) return
  setText('umActionOut', 'Booping…')
  const r = await api.vrchatBoop(umCurrentId)
  setText('umActionOut', r.ok ? '👉 Booped!' : 'Error: ' + (r.error || 'failed'))
})
$('umFav').addEventListener('click', async () => {
  if (!umCurrentId) return
  setText('umActionOut', 'Favoriting…')
  const r = await api.vrchatAddFav('friend', umCurrentId)
  setText('umActionOut', r.ok ? '⭐ Added to favorites' : 'Error: ' + (r.error || 'failed'))
})
let _umBlocked = false; let _umMuted = false
$('umBlock').addEventListener('click', async () => {
  if (!umCurrentId) return
  setText('umActionOut', _umBlocked ? 'Unblocking…' : 'Blocking…')
  const r = _umBlocked ? await api.vrchatUnmoderate(umCurrentId, 'block') : await api.vrchatModerate(umCurrentId, 'block')
  if (r.ok) { _umBlocked = !_umBlocked; $('umBlock').textContent = _umBlocked ? '✅ Unblock' : '🚫 Block' }
  setText('umActionOut', r.ok ? (_umBlocked ? '🚫 Blocked' : 'Unblocked') : 'Error: ' + (r.error || 'failed'))
})
$('umMute').addEventListener('click', async () => {
  if (!umCurrentId) return
  setText('umActionOut', _umMuted ? 'Unmuting…' : 'Muting…')
  const r = _umMuted ? await api.vrchatUnmoderate(umCurrentId, 'mute') : await api.vrchatModerate(umCurrentId, 'mute')
  if (r.ok) { _umMuted = !_umMuted; $('umMute').textContent = _umMuted ? '🔊 Unmute' : '🔇 Mute' }
  setText('umActionOut', r.ok ? (_umMuted ? '🔇 Muted' : 'Unmuted') : 'Error: ' + (r.error || 'failed'))
})

/* ---------------- shared: confirm + friend picker ---------------- */
let _confirmResolve = null
function confirmDialog (text) {
  $('confirmText').textContent = text || 'Are you sure?'
  $('confirmModal').style.display = 'flex'
  return new Promise(res => { _confirmResolve = res })
}
function _confirmEnd (v) { $('confirmModal').style.display = 'none'; if (_confirmResolve) _confirmResolve(v); _confirmResolve = null }
$('confirmYes').addEventListener('click', () => _confirmEnd(true))
$('confirmNo').addEventListener('click', () => _confirmEnd(false))
$('confirmModal').addEventListener('click', e => { if (e.target === $('confirmModal')) _confirmEnd(false) })

// Electron has no window.prompt — use a modal. Returns the string, or null if cancelled.
let _promptResolve = null
function promptDialog (text, defaultValue = '') {
  $('promptText').textContent = text || 'Enter a value'
  $('promptInput').value = defaultValue
  $('promptModal').style.display = 'flex'
  setTimeout(() => { $('promptInput').focus(); $('promptInput').select() }, 30)
  return new Promise(res => { _promptResolve = res })
}
function _promptEnd (v) { $('promptModal').style.display = 'none'; if (_promptResolve) _promptResolve(v); _promptResolve = null }
$('promptOk').addEventListener('click', () => _promptEnd($('promptInput').value))
$('promptCancel').addEventListener('click', () => _promptEnd(null))
$('promptModal').addEventListener('click', e => { if (e.target === $('promptModal')) _promptEnd(null) })
$('promptInput').addEventListener('keydown', e => { if (e.key === 'Enter') _promptEnd($('promptInput').value); if (e.key === 'Escape') _promptEnd(null) })

/* ---------------- update available ---------------- */
// Minimal Markdown -> HTML for release notes (headings, bold, code, lists, links).
function mdToHtml (md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = s => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:4px">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="#" data-ext="$2" style="color:var(--accent,#7c5cff)">$1</a>')
  return String(md || '').split(/\r?\n/).map(raw => {
    const line = raw.trim()
    if (!line) return ''
    let m = line.match(/^#{1,6}\s+(.*)$/)
    if (m) return `<div style="font-weight:700;margin:10px 0 2px">${inline(m[1])}</div>`
    m = line.match(/^[-*]\s+(.*)$/)
    if (m) return `<div style="margin-left:6px">• ${inline(m[1])}</div>`
    if (/^---+$/.test(line)) return '<hr style="border:none;border-top:1px solid var(--border);margin:8px 0">'
    return `<div>${inline(line)}</div>`
  }).join('')
}
let _updateInfo = null
function showUpdate (info) {
  _updateInfo = info
  if (!$('updateModal')) return
  setText('updateText', `You're on v${info.current}. Version v${info.latest} is available on GitHub.`)
  if ($('updateNotes')) {
    if (info.notes) { $('updateNotes').innerHTML = mdToHtml(info.notes); $('updateNotes').style.display = 'block' } else { $('updateNotes').style.display = 'none' }
  }
  $('updateModal').style.display = 'flex'
}
if ($('updateInstall')) $('updateInstall').addEventListener('click', async () => {
  if (!_updateInfo) return
  // No update asset was published for this platform on this release - fall
  // back to the manual open-in-browser behavior rather than failing outright.
  if (!_updateInfo.updateAssetUrl) {
    api.openExternal(_updateInfo.installerUrl || _updateInfo.url)
    $('updateModal').style.display = 'none'
    return
  }
  const btn = $('updateInstall')
  const laterBtn = $('updateLater')
  btn.disabled = true
  if (laterBtn) laterBtn.disabled = true
  if ($('updateProgressWrap')) $('updateProgressWrap').style.display = 'block'
  setText('updateProgressText', 'Opening the updater — NekoSuneAPPS will close, and a separate updater window will show download and install progress…')
  try {
    // The standalone updater window takes it from here (download progress,
    // installing, relaunching) - this app quits itself right after this
    // call succeeds.
    await api.updateStart({ url: _updateInfo.updateAssetUrl, name: _updateInfo.updateAssetName, version: _updateInfo.latest })
  } catch (err) {
    setText('updateProgressText', `Update failed: ${err.message}`)
    btn.disabled = false
    if (laterBtn) laterBtn.disabled = false
  }
})
// "Remind me later" — just dismiss; it'll check again next launch.
if ($('updateLater')) $('updateLater').addEventListener('click', () => { if ($('updateModal')) $('updateModal').style.display = 'none' })
if ($('updateModal')) $('updateModal').addEventListener('click', e => { if (e.target === $('updateModal') && !$('updateInstall').disabled) $('updateModal').style.display = 'none' })
api.on('update:available', info => { if (info && info.available) showUpdate(info) })

/* ---------------- About page ---------------- */
// Open any element with data-ext="https://…" in the external browser.
document.addEventListener('click', e => {
  const b = e.target.closest('[data-ext]'); if (!b) return
  e.preventDefault(); api.openExternal(b.dataset.ext)
})
let _aboutLoaded = false
async function loadAbout () {
  try { const v = await api.appVersion(); setText('aboutVersion', `version ${v}`) } catch (_) {}
  if (_aboutLoaded) return
  _aboutLoaded = true
  // Contributors (auto-detected from GitHub)
  try {
    const r = await api.appContributors()
    const el = $('aboutContributors'); if (el) {
      if (r && r.ok && r.contributors.length) {
        el.innerHTML = r.contributors.map(c => {
          const tip = c.commits > 0 ? `${c.commits} commits` : 'Collaborator'
          return `<a href="#" data-ext="${c.url}" title="${tip}" style="display:inline-flex;align-items:center;gap:6px;margin:3px 8px 3px 0;text-decoration:none;color:var(--text)">` +
            `<img src="${c.avatar}" referrerpolicy="no-referrer" style="width:22px;height:22px;border-radius:50%" onerror="this.style.display='none'"/> ${esc(c.login)}</a>`
        }).join('')
      } else el.textContent = 'Could not load contributors.'
    }
  } catch (_) { if ($('aboutContributors')) setText('aboutContributors', 'Could not load contributors.') }

  // Supporters (Patreon/Ko-fi, via linked Discord accounts on the linkup site)
  try {
    const r = await api.appSupporters()
    const el = $('aboutSupporters'); if (el) {
      const PLATFORM_LINK = { patreon: 'https://www.patreon.com/c/nekosunevr', kofi: 'https://ko-fi.com/nekosunevr' }
      const PLATFORM_LABEL = { patreon: 'Patreon supporter', kofi: 'Ko-fi supporter' }
      if (r && r.ok && r.supporters.length) {
        el.innerHTML = r.supporters.map(s => {
          const link = PLATFORM_LINK[s.platform] || 'https://linkup.nekosunevr.co.uk/'
          const tip = `${s.username || 'Anonymous'} · ${PLATFORM_LABEL[s.platform] || s.platform}`
          const avatar = s.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
          return `<a href="#" data-ext="${link}" title="${esc(tip)}" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:var(--text)">` +
            `<img src="${avatar}" referrerpolicy="no-referrer" style="width:28px;height:28px;border-radius:50%" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"/></a>`
        }).join('')
      } else if (r && !r.ok) {
        el.innerHTML = ''
        console.warn('appSupporters failed:', r.error)
        setText('aboutSupporters', 'Could not load supporters (offline?).')
      } else {
        el.innerHTML = ''
        setText('aboutSupporters', 'No supporters linked yet — be the first!')
      }
    }
  } catch (_) { if ($('aboutSupporters')) setText('aboutSupporters', 'Could not load supporters.') }
}
if ($('aboutCheckUpdate')) $('aboutCheckUpdate').addEventListener('click', async () => {
  const el = $('aboutUpdate'); if (el) el.textContent = 'Checking…'
  const r = await api.updateCheck()
  if (!r || !r.ok) { if (el) el.textContent = 'Could not check (offline?).'; return }
  if (r.available) { if (el) el.innerHTML = `🎉 v${r.latest} is available!`; showUpdate(r) } else if (el) el.textContent = `✓ You're up to date (v${r.current}).`
})
const aboutBtn = document.querySelector('[data-tab="about"]')
if (aboutBtn) aboutBtn.addEventListener('click', loadAbout)

let _pickerResolve = null
let _pickerSel = new Set()
async function pickFriends (title) {
  $('pickerTitle').textContent = title || 'Invite friends'
  $('pickerModal').style.display = 'flex'; _pickerSel = new Set(); $('pickerSearch').value = ''
  $('pickerList').textContent = 'Loading…'
  const r = await api.vrchatFriends(false)
  const friends = r.ok ? r.friends.slice().sort((a, b) => String(a.displayName).localeCompare(String(b.displayName))) : []
  const render = () => {
    const q = $('pickerSearch').value.toLowerCase()
    $('pickerList').innerHTML = friends.filter(f => !q || String(f.displayName).toLowerCase().includes(q)).map(f => `<label class="rb-friend" style="cursor:pointer"><input type="checkbox" class="pk" data-id="${f.id}" ${_pickerSel.has(f.id) ? 'checked' : ''} style="width:auto" /> <span class="nm">${esc(f.displayName)}</span></label>`).join('') || '<div class="muted">No online friends.</div>'
    $('pickerList').querySelectorAll('.pk').forEach(c => c.addEventListener('change', () => { c.checked ? _pickerSel.add(c.dataset.id) : _pickerSel.delete(c.dataset.id) }))
  }
  render(); $('pickerSearch').oninput = render
  return new Promise(res => { _pickerResolve = res })
}
function _pickerEnd (arr) { $('pickerModal').style.display = 'none'; if (_pickerResolve) _pickerResolve(arr); _pickerResolve = null }
$('pickerConfirm').addEventListener('click', () => _pickerEnd(Array.from(_pickerSel)))
$('pickerCancel').addEventListener('click', () => _pickerEnd([]))
$('pickerClose').addEventListener('click', () => _pickerEnd([]))
$('pickerModal').addEventListener('click', e => { if (e.target === $('pickerModal')) _pickerEnd([]) })

/* ---------------- profile editor (own) ---------------- */
let _bioLoaded = false // true once the bio has been fetched from VRChat
async function loadProfileEditor () {
  const me = await api.vrchatStatus()
  if (!me.ok) { setText('peOut', me.error || 'Log in on the VRChat tab.'); return }
  $('peStatus').value = me.user.status || 'active'
  $('peStatusDesc').value = me.user.statusDescription || ''
  if (me.user.bio != null) { $('peBio').value = me.user.bio; _bioLoaded = true }
  if (me.user.pronouns != null) $('pePronouns').value = me.user.pronouns
  if (me.user.bioLinks && me.user.bioLinks.length) $('peBioLinks').value = me.user.bioLinks.join('\n')
  setText('peOut', '')
}
$('peLoad').addEventListener('click', loadProfileEditor)
$('peSave').addEventListener('click', async () => {
  // Never send bio unless it was loaded first — sending an empty string wipes the bio.
  if (!_bioLoaded) {
    setText('peOut', 'Please click "Load" first so your bio is fetched before saving.')
    return
  }
  setText('peOut', 'Saving…')
  const bioLinks = $('peBioLinks').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3)
  const r = await api.vrchatUpdateProfile({ status: $('peStatus').value, statusDescription: $('peStatusDesc').value, bio: $('peBio').value, pronouns: $('pePronouns').value, bioLinks })
  setText('peOut', r.ok ? '✅ Profile updated' : 'Error: ' + (r.error || 'failed'))
})

/* ---------------- bio prefabs ---------------- */
async function loadBioPresets () {
  const ps = await api.getSetting('bioPresets', [])
  $('peBioPreset').innerHTML = '<option value="">— bio prefabs —</option>' + ps.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')
}
$('peBioSave').addEventListener('click', async () => {
  const name = await promptDialog('Bio prefab name:')
  if (!name) return
  const ps = await api.getSetting('bioPresets', [])
  ps.push({ name, bio: $('peBio').value })
  await api.saveSetting('bioPresets', ps)
  loadBioPresets()
  setText('peOut', `💾 Saved bio prefab "${name}"`)
})
$('peBioLoad').addEventListener('click', async () => {
  const i = $('peBioPreset').value; if (i === '') return
  const p = (await api.getSetting('bioPresets', []))[i]; if (!p) return
  $('peBio').value = p.bio || ''
  setText('peOut', `📋 Loaded "${p.name}" into the editor — Save profile to apply.`)
})
$('peBioDel').addEventListener('click', async () => {
  const i = $('peBioPreset').value; if (i === '') return
  const ps = await api.getSetting('bioPresets', [])
  ps.splice(i, 1); await api.saveSetting('bioPresets', ps); loadBioPresets()
})

/* ---------------- status presets ---------------- */
async function loadStatusPresets () {
  const presets = await api.getSetting('statusPresets', [])
  $('pePreset').innerHTML = '<option value="">— saved presets —</option>' + presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')
}
$('pePresetSave').addEventListener('click', async () => {
  const name = await promptDialog('Preset name:')
  if (!name) return
  const presets = await api.getSetting('statusPresets', [])
  presets.push({ name, status: $('peStatus').value, desc: $('peStatusDesc').value })
  await api.saveSetting('statusPresets', presets)
  loadStatusPresets()
})
$('pePresetApply').addEventListener('click', async () => {
  const i = $('pePreset').value; if (i === '') return
  const p = (await api.getSetting('statusPresets', []))[i]; if (!p) return
  $('peStatus').value = p.status; $('peStatusDesc').value = p.desc || ''
  const r = await api.vrchatUpdateProfile({ status: p.status, statusDescription: p.desc || '' })
  setText('peOut', r.ok ? `✅ Applied "${p.name}"` : 'Error: ' + (r.error || 'failed'))
})
$('pePresetDel').addEventListener('click', async () => {
  const i = $('pePreset').value; if (i === '') return
  const presets = await api.getSetting('statusPresets', [])
  presets.splice(i, 1); await api.saveSetting('statusPresets', presets); loadStatusPresets()
})

/* ---------------- media library ---------------- */
async function loadMedia () {
  const el = $('mediaGrid'); el.textContent = 'Loading…'
  const r = await api.mediaPhotos()
  if (!r.ok) { el.textContent = 'Error: ' + (r.error || 'no photos'); return }
  if (!r.photos.length) { el.textContent = 'No VRChat screenshots found.'; return }
  el.innerHTML = r.photos.map(p => `<div class="mini-card" data-path="${esc(p.path)}" style="cursor:pointer;flex-direction:column;align-items:stretch;padding:0;overflow:hidden"><img src="file:///${esc(p.path.replace(/\\/g, '/'))}" referrerpolicy="no-referrer" loading="lazy" decoding="async" style="width:100%;height:120px;object-fit:cover" /><div class="muted" style="font-size:.68rem;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div></div>`).join('')
}
$('mediaRefresh').addEventListener('click', loadMedia)
$('mediaGrid').addEventListener('click', e => { const c = e.target.closest('[data-path]'); if (c) api.mediaOpen(c.dataset.path) })
document.querySelector('[data-tab="media"]').addEventListener('click', loadMedia)

/* ---------------- server status (online count) ---------------- */
async function loadOnlineCount () {
  try {
    const r = await api.vrchatOnline(); if (!r.ok) return
    let txt = `🌐 ${(r.total ?? r.count).toLocaleString()} total`
    if (r.steam != null) txt += ` · 🖥️ ${r.steam.toLocaleString()} Steam`
    if (r.quest != null) txt += ` · 🥽 ${r.quest.toLocaleString()} Quest`
    setText('onlineCount', txt)
  } catch (_) {}
}
setInterval(loadOnlineCount, 300000)

/* ---------------- configured start ---------------- */
$('startLaunch').addEventListener('click', async () => {
  const paths = $('startApps').value.split('\n').map(s => s.trim()).filter(Boolean)
  api.saveSetting('startApps', $('startApps').value)
  api.saveSetting('startWithVrc', $('startWithVrc').checked)
  setText('startOut', 'Launching…')
  const r = await api.appsLaunch(paths, $('startWithVrc').checked)
  setText('startOut', r.ok ? `✅ Launched ${r.launched} app(s)` : 'Error')
})

/* ---------------- crash recovery + moderation list ---------------- */
$('autoRejoin').addEventListener('change', e => { api.saveSetting('autoRejoin', e.target.checked); api.setAutoRejoin(e.target.checked) })
async function loadModerations () {
  const el = $('modList'); el.textContent = 'Loading…'
  const r = await api.vrchatModerations()
  if (!r.ok) { el.textContent = (r.error || 'failed') + ' — log in on the VRChat tab.'; return }
  if (!r.moderations.length) { el.textContent = 'No blocked or muted users.'; return }
  _pageState.mod = 0
  renderPaged(el, r.moderations, 50, m => `<div class="row" style="justify-content:space-between;padding:3px 0"><span>${m.type === 'block' ? '🚫' : '🔇'} ${esc(m.targetName || m.targetUserId)}</span><button class="btn ghost mod-un" data-id="${m.targetUserId}" data-type="${m.type}" style="padding:3px 9px;font-size:.72rem">Remove</button></div>`, 'mod', '', c => c.querySelectorAll('.mod-un').forEach(b => { b.onclick = async () => { b.textContent = '…'; await api.vrchatUnmoderate(b.dataset.id, b.dataset.type); loadModerations() } }))
}
$('modRefresh').addEventListener('click', loadModerations)

/* ---------------- data export / import ---------------- */
$('dataExport').addEventListener('click', async () => { const r = await api.dataExport(); setText('dataOut', r.ok ? '✅ Saved to ' + r.path : (r.error === 'cancelled' ? 'Cancelled' : 'Error: ' + r.error)) })
$('dataImport').addEventListener('click', async () => { const r = await api.dataImport(); setText('dataOut', r.ok ? '✅ Imported — restart to apply.' : (r.error === 'cancelled' ? 'Cancelled' : 'Error: ' + r.error)) })

$('favExport').addEventListener('click', async () => {
  setText('favOut', 'Fetching favorites…')
  const [friends, worlds] = await Promise.all([api.vrchatFavFriendIds(), api.vrchatFavWorlds()])
  if (!friends.ok && !worlds.ok) { setText('favOut', 'Log in on the VRChat tab first.'); return }
  const data = { exported: new Date().toISOString(), friends: friends.ok ? { ids: friends.ids, groups: friends.groups } : null, worlds: worlds.ok ? worlds.worlds : null }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'nekosune-favorites.json'; a.click()
  URL.revokeObjectURL(url)
  setText('favOut', `✅ Exported ${friends.ok ? friends.ids.length : 0} friend favs + ${worlds.ok ? worlds.worlds.length : 0} world favs.`)
})

$('favImport').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'
  inp.onchange = async () => {
    const file = inp.files[0]; if (!file) return
    setText('favOut', 'Importing…')
    let data; try { data = JSON.parse(await file.text()) } catch (_) { setText('favOut', 'Invalid file.'); return }
    let added = 0, skipped = 0
    const delay = ms => new Promise(r => setTimeout(r, ms))
    if (data.worlds && Array.isArray(data.worlds)) {
      for (const w of data.worlds) { const r = await api.vrchatAddFav('world', w.id); r.ok ? added++ : skipped++; await delay(350) }
    }
    if (data.friends && Array.isArray(data.friends.ids)) {
      for (const id of data.friends.ids) { const r = await api.vrchatAddFav('friend', id); r.ok ? added++ : skipped++; await delay(350) }
    }
    setText('favOut', `✅ Imported ${added}${skipped ? ` (${skipped} skipped — already favorited or not found)` : ''}.`)
  }
  inp.click()
})

/* ---------------- toasts + group alerts ---------------- */
function toast (html, ms = 6000) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html
  $('toastWrap').appendChild(t)
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300) }, ms)
}
api.on('alert:group', s => { toast(`<b>📣 Group post</b><br>${esc(s.title || '')}${s.text ? '<br>' + esc(String(s.text).slice(0, 120)) : ''}`); refreshNotifBadge() })

api.on('discord:update', s => {
  discordConnected = !!s.connected
  setPill('discordState', s.connected, s.voiceAuthorized ? 'voice' : 'on')
  // persist the access token so we don't re-authorize on every launch
  if (s.accessToken && s.accessToken !== discordAccessToken) {
    discordAccessToken = s.accessToken
    api.saveSetting('discord', currentDiscordCfg())
  }
  if (!s.connected) { if (s.error) setText('discordOut', 'Error: ' + s.error); return }
  const bits = []
  if (s.inVoice) bits.push(`🔊 ${s.channelName} (${s.userCount})`)
  else bits.push('not in voice')
  if (s.selfMute) bits.push('🔇 muted')
  if (s.selfDeaf) bits.push('🔈 deafened')
  if (s.speaking) bits.push('🗣 speaking')
  setText('discordOut', bits.join(' · '))
  composer.update({
    discordChannel: s.inVoice ? s.channelName : '',
    discordUsers: s.userCount || 0,
    discordMute: !!s.selfMute, discordDeaf: !!s.selfDeaf
  })
})

/* ---------------- overlay ---------------- */
function renderOverlay (state) {
  $('overlayUrlInput').value = state?.url || ''
  if (state?.running) { setText('overlayStatus', `Overlay running at ${state.url}`); $('overlayPreview').src = state.url }
  else { setText('overlayStatus', 'Overlay server is off'); $('overlayPreview').src = 'about:blank' }
}
async function applyOverlay () {
  const s = { enabled: $('enableOverlay').checked, port: parseInt($('overlayPortInput').value, 10), style: $('overlayStyleSelect').value, boxBg: $('overlayBgSelect').value }
  await api.saveSetting('overlayEnabled', s.enabled); await api.saveSetting('overlayPort', s.port); await api.saveSetting('overlayStyle', s.style); await api.saveSetting('overlayBoxBg', s.boxBg)
  try { renderOverlay(await api.updateOverlaySettings(s)) } catch (err) { setText('overlayStatus', 'Overlay error: ' + err.message) }
}
;['enableOverlay', 'overlayStyleSelect', 'overlayPortInput', 'overlayBgSelect'].forEach(id => $(id).addEventListener('change', applyOverlay))

/* ---------------- boot ---------------- */
async function init () {
  await loadAudioDevices()

  // Restore sidebar button order (Issue #2). Uses a placeholder approach so
  // non-navbtn elements (labels, clock, brand) keep their original DOM positions.
  const savedSidebarOrder = await api.getSetting('sidebarOrder', null)
  if (Array.isArray(savedSidebarOrder) && savedSidebarOrder.length) {
    const sidebar = document.querySelector('.sidebar')
    const allBtns = [...sidebar.querySelectorAll('.navbtn[data-tab]')]
    const orderMap = new Map(savedSidebarOrder.map((tab, i) => [tab, i]))
    const sorted = allBtns.slice().sort((a, b) => {
      const ai = orderMap.has(a.dataset.tab) ? orderMap.get(a.dataset.tab) : Infinity
      const bi = orderMap.has(b.dataset.tab) ? orderMap.get(b.dataset.tab) : Infinity
      return ai - bi
    })
    // Replace each navbtn slot with a comment placeholder, then swap in sorted buttons.
    const placeholders = allBtns.map(btn => { const ph = document.createComment('nb'); btn.replaceWith(ph); return ph })
    placeholders.forEach((ph, i) => ph.replaceWith(sorted[i]))
  }

  // restore settings
  $('portInput').value = await api.getSetting('oscPort', 9000); setOscPort(getSendPort())
  $('receiverPortInput').value = await api.getSetting('receiverPort', 9001)
  const savedExtraOscTargets = await api.getSetting('extraOscTargets', [])
  $('extraOscTargets').value = oscTargetsToText(savedExtraOscTargets)
  await applyExtraOscTargets(savedExtraOscTargets)
  setText('extraOscTargetsOut', savedExtraOscTargets.length ? `Mirroring OSC to ${savedExtraOscTargets.length} extra target(s).` : 'Only the primary OSC send port is used.')
  const savedExtraOscReceivers = await api.getSetting('extraOscReceivers', [])
  $('extraOscReceivers').value = oscPortsToText(savedExtraOscReceivers)
  setExtraOscReceiverPorts(savedExtraOscReceivers)
  setText('extraOscReceiversOut', savedExtraOscReceivers.length ? `Listening on ${savedExtraOscReceivers.length} extra receive port(s).` : 'Only the primary receive port is used.')
  $('enableReceive').checked = await api.getSetting('receiveEnabled', false)
  await restoreRealisticLeash()
  await restoreOscDigitalClock()
  await restoreOscQr()
  await restoreShazamOsc()
  for (const name of ['gain', 'lowBoost', 'bassBoost', 'midBoost', 'trebleBoost']) {
    const def = { gain: 2.0, lowBoost: 2.6, bassBoost: 3.0, midBoost: 2.0, trebleBoost: 3.4 }[name]
    const v = await api.getSetting(name, def); $(name + 'Slider').value = v; setText(name + 'Value', v)
  }
  katEnabled = await api.getSetting('katNowPlayingEnabled', false); $('enableKatNowPlaying').checked = katEnabled
  const savedKatSyncParams = await api.getSetting('katSyncParams', 0)
  if ([0, 4, 8, 16].includes(savedKatSyncParams)) {
    $('katSyncParamsMode').value = String(savedKatSyncParams)
  } else {
    $('katSyncParamsMode').value = 'custom'
    $('katSyncParamsCustom').value = savedKatSyncParams
    $('katSyncParamsCustom').style.display = ''
  }
  $('nowPlayingBarStyle').value = await api.getSetting('nowPlayingBarStyle', 'bars')
  initNowPlayingSources()
  chatboxNpEnabled = await api.getSetting('chatboxNowPlayingEnabled', false); $('enableChatboxNowPlaying').checked = chatboxNpEnabled

  const avatarScalingEnabled = await api.getSetting('avatarScalingEnabled', false)
  $('avatarScalingEnable').checked = avatarScalingEnabled
  const asSafety = await api.getSetting('avatarScalingSafety', true)
  $('avatarScalingSafety').checked = asSafety
  $('avatarScalingSaveWorlds').checked = await api.getSetting('avatarScalingSaveWorlds', false)
  const asSmoothing = await api.getSetting('avatarScalingSmoothing', 50)
  $('avatarScalingSmoothing').value = asSmoothing
  setText('avatarScalingSmoothingVal', asSmoothing)
  const asScale = await api.getSetting('avatarScalingScale', 1)
  $('avatarScalingSlider').value = avatarScaleToSlider(asScale)
  $('avatarScalingValue').value = formatAvatarScale(asScale)
  const savedHotkeys = await api.getSetting('avatarScalingHotkeys', { keyUp: null, keyDown: null })
  avatarScalingHotkeys.keyUp = savedHotkeys.keyUp
  avatarScalingHotkeys.keyDown = savedHotkeys.keyDown
  if (savedHotkeys.keyUp) $('avatarScalingKeyUp').textContent = vkName(savedHotkeys.keyUp)
  if (savedHotkeys.keyDown) $('avatarScalingKeyDown').textContent = vkName(savedHotkeys.keyDown)
  $('presetsText').value = await api.getSetting('presets', DEFAULT_PRESETS.join('\n'))
  composer.setPresets($('presetsText').value.split('\n'))
  composer.setRotationPosition(await api.getSetting('rotationPos', 'top'))
  $('rotationPos').value = composer.rotationPosition
  $('rotateInterval').value = await api.getSetting('rotateInterval', 4000)
  buildModeGrid(await api.getSetting('chatModes', null))
  updatePreview()
  chatHistory = await api.getSetting('chatHistory', [])
  renderChatHistory()
  updateHoldStatus()

  // restore + auto-start the stat pollers that were left enabled
  if (await api.getSetting('statsEnabled', false)) { $('enableStats').checked = true; setPill('statsState', true, 'on'); api.statsStart(5000) }
  if (await api.getSetting('netEnabled', false)) { $('enableNet').checked = true; setPill('netState', true, 'on'); api.netStart({ intervalMs: 5000 }) }
  if (await api.getSetting('windowEnabled', false)) { $('enableWindow').checked = true; setPill('winState', true, 'on'); api.windowStart() }
  if (await api.getSetting('vrEnabled', false)) { $('enableVr').checked = true; api.vrStart() }
  { const wt = await api.getSetting('windowShowTitle', false); $('winShowTitle').checked = wt; composer.setWindowShowTitle(wt) }
  if ($('tonPort')) $('tonPort').value = await api.getSetting('tonPort', 11398)
  if (await api.getSetting('tonEnabled', false)) { $('enableTon').checked = true; setPill('tonState', true, 'on'); tonStarted = true; api.tonStart({ port: tonPortVal() }) }
  $('tiktokUser').value = await api.getSetting('tiktokUser', '')
  $('tiktokSignKey').value = await api.getSetting('tiktokSignKey', '')
  $('kickSlug').value = await api.getSetting('kickSlug', '')
  let tw = await api.getSetting('oauth.twitch', null)
  if (!tw) {
    tw = await api.getSetting('twitch', {})
    if (Object.keys(tw).length) await api.saveSetting('oauth.twitch', tw)
  }
  $('twitchLogin').value = tw.login || ''
  $('twitchClientId').value = tw.clientId || DEFAULT_TWITCH_CLIENT_ID
  $('twitchClientSecret').value = tw.clientSecret || ''
  $('twitchToken').value = tw.token || ''
  twitchRefreshToken = tw.refreshToken || ''
  setTwitchTokenState()
  await restoreTwitchInteractive(true)
  try {
    const rdir = await api.oauthTwitchRedirect()
    if ($('docsTwitchRedirect')) $('docsTwitchRedirect').textContent = rdir
    if ($('oauthTwitchRedirect')) $('oauthTwitchRedirect').textContent = rdir
  } catch (_) {}
  $('pulsoidToken').value = await api.getSetting('pulsoidToken', '')
  $('hrProvider').value = await api.getSetting('hrProvider', 'pulsoid')
  const hy = await api.getSetting('hyperate', {})
  $('hyperateKey').value = hy.apiKey || ''
  $('hyperateDevice').value = hy.deviceId || ''
  const bridge = await api.getSetting('hrDeviceBridge', {})
  $('hrBridgePort').value = bridge.port || 7392
  $('hrRelayPulsoid').checked = !!bridge.relayToPulsoid
  $('hrRelayToken').value = bridge.relayToken || ''
  $('hrBleAutoReconnect').checked = await api.getSetting('hrBleAutoReconnect', true)
  const gmansAutomatic = await api.getSetting('hrGmansAutomatic', { enabled: false, intervalMinutes: 5 })
  $('hrGmansAutomatic').checked = !!gmansAutomatic.enabled
  $('hrGmansAutoInterval').value = Math.max(1, Math.min(255, Number(gmansAutomatic.intervalMinutes) || 5))
  $('hrGmansBackgroundWake').checked = await api.getSetting('hrGmansBackgroundWake', false)
  const hrProfiles = await api.getSetting('hrOscProfiles', { vrcosc: true, bekoLegacy: false, heartEchoes: true, akaryu: true, akaryuMaxBpm: 200 })
  $('hrOscVrcosc').checked = hrProfiles.vrcosc !== false
  $('hrOscBekoLegacy').checked = hrProfiles.bekoLegacy === true
  $('hrOscHeartEchoes').checked = hrProfiles.heartEchoes !== false
  $('hrOscAkaryu').checked = hrProfiles.akaryu !== false
  $('hrOscAkaryuMax').value = Math.max(40, Math.min(255, Number(hrProfiles.akaryuMaxBpm) || 200))
  $('hrBridgeEndpoint').textContent = `http://127.0.0.1:${$('hrBridgePort').value}/heart-rate`
  syncHrFields()
  refreshBleRememberedDevices()
  try { renderHrSessions(await api.hrSessions()) } catch (_) {}
  const dc = await api.getSetting('discord', {})
  discordAccessToken = dc.accessToken || ''
  // The Discord Application ID is fixed to DEFAULT_DISCORD_APP_ID and not
  // user-editable — force it every load regardless of what's saved, so old
  // or tampered config values never take effect.
  if (dc.clientId !== DEFAULT_DISCORD_APP_ID) {
    dc.clientId = DEFAULT_DISCORD_APP_ID
    await api.saveSetting('discord', dc) // persist so it sticks + auto-start uses it
  }
  $('discordAppId').value = DEFAULT_DISCORD_APP_ID
  $('discordSecret').value = dc.clientSecret || ''
  $('discordRP').checked = dc.enableRichPresence !== false
  $('discordVoice').checked = !!dc.enableVoice
  $('discordVoiceOsc').checked = dc.sendVoiceStateOsc !== false
  $('discordMuteOsc').checked = dc.sendMuteDeafenOsc !== false
  $('discordVrcStatus').value = dc.vrcStatus || 'active'
  $('discordShowWorld').checked = dc.showWorld !== false
  $('discordVrcProfile').value = dc.vrcProfileUrl || ''
  $('discordShowHr').checked = dc.showHeartRate !== false
  $('discordShowNp').checked = dc.showNowPlaying !== false
  try { const w = await api.vrcGet(); if (w && w.inWorld && w.worldName) setText('discordWorldOut', `World: ${w.worldName}`) } catch (_) {}

  // Auto-AFK restore
  const af = await api.getSetting('afk', {})
  $('afkEnable').checked = !!af.enabled
  $('afkThreshold').value = af.thresholdSec || 120
  $('afkToChatbox').checked = af.toChatbox !== false
  $('afkMessage').value = af.message || '💤 AFK since {time} ({mins}m)'
  $('afkBackMessage').value = af.backMessage || '👋 Back!'
  if (af.enabled) api.afkStart({ thresholdSec: af.thresholdSec || 120 })

  // Photo Relay restore
  const pr = await api.getSetting('photoRelay', {})
  $('photoWebhook').value = pr.webhook || ''
  $('photoRelayEnable').checked = !!pr.enabled
  if (pr.enabled && pr.webhook) api.photoRelaySet(pr)

  // Screenshot Metadata restore (main process already started the watcher at
  // launch if this was enabled - just reflect the checkbox state here)
  const smEnabled = await api.getSetting('screenshotMetadata', false)
  if ($('screenshotMetaEnable')) {
    $('screenshotMetaEnable').checked = !!smEnabled
    if (smEnabled) setText('screenshotMetaOut', 'Watching for new VRChat photos…')
  }

  // Configured Start + presets + server status
  $('startApps').value = await api.getSetting('startApps', '')
  $('startWithVrc').checked = await api.getSetting('startWithVrc', false)
  $('autoRejoin').checked = await api.getSetting('autoRejoin', false)
  loadStatusPresets()
  loadBioPresets()
  loadOnlineCount()

  // VRChat account restore
  $('vrcUser').value = await api.getSetting('vrcUser', '')
  const vrcLoggedIn = await api.vrchatIsLoggedIn()
  const vrcAuto = await api.getSetting('vrcAutoStatus', false)
  $('vrcAutoStatus').checked = !!vrcAuto
  $('discordVrcStatus').disabled = !!vrcAuto
  if (vrcLoggedIn) { setAcctState(true, 'Session restored'); if (vrcAuto) api.vrchatAutoStatus(true); loadRightbar(); loadNotifications() } else setAcctState(false, 'Not logged in')

  // Weather restore
  const wx = await api.getSetting('weather', {})
  $('weatherCity').value = wx.city || ''
  $('weatherUnits').value = wx.units || 'celsius'
  $('weatherEnable').checked = !!wx.enabled
  if (wx.enabled && wx.city) { setPill('weatherState', true, 'on'); api.weatherStart({ city: wx.city, units: wx.units }) }

  // Discord bot + OSC Apps controls restore
  $('botToken').value = await api.getSetting('discordBotToken', '')
  const bcfg = await api.getSetting('discordBot', {})
  $('botUserId').value = bcfg.userId || ''
  $('botAppId').value = bcfg.appId || ''
  $('botMode').value = await api.getSetting('discordBotMode', 'own')
  syncBotModeUI()
  // Left blank = use the official NekoSuneVR-hosted backend (main.js falls
  // back to DEFAULT_NEKOSUNE_BACKEND_URL); only self-hosters need to fill this in.
  $('nekosuneBackendUrl').value = await api.getSetting('nekosuneBackendUrl', '')
  refreshDiscordIdentityStatus()
  $('spotiOscEnable').checked = await api.getSetting('spotiOscEnable', false)
  $('discordOscEnable').checked = await api.getSetting('discordOscEnable', false)
  $('spotiJamUrl').value = await api.getSetting('oscApps.spotiJamUrl', '')
  sendParam(DISCORD_OSC_METADATA, $('discordOscEnable').checked, 'bool')
  sendParam(SPOTI_OSC_METADATA, $('spotiOscEnable').checked, 'bool')
  sendParam('/avatar/parameters/SpotiOSC/Enabled', $('spotiOscEnable').checked, 'bool')
  setPill('discordOscState', $('discordOscEnable').checked, $('discordOscEnable').checked ? 'waiting' : 'off', 'off')
  setPill('spotiOscState', $('spotiOscEnable').checked, 'on', 'off')
  if ($('spotiOscEnable').checked) refreshNowPlaying()

  // Friend Den + Event Scout restore
  trackedGroups = await api.getSetting('eventGroups', [])
  $('friendAuto').checked = await api.getSetting('friendAuto', true)
  syncFriendAuto()

  // Auto-Greeter restore
  const gr = await api.getSetting('greeter', {})
  $('greeterEnable').checked = !!gr.enabled
  $('greeterMode').value = gr.mode || 'all'
  $('greeterAllow').value = (gr.allow || []).join(', ')
  if (gr.enabled) api.greeterSet(gr)

  await setupAiProviders()
  await setupTranslator()
  $('liveTypingTranslate').checked = await api.getSetting('liveTypingTranslate', false)
  $('overlayEnabled') // overlay restore
  $('enableOverlay').checked = await api.getSetting('overlayEnabled', true)
  $('overlayPortInput').value = await api.getSetting('overlayPort', 39530)
  $('overlayStyleSelect').value = await api.getSetting('overlayStyle', 'default')
  $('overlayBgSelect').value = await api.getSetting('overlayBoxBg', 'solid')
  { const ea = await api.getSetting('essAudioReactive', false); essAudioReactive = ea; if ($('essAudio')) $('essAudio').checked = ea }

  if ($('enableReceive').checked) startOscReceiver(getRecvPort(), (a, args) => logLine(`IN  ${a} ${args.join(',')}`))
  if (katEnabled) startKat()
  if (avatarScalingEnabled) startAvatarScaling()
  try { renderOverlay(await api.getOverlayState()) } catch (_) {}

  // ---- Startup / auto-start ----
  const as = await api.getSetting('autostart', {})
  const AUTO_IDS = ['autoMinimized', 'autoDiscord', 'autoHeartrate', 'autoStats', 'autoNet', 'autoWindow', 'autoTon', 'autoTikTokFollowers', 'autoTwitch', 'autoKick']
  AUTO_IDS.forEach(id => { $(id).checked = !!as[id] })
  try { $('autoLaunch').checked = await api.getLaunchOnLogin() } catch (_) {}

  const saveAutostart = () => {
    const out = {}
    AUTO_IDS.forEach(id => { out[id] = $(id).checked })
    api.saveSetting('autostart', out)
  }
  AUTO_IDS.forEach(id => $(id).addEventListener('change', saveAutostart))
  $('autoLaunch').addEventListener('change', e => api.setLaunchOnLogin(e.target.checked))

  // Drive the existing controls so saved tokens/IDs are reused (no manual clicks).
  const fireToggle = id => { if (!$(id).checked) { $(id).checked = true; $(id).dispatchEvent(new Event('change')) } }
  if (as.autoDiscord && $('discordAppId').value) $('discordStart').click()
  if (as.autoHeartrate && ($('hrProvider').value === 'device' || $('pulsoidToken').value || $('hyperateDevice').value)) $('hrStart').click()
  if (as.autoStats) fireToggle('enableStats')
  if (as.autoNet) fireToggle('enableNet')
  if (as.autoWindow) fireToggle('enableWindow')
  if (as.autoTon) fireToggle('enableTon')
  if (as.autoTikTokFollowers && $('tiktokUser').value.trim()) api.tiktokFollowersStart($('tiktokUser').value)
  if (as.autoTwitch) $('twitchConnect').click()
  if (as.autoKick) $('kickConnect').click()

  refreshNowPlaying()
}

// ---- AI provider picker ----
async function setupAiProviders () {
  const providers = await api.aiProviders()
  const sel = $('aiProvider')
  sel.innerHTML = ''
  Object.entries(providers).forEach(([key, p]) => {
    const o = document.createElement('option'); o.value = key; o.text = p.label; sel.appendChild(o)
  })
  const saved = await api.getSetting('ai', { provider: 'openai', baseUrl: providers.openai.baseUrl, model: providers.openai.model, key: '' })
  sel.value = saved.provider || 'openai'
  $('aiBaseUrl').value = saved.baseUrl || providers[sel.value]?.baseUrl || ''
  $('aiModel').value = saved.model || providers[sel.value]?.model || ''
  $('aiKey').value = saved.key || ''

  function applyAiProviderLock () {
    const p = providers[sel.value]
    const locked = !!p?.locked
    $('aiBaseUrl').disabled = locked
    $('aiModel').disabled = locked
  }
  applyAiProviderLock()

  sel.addEventListener('change', async () => {
    const p = providers[sel.value]
    if (p && sel.value !== 'custom') { $('aiBaseUrl').value = p.baseUrl; $('aiModel').value = p.model }
    applyAiProviderLock()
    await saveAi()
  })
  ;['aiBaseUrl', 'aiModel', 'aiKey'].forEach(id => $(id).addEventListener('change', saveAi))
}
async function saveAi () {
  await api.saveSetting('ai', {
    provider: $('aiProvider').value, baseUrl: $('aiBaseUrl').value,
    model: $('aiModel').value, key: $('aiKey').value
  })
}

const TRANSLATOR_ROWS = {
  libretranslate: ['translatorEndpointRow'],
  libretranslate_custom: ['translatorEndpointRow', 'translatorKeyRow'],
  deepl: ['translatorKeyRow', 'translatorDeeplTypeRow'],
  google: ['translatorKeyRow']
}
function updateTranslatorRows () {
  const provider = $('translatorProvider').value
  const visible = new Set(TRANSLATOR_ROWS[provider] || [])
  ;['translatorEndpointRow', 'translatorKeyRow', 'translatorDeeplTypeRow'].forEach(id => {
    $(id).style.display = visible.has(id) ? '' : 'none'
  })
}
async function setupTranslator () {
  const providers = await api.translateProviders()
  const providerSel = $('translatorProvider')
  providerSel.innerHTML = ''
  Object.entries(providers).forEach(([key, p]) => providerSel.appendChild(new Option(p.label, key)))
  const sourceSel = $('translatorSource')
  const targetSel = $('translatorTarget')
  LANGUAGES.forEach(({ code, name }) => {
    sourceSel.appendChild(new Option(name, code))
    targetSel.appendChild(new Option(name, code))
  })

  const saved = await api.getSetting('translator', {
    provider: 'libretranslate', endpoint: providers.libretranslate?.endpoint || 'https://translator.nekosunevr.co.uk/translate', apiKey: '', apiType: 'free',
    sourceLang: 'auto', targetLang: 'en', useAiGrammarFix: false
  })
  $('translatorProvider').value = saved.provider || 'libretranslate'
  $('translatorEndpoint').value = saved.endpoint || providers[$('translatorProvider').value]?.endpoint || ''
  $('translatorApiKey').value = saved.apiKey || ''
  $('translatorDeeplType').value = saved.apiType || 'free'
  $('translatorSource').value = saved.sourceLang || 'auto'
  $('translatorTarget').value = saved.targetLang || 'en'
  $('translatorAiGrammarFix').checked = !!saved.useAiGrammarFix
  updateTranslatorRows()

  $('translatorProvider').addEventListener('change', async () => {
    const p = providers[$('translatorProvider').value]
    if (p && p.endpoint !== undefined) $('translatorEndpoint').value = p.endpoint || ''
    updateTranslatorRows()
    await saveTranslator()
  })
  ;['translatorEndpoint', 'translatorApiKey', 'translatorDeeplType', 'translatorSource', 'translatorTarget', 'translatorAiGrammarFix']
    .forEach(id => $(id).addEventListener('change', saveTranslator))
}
async function saveTranslator () {
  await api.saveSetting('translator', {
    provider: $('translatorProvider').value,
    endpoint: $('translatorEndpoint').value,
    apiKey: $('translatorApiKey').value,
    apiType: $('translatorDeeplType').value,
    sourceLang: $('translatorSource').value,
    targetLang: $('translatorTarget').value,
    useAiGrammarFix: $('translatorAiGrammarFix').checked
  })
}
// Translate text using the saved Translator settings. Falls back to the
// original text on any failure (network, missing key, bad endpoint, ...)
// so a broken translator config never blocks the feature calling this.
async function translateWithSettings (text) {
  const t = await api.getSetting('translator', null)
  if (!t || !t.provider) return text
  try {
    const result = await api.translate({
      provider: t.provider,
      endpoint: t.endpoint,
      apiKey: t.apiKey,
      apiType: t.apiType,
      source: t.sourceLang,
      target: t.targetLang,
      useAiGrammarFix: t.useAiGrammarFix,
      aiSettings: t.useAiGrammarFix ? { baseUrl: $('aiBaseUrl').value, apiKey: $('aiKey').value, model: $('aiModel').value } : null,
      text
    })
    return result?.translatedText || text
  } catch (_) {
    return text
  }
}

/* ---------------- text-to-speech ---------------- */
// One entry per engine: its settings row element (null if it has none, e.g.
// TikTok needs no config here) and a map of { ttsSpeak() opt name -> element
// id }. Driven generically so adding an engine only means adding one entry
// here (+ the matching HTML row + the ttsProviders.js function) instead of
// touching load/save/build-options logic in four different places.
const TTS_ENGINE_FIELDS = {
  sapi: { row: 'ttsSapiRow', fields: { voice: 'ttsSapiVoice', rate: 'ttsSapiRate' } },
  tiktok: { row: 'ttsTiktokRow', fields: { voice: 'ttsTiktokVoice' } },
  elevenlabs: { row: 'ttsElevenRow', fields: { apiKey: 'ttsElevenKey', voiceId: 'ttsElevenVoiceId' } },
  openai: { row: 'ttsOpenaiRow', fields: { apiKey: 'ttsOpenaiKey', model: 'ttsOpenaiModel', voice: 'ttsOpenaiVoice' } },
  google: { row: 'ttsGoogleRow', fields: { apiKey: 'ttsGoogleKey', languageCode: 'ttsGoogleLang', voiceName: 'ttsGoogleVoice' } },
  azure: { row: 'ttsAzureRow', fields: { apiKey: 'ttsAzureKey', region: 'ttsAzureRegion', voiceName: 'ttsAzureVoice' } },
  polly: { row: 'ttsPollyRow', fields: { accessKeyId: 'ttsPollyAccessKey', secretAccessKey: 'ttsPollySecretKey', region: 'ttsPollyRegion', voiceId: 'ttsPollyVoiceId', engine: 'ttsPollyEngine' } },
  ibmwatson: { row: 'ttsIbmRow', fields: { apiKey: 'ttsIbmKey', region: 'ttsIbmRegion', instanceId: 'ttsIbmInstance', voice: 'ttsIbmVoice' } },
  deepgram: { row: 'ttsDeepgramRow', fields: { apiKey: 'ttsDeepgramKey', model: 'ttsDeepgramModel' } },
  voiceforge: { row: 'ttsVoiceforgeRow', fields: { apiKey: 'ttsVoiceforgeKey', voice: 'ttsVoiceforgeVoice' } },
  uberduck: { row: 'ttsUberduckRow', fields: { apiKey: 'ttsUberduckKey', apiSecret: 'ttsUberduckSecret', voiceId: 'ttsUberduckVoice' } },
  ttsmonster: { row: 'ttsMonsterRow', fields: { apiKey: 'ttsMonsterKey', voiceId: 'ttsMonsterVoice' } },
  glados: { row: 'ttsGladosRow', fields: { endpoint: 'ttsGladosEndpoint' } },
  moonbase: { row: 'ttsMoonbaseRow', fields: { endpoint: 'ttsMoonbaseEndpoint', voice: 'ttsMoonbaseVoice' } },
  selfhosted: { row: 'ttsSelfHostedRow', fields: { endpoint: 'ttsSelfHostedEndpoint' } }
}
const TTS_ALL_FIELD_IDS = [...new Set(Object.values(TTS_ENGINE_FIELDS).flatMap(e => Object.values(e.fields)))]
const TTS_NUMERIC_FIELDS = new Set(['ttsSapiRate'])

function updateTtsRows () {
  const engine = $('ttsEngine').value
  const activeRow = TTS_ENGINE_FIELDS[engine]?.row
  Object.values(TTS_ENGINE_FIELDS).forEach(e => { if (e.row) $(e.row).style.display = e.row === activeRow ? '' : 'none' })
}
async function setupTts () {
  const saved = await api.getSetting('tts', { engine: 'sapi', outputDeviceId: '', values: {} })
  $('ttsEngine').value = saved.engine || 'sapi'
  TTS_ALL_FIELD_IDS.forEach(id => { if (saved.values?.[id] != null) $(id).value = saved.values[id] })
  updateTtsRows()

  try {
    const voices = await api.ttsSapiVoices()
    $('ttsSapiVoice').innerHTML = ''
    voices.forEach(v => $('ttsSapiVoice').appendChild(new Option(v, v)))
    if (saved.values?.ttsSapiVoice) $('ttsSapiVoice').value = saved.values.ttsSapiVoice
  } catch (_) {}

  try {
    const voices = await api.tiktokVoices()
    $('ttsTiktokVoice').innerHTML = ''
    voices.forEach(v => $('ttsTiktokVoice').appendChild(new Option(v.label, v.apiName)))
    if (saved.values?.ttsTiktokVoice) $('ttsTiktokVoice').value = saved.values.ttsTiktokVoice
  } catch (_) {}

  await refreshTtsOutputDevices()
  if (saved.outputDeviceId) $('ttsOutputDevice').value = saved.outputDeviceId

  $('ttsEngine').addEventListener('change', async () => { updateTtsRows(); await saveTts() })
  ;[...TTS_ALL_FIELD_IDS, 'ttsOutputDevice'].forEach(id => $(id).addEventListener('change', saveTts))
}
async function refreshTtsOutputDevices () {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const sel = $('ttsOutputDevice')
    const current = sel.value
    sel.innerHTML = '<option value="">System default</option>'
    devices.filter(d => d.kind === 'audiooutput').forEach(d => sel.appendChild(new Option(d.label || d.deviceId, d.deviceId)))
    if ([...sel.options].some(o => o.value === current)) sel.value = current
  } catch (_) {}
}
async function saveTts () {
  const values = {}
  TTS_ALL_FIELD_IDS.forEach(id => { values[id] = $(id).value })
  await api.saveSetting('tts', { engine: $('ttsEngine').value, outputDeviceId: $('ttsOutputDevice').value, values })
}
// Speak text using the saved TTS settings. Returns quietly on failure (the
// callers - Live Typing, the assistant, etc. - shouldn't crash if TTS isn't
// configured or a request fails).
async function speakWithSettings (text) {
  const t = await api.getSetting('tts', null)
  if (!t || !t.engine) return
  try {
    const fieldMap = TTS_ENGINE_FIELDS[t.engine]?.fields || {}
    const opts = { engine: t.engine, text }
    Object.entries(fieldMap).forEach(([optKey, elId]) => {
      const raw = t.values?.[elId]
      opts[optKey] = TTS_NUMERIC_FIELDS.has(elId) ? (parseInt(raw, 10) || 0) : raw
    })

    const result = await api.ttsSpeak(opts)
    if (result?.playedLocally) return // SAPI already played through the OS directly
    if (!result?.audio) return
    const audioEl = $('ttsEngineAudio')
    if (t.outputDeviceId && typeof audioEl.setSinkId === 'function') {
      try { await audioEl.setSinkId(t.outputDeviceId) } catch (_) {}
    }
    audioEl.src = `data:${result.mime || 'audio/mpeg'};base64,${result.audio}`
    await audioEl.play().catch(() => {})
  } catch (_) {}
}
$('ttsEngineTestSpeak').addEventListener('click', async () => {
  const text = $('ttsEngineTestText').value.trim()
  if (!text) return
  setText('ttsEngineStatus', 'Speaking…')
  await speakWithSettings(text)
  setText('ttsEngineStatus', 'Done')
})

/* ---------------- desktop speech-to-text ---------------- */
let desktopStt = null
const STT_ROWS = { cloud: ['sttCloudRow'], local: ['sttLocalRow'] }
function updateSttRows () {
  const engine = $('sttEngine').value
  const visible = new Set(STT_ROWS[engine] || [])
  ;['sttCloudRow', 'sttLocalRow'].forEach(id => { $(id).style.display = visible.has(id) ? '' : 'none' })
}
function ensureDesktopStt () {
  if (desktopStt) return desktopStt
  desktopStt = new DesktopSttController({
    transcribeCloud: opts => api.sttTranscribeCloud(opts),
    transcribeLocal: opts => api.sttTranscribeLocal(opts),
    translate: translateWithSettings,
    sendChatboxMessage,
    speakText: speakWithSettings,
    onUpdate: renderSttState
  })
  return desktopStt
}
function renderSttState (s) {
  setText('sttStatus', s.status + (s.error ? ` — ${s.error}` : ''))
  setText('sttLastText', s.lastText ? `Heard: "${s.lastText}"${s.lastTranslated ? ` → "${s.lastTranslated}"` : ''}` : '')
  $('sttToggle').textContent = s.live ? 'Stop listening' : 'Start listening'
}
async function saveSttConfig () {
  const cloudProviders = await api.sttCloudProviders()
  const provider = cloudProviders[$('sttCloudProvider').value] || cloudProviders.openai
  const cfg = {
    engine: $('sttEngine').value,
    cloudProvider: $('sttCloudProvider').value,
    cloudBaseUrl: provider.baseUrl,
    cloudModel: provider.model,
    cloudApiKey: $('sttCloudKey').value,
    localModel: $('sttLocalModel').value,
    sourceLang: $('sttSourceLang').value,
    clipSeconds: parseInt($('sttClipSeconds').value, 10) || 6,
    toChatbox: $('sttToChatbox').checked,
    speakTranslation: $('sttSpeakTranslation').checked
  }
  await api.saveSetting('desktopStt', cfg)
  ensureDesktopStt().configure({ ...cfg, cloudApiKey: cfg.cloudApiKey })
  return cfg
}
async function setupDesktopStt () {
  const saved = await api.getSetting('desktopStt', {
    engine: 'cloud', cloudProvider: 'openai', cloudApiKey: '', localModel: 'tiny',
    sourceLang: 'auto', clipSeconds: 6, toChatbox: false, speakTranslation: false
  })
  $('sttEngine').value = saved.engine || 'cloud'
  $('sttCloudProvider').value = saved.cloudProvider || 'openai'
  $('sttCloudKey').value = saved.cloudApiKey || ''
  $('sttLocalModel').value = saved.localModel || 'tiny'
  $('sttClipSeconds').value = saved.clipSeconds || 6
  $('sttToChatbox').checked = !!saved.toChatbox
  $('sttSpeakTranslation').checked = !!saved.speakTranslation
  LANGUAGES.forEach(({ code, name }) => $('sttSourceLang').appendChild(new Option(name, code)))
  $('sttSourceLang').value = saved.sourceLang || 'auto'
  updateSttRows()
  await saveSttConfig()

  $('sttEngine').addEventListener('change', async () => { updateSttRows(); await saveSttConfig() })
  ;['sttCloudProvider', 'sttCloudKey', 'sttLocalModel', 'sttSourceLang', 'sttClipSeconds', 'sttToChatbox', 'sttSpeakTranslation']
    .forEach(id => $(id).addEventListener('change', saveSttConfig))
}
// Medium/Large/Turbo are multi-GB first-time downloads - without this, a
// first transcription attempt with one of them selected just looks hung.
api.on('stt:downloadProgress', data => {
  if (!$('sttLocalProgressWrap')) return
  const pct = Number.isFinite(data?.progress) ? Math.min(100, Math.round(data.progress)) : 0
  $('sttLocalProgressWrap').style.display = 'block'
  $('sttLocalProgressBar').style.width = `${pct}%`
  const mb = v => (v / 1e6).toFixed(1)
  setText('sttLocalProgressText', data?.total ? `Downloading ${data.file || 'model'}… ${pct}% (${mb(data.loaded || 0)} / ${mb(data.total)} MB)` : `Downloading ${data?.file || 'model'}…`)
  if (pct >= 100) setTimeout(() => { if ($('sttLocalProgressWrap')) $('sttLocalProgressWrap').style.display = 'none' }, 2000)
})
$('sttToggle').addEventListener('click', async () => {
  const c = ensureDesktopStt()
  await c.setLive(!c.live)
})

/* ---------------- OCR screen translate ---------------- */
let ocrTranslate = null
function ensureOcrTranslate () {
  if (ocrTranslate) return ocrTranslate
  ocrTranslate = new OcrTranslateController({
    translate: translateWithSettings,
    sendChatboxMessage,
    onUpdate: renderOcrState
  })
  return ocrTranslate
}
function renderOcrState (s) {
  setText('ocrStatus', s.status + (s.error ? ` — ${s.error}` : ''))
  setText('ocrLastText', s.lastText ? `Read: "${s.lastText}"${s.lastTranslated ? ` → "${s.lastTranslated}"` : ''}` : '')
  $('ocrToggle').textContent = s.enabled ? 'Stop reading' : 'Start reading'
}
async function saveOcrConfig () {
  const cfg = { tesseractLang: $('ocrLang').value, intervalMs: parseInt($('ocrInterval').value, 10) || 3000, toChatbox: $('ocrToChatbox').checked }
  await api.saveSetting('ocrTranslate', cfg)
  if (ocrTranslate) ocrTranslate.configure(cfg)
  return cfg
}
async function setupOcrTranslate () {
  const saved = await api.getSetting('ocrTranslate', { tesseractLang: 'eng', intervalMs: 3000, toChatbox: false })
  $('ocrLang').value = saved.tesseractLang || 'eng'
  $('ocrInterval').value = saved.intervalMs || 3000
  $('ocrToChatbox').checked = !!saved.toChatbox
  ;['ocrLang', 'ocrInterval', 'ocrToChatbox'].forEach(id => $(id).addEventListener('change', saveOcrConfig))
}
$('ocrToggle').addEventListener('click', async () => {
  const c = ensureOcrTranslate()
  if (c.enabled) c.stop(); else { await c.configure(await saveOcrConfig()); await c.start() }
})

/* ---------------- voice assistant ---------------- */
let jarvisAssistant = null
function ensureJarvisAssistant () {
  if (jarvisAssistant) return jarvisAssistant
  jarvisAssistant = new JarvisAssistant({
    transcribeCloud: opts => api.sttTranscribeCloud(opts),
    transcribeLocal: opts => api.sttTranscribeLocal(opts),
    interpretCommand: opts => api.assistantInterpret(opts),
    summarizeSearch: opts => api.assistantSummarizeSearch(opts),
    searchWeb: opts => api.assistantSearchWeb(opts),
    getWeather: () => api.weatherGet(),
    speakText: speakWithSettings,
    // vrchatFriends() (offline=false) returns friend objects with NO `online`
    // field at all - that flag only gets set by the reconciled all-friends
    // call, which fetches both the online and offline buckets and tags each
    // one accordingly. Using the wrong one here means f.online is always
    // undefined, so "who's online" always came back empty regardless of who
    // was actually online.
    getFriends: async () => { const r = await api.vrchatAllFriends(); return r?.friends || [] },
    getMyLocation: () => api.vrcGet(),
    resolveWorldName: async id => { const r = await api.vrchatWorldName(id); return typeof r === 'string' ? r : (r?.name || r?.worldName || '') },
    getStatus: () => api.vrchatStatus(),
    updateStatus: fields => api.vrchatUpdateProfile(fields),
    invite: (id, instanceId) => api.vrchatInvite(id, instanceId),
    saveClip: opts => api.assistantSaveClip(opts),
    onUpdate: renderAssistantState
  })
  return jarvisAssistant
}
function renderAssistantState (s) {
  let statusLine = s.status + (s.error ? ` — ${s.error}` : '')
  if (s.live && s.config?.enableReplayBuffer) statusLine += s.replayActive ? ' · 🔴 instant-replay recording' : ' · ⚠ instant-replay not capturing'
  setText('assistantStatus', statusLine)
  setText('assistantHeard', s.lastHeard ? `Heard: "${s.lastHeard}"${s.lastReply ? ` → "${s.lastReply}"` : ''}` : '')
  $('assistantToggle').textContent = s.live ? 'Stop listening' : 'Start listening'
}
async function refreshAssistantMicDevices () {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const sel = $('assistantMicDevice')
    const current = sel.value
    sel.innerHTML = '<option value="">System default</option>'
    devices.filter(d => d.kind === 'audioinput').forEach(d => sel.appendChild(new Option(d.label || d.deviceId, d.deviceId)))
    if ([...sel.options].some(o => o.value === current)) sel.value = current
  } catch (_) {}
}
async function saveAssistantConfig () {
  const sttCfg = await api.getSetting('desktopStt', {})
  const aiCfg = await api.getSetting('ai', {})
  const cfg = {
    wakeWord: $('assistantWakeWord').value.trim() || 'nova',
    micDeviceId: $('assistantMicDevice').value,
    clipSeconds: parseInt($('assistantClipSeconds').value, 10) || 4,
    vadThreshold: parseFloat($('assistantMicSensitivity').value) || 0.015,
    trustedFriends: $('assistantTrustedFriends').value.split(',').map(s => s.trim()).filter(Boolean),
    enableReplayBuffer: $('assistantEnableReplay').checked,
    replayMinutes: parseInt($('assistantReplayMinutes').value, 10) || 5,
    sosWebhook: $('assistantSosWebhook').value.trim(),
    searchProvider: $('assistantSearchProvider').value,
    searxngEndpoint: $('assistantSearxngEndpoint').value.trim() || 'https://searxng.nekosunevr.co.uk/',
    engine: sttCfg.engine || 'cloud',
    cloudBaseUrl: sttCfg.cloudBaseUrl || '',
    cloudApiKey: sttCfg.cloudApiKey || '',
    cloudModel: sttCfg.cloudModel || '',
    localModel: sttCfg.localModel || 'tiny',
    aiBaseUrl: aiCfg.baseUrl || '',
    aiApiKey: aiCfg.key || '',
    aiModel: aiCfg.model || ''
  }
  await api.saveSetting('assistant', cfg)
  ensureJarvisAssistant().configure(cfg)
  return cfg
}
function updateAssistantSearchRows () {
  $('assistantSearxngRow').style.display = $('assistantSearchProvider').value === 'searxng' ? '' : 'none'
}
async function setupAssistant () {
  const saved = await api.getSetting('assistant', {
    wakeWord: 'nova', micDeviceId: '', clipSeconds: 4, trustedFriends: [],
    enableReplayBuffer: false, replayMinutes: 5, sosWebhook: '',
    searchProvider: 'searxng', searxngEndpoint: 'https://searxng.nekosunevr.co.uk/'
  })
  $('assistantWakeWord').value = saved.wakeWord || 'nova'
  $('assistantClipSeconds').value = saved.clipSeconds || 4
  $('assistantMicSensitivity').value = String(saved.vadThreshold || 0.015)
  $('assistantTrustedFriends').value = (saved.trustedFriends || []).join(', ')
  $('assistantEnableReplay').checked = !!saved.enableReplayBuffer
  $('assistantReplayMinutes').value = String(saved.replayMinutes || 5)
  $('assistantSosWebhook').value = saved.sosWebhook || ''
  $('assistantSearchProvider').value = saved.searchProvider || 'searxng'
  $('assistantSearxngEndpoint').value = saved.searxngEndpoint || 'https://searxng.nekosunevr.co.uk/'
  updateAssistantSearchRows()
  await refreshAssistantMicDevices()
  if (saved.micDeviceId) $('assistantMicDevice').value = saved.micDeviceId
  await saveAssistantConfig()
  $('assistantSearchProvider').addEventListener('change', async () => { updateAssistantSearchRows(); await saveAssistantConfig() })
  ;['assistantWakeWord', 'assistantMicDevice', 'assistantClipSeconds', 'assistantMicSensitivity', 'assistantTrustedFriends', 'assistantEnableReplay', 'assistantReplayMinutes', 'assistantSosWebhook', 'assistantSearxngEndpoint']
    .forEach(id => $(id).addEventListener('change', saveAssistantConfig))
}
$('assistantToggle').addEventListener('click', async () => {
  const c = ensureJarvisAssistant()
  await c.setLive(!c.live)
})
$('assistantSosButton').addEventListener('click', async () => {
  await ensureJarvisAssistant().triggerSos()
})

init()
setupTts()
setupDesktopStt()
setupOcrTranslate()

// ── FumikoEcho easter egg ─────────────────────────────────────────────────────
;(function () {
  console.log(
    '%c  🦊 NekoSuneAPPS  ',
    'background:#1a0033;color:#c084fc;font-size:16px;font-weight:bold;padding:6px 14px;border-radius:8px;border:2px solid #7c3aed'
  )
  console.log(
    '%cBuilt by NekoSuneVR · Contributions by FumikoEcho (contact@fumikoecho.ca)',
    'color:#9b59b6;font-size:11px'
  )
  console.log(
    '%c↑↑↓↓←→←→BA for a secret 🐾',
    'color:#6b7280;font-size:10px'
  )

  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
  let kIdx = 0
  document.addEventListener('keydown', e => {
    if (e.key === KONAMI[kIdx]) {
      kIdx++
      if (kIdx === KONAMI.length) {
        kIdx = 0
        $('fumikoModal').style.display = 'flex'
      }
    } else {
      kIdx = e.key === KONAMI[0] ? 1 : 0
    }
  })
  $('fumikoClose').addEventListener('click', () => { $('fumikoModal').style.display = 'none' })
  $('fumikoModal').addEventListener('click', e => { if (e.target === $('fumikoModal')) $('fumikoModal').style.display = 'none' })
})()
setupAssistant()

// ─── Home dashboard ───────────────────────────────────────────────────────────
// ── Home news helpers ─────────────────────────────────────────────────────────

let _newsLastFetchedAt = 0

function renderHomeNews (nr) {
  const el = $('homeNews')
  if (!el) return
  if (nr && nr.ok && Array.isArray(nr.news) && nr.news.length) {
    _newsLastFetchedAt = nr.ts || Date.now()
    updateNewsAge()
    el.className = ''
    el.innerHTML = (nr.cached
      ? '<div class="news-cached-note">Showing cached news — couldn\'t reach hello.vrchat.com just now.</div>'
      : '') +
      nr.news.map(n => {
        const dateStr = n.date
          ? new Date(n.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : ''
        return `<div class="news-item" data-url="${esc(n.link)}">
          <div style="min-width:0">
            <div class="news-title">${esc(n.title)}</div>
            ${n.description ? `<div class="news-desc">${esc(n.description)}</div>` : ''}
            <div class="news-date">${dateStr}</div>
          </div>
        </div>`
      }).join('')
    el.querySelectorAll('.news-item[data-url]').forEach(item => {
      item.addEventListener('click', () => { if (item.dataset.url) api.openExternal(item.dataset.url) })
    })
  } else {
    el.className = 'muted'
    el.innerHTML = 'Could not load news. <button class="btn ghost" id="homeNewsRetryBtn" style="font-size:.75rem;padding:2px 8px;margin-left:4px">Retry</button>'
    const retryBtn = $('homeNewsRetryBtn')
    if (retryBtn) retryBtn.addEventListener('click', refreshHomeNews)
  }
}

async function refreshHomeNews () {
  const el = $('homeNews')
  const btn = $('homeNewsRefresh')
  if (btn) btn.disabled = true
  if (el) { el.className = 'muted'; el.textContent = 'Refreshing…' }
  try {
    const nr = await api.vrchatNews()
    renderHomeNews(nr)
  } catch (_) { renderHomeNews(null) }
  if (btn) btn.disabled = false
}

function updateNewsAge () {
  const el = $('homeNewsAge')
  if (!el || !_newsLastFetchedAt) return
  const mins = Math.floor((Date.now() - _newsLastFetchedAt) / 60000)
  el.textContent = mins < 1 ? 'just now' : `${mins}m ago`
}

// Tick the "X ago" label every minute so it stays accurate
setInterval(updateNewsAge, 60000)

// Background push from main process — runs every 5 minutes automatically
api.on('home:newsUpdate', result => renderHomeNews(result))

// Wire refresh button (runs once; button persists in DOM for the session)
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'homeNewsRefresh') refreshHomeNews()
})

// ─────────────────────────────────────────────────────────────────────────────

async function loadHome () {
  // Welcome hero
  try {
    const me = await api.vrchatStatus()
    if (me && me.ok && me.user) {
      const u = me.user
      setText('homeName', u.displayName || 'NekoSuneAPPS')
      const st = [u.status, u.statusDescription].filter(Boolean).join(' · ')
      setText('homeStatusLine', st || 'Online in VRChat')
      const ava = $('homeAvatar')
      if (ava && (u.userIcon || u.currentAvatarThumbnailImageUrl)) {
        ava.src = u.userIcon || u.currentAvatarThumbnailImageUrl
      }
    }
  } catch (_) {}

  // VRChat online count
  try {
    const oc = await api.vrchatOnline()
    if (oc && oc.ok) {
      if (oc.total) setText('homeVrcOnline', Number(oc.total).toLocaleString())
      if (oc.steam != null && oc.quest != null) {
        setText('homeVrcPlatforms', `${Number(oc.steam).toLocaleString()} · ${Number(oc.quest).toLocaleString()}`)
      }
    }
  } catch (_) {}

  // Friends online count from cache (populated after rightbar loads)
  if (Array.isArray(rbFriendsCache.online) && rbFriendsCache.online.length) {
    setText('homeFriendsOnline', String(rbFriendsCache.online.length))
  }

  // Recent worlds from history
  try {
    const hist = await api.historyList({ type: 'world', limit: 200 })
    const el = $('homeRecentWorlds')
    if (el && Array.isArray(hist) && hist.length) {
      const seen = new Set()
      const worlds = hist.filter(h => h.name && !seen.has(h.name) && seen.add(h.name)).slice(0, 8)
      el.className = ''
      el.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px'
      el.innerHTML = worlds.map(w =>
        `<span style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:.8rem;font-weight:600">${esc(w.name)}</span>`
      ).join('')
    }
  } catch (_) {}

  // VRChat news — renderHomeNews handles display; background poller keeps it fresh
  try {
    const nr = await api.vrchatNews()
    renderHomeNews(nr)
  } catch (_) { renderHomeNews(null) }

  // "More news" link
  const newsMore = $('homeNewsMore')
  if (newsMore) newsMore.addEventListener('click', () => api.openExternal('https://hello.vrchat.com/blog'), { once: true })
}

document.querySelectorAll('.home-quickbtn[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = document.querySelector(`[data-tab="${btn.dataset.goto}"]`)
    if (tab) tab.click()
  })
})

document.querySelector('[data-tab="home"]').addEventListener('click', loadHome)
setTimeout(loadHome, 600)

// ─── Background system ────────────────────────────────────────────────────────
const BG_PRESETS = [
  { key: 'aurora',  label: 'Aurora',   css: 'linear-gradient(135deg,#040d1a 0%,#061e3a 30%,#093038 60%,#04081a 100%)' },
  { key: 'neon',    label: 'Neon',     css: 'linear-gradient(135deg,#0a0014 0%,#1a003a 40%,#3a0060 70%,#0a0014 100%)' },
  { key: 'sakura',  label: 'Sakura',   css: 'linear-gradient(135deg,#14010a 0%,#2d0520 45%,#18002a 75%,#0a0014 100%)' },
  { key: 'ocean',   label: 'Ocean',    css: 'linear-gradient(160deg,#010810 0%,#011428 40%,#001a38 70%,#010810 100%)' },
  { key: 'forest',  label: 'Forest',   css: 'linear-gradient(135deg,#010a03 0%,#021a08 35%,#012010 65%,#010a03 100%)' },
  { key: 'gold',    label: 'Gold',     css: 'linear-gradient(135deg,#0c0a01 0%,#251c04 40%,#1c1402 70%,#0c0a01 100%)' },
  { key: 'void',    label: 'Void',     css: 'radial-gradient(ellipse at 20% 20%,#0f0520 0%,#020108 60%,#000 100%)' },
  { key: 'dusk',    label: 'Dusk',     css: 'linear-gradient(160deg,#0a0014 0%,#180828 30%,#0a1830 60%,#030612 100%)' },
]

let _bgCfg = { type: 'none' }

function applyBackground (cfg) {
  const layer = $('bgLayer')
  if (!layer) return
  _bgCfg = cfg || { type: 'none' }
  if (_bgCfg.type === 'none') {
    layer.style.backgroundImage = 'none'
    document.body.classList.remove('has-custom-bg')
    return
  }
  document.body.classList.add('has-custom-bg')
  const opacity = ((_bgCfg.opacity ?? 35) / 100).toFixed(2)
  const blur = `${_bgCfg.blur ?? 8}px`
  if (_bgCfg.type === 'preset') {
    const p = BG_PRESETS.find(x => x.key === _bgCfg.value)
    layer.style.backgroundImage = p ? p.css : 'none'
  } else {
    layer.style.backgroundImage = `url("file:///${_bgCfg.value.replace(/\\/g, '/')}")`
  }
  layer.style.opacity = opacity
  layer.style.filter = `blur(${blur})`
}

function saveBgConfig (cfg) {
  api.saveSetting('bgConfig', cfg)
  applyBackground(cfg)
}

function showBgPanel (src) {
  ;['bgPresetPanel', 'bgCustomPanel', 'bgPhotoPanel'].forEach(id => { if ($(id)) $(id).style.display = 'none' })
  const map = { preset: 'bgPresetPanel', custom: 'bgCustomPanel', photo: 'bgPhotoPanel' }
  if (map[src] && $(map[src])) $(map[src]).style.display = 'block'
  const sliders = $('bgSliders')
  if (sliders) sliders.style.display = src !== 'none' ? 'block' : 'none'
}

// Load saved background on startup
api.getSetting('bgConfig', null).then(cfg => {
  if (cfg && cfg.type) {
    applyBackground(cfg)
    // Restore UI state
    document.querySelectorAll('.bg-type-btn').forEach(b => b.classList.toggle('active', b.dataset.src === cfg.type))
    showBgPanel(cfg.type)
    if (cfg.type !== 'none') {
      const opEl = $('bgOpacity'), blEl = $('bgBlur')
      if (opEl && cfg.opacity != null) { opEl.value = cfg.opacity; setText('bgOpacityVal', cfg.opacity + '%') }
      if (blEl && cfg.blur != null) { blEl.value = cfg.blur; setText('bgBlurVal', cfg.blur + 'px') }
    }
    if (cfg.type === 'preset') {
      document.querySelectorAll('.bg-preset').forEach(b => b.classList.toggle('active', b.dataset.key === cfg.value))
    }
    if (cfg.type === 'custom' && cfg.value) {
      setText('bgCustomName', cfg.value.split(/[\\/]/).pop())
    }
  }
})

// Build preset grid
;(function () {
  const grid = $('bgPresetGrid')
  if (!grid) return
  BG_PRESETS.forEach(p => {
    const btn = document.createElement('div')
    btn.className = 'bg-preset'
    btn.dataset.key = p.key
    btn.title = p.label
    btn.style.background = p.css
    btn.innerHTML = `<span>${p.label}</span>`
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-preset').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      saveBgConfig({ type: 'preset', value: p.key, opacity: parseInt($('bgOpacity').value, 10), blur: parseInt($('bgBlur').value, 10) })
    })
    grid.appendChild(btn)
  })
})()

// Source type buttons
document.querySelectorAll('.bg-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-type-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const src = btn.dataset.src
    showBgPanel(src)
    if (src === 'none') saveBgConfig({ type: 'none' })
  })
})

// Custom file picker
if ($('bgPickFile')) {
  $('bgPickFile').addEventListener('click', () => {
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.onchange = () => {
      const file = inp.files[0]
      if (!file || !file.path) return
      setText('bgCustomName', file.name)
      saveBgConfig({ type: 'custom', value: file.path, opacity: parseInt($('bgOpacity').value, 10), blur: parseInt($('bgBlur').value, 10) })
    }
    inp.click()
  })
}

// VRChat photos
if ($('bgLoadPhotos')) {
  $('bgLoadPhotos').addEventListener('click', async () => {
    setText('bgLoadPhotos', 'Loading…')
    const r = await api.mediaPhotos()
    setText('bgLoadPhotos', 'Load VRChat photos')
    const grid = $('bgPhotoGrid')
    if (!r || !r.ok || !r.photos || !r.photos.length) {
      grid.innerHTML = '<span class="muted" style="font-size:.8rem;grid-column:1/-1">No photos found in your VRChat photos folder.</span>'
      return
    }
    grid.innerHTML = r.photos.slice(0, 48).map(p =>
      `<div class="bg-photo" data-path="${esc(p.path)}" title="${esc(p.name)}"><img src="file:///${esc(p.path.replace(/\\/g, '/'))}" referrerpolicy="no-referrer" loading="lazy" decoding="async" /></div>`
    ).join('')
    grid.querySelectorAll('.bg-photo').forEach(el => {
      el.addEventListener('click', () => {
        grid.querySelectorAll('.bg-photo').forEach(b => b.classList.remove('active'))
        el.classList.add('active')
        saveBgConfig({ type: 'photo', value: el.dataset.path, opacity: parseInt($('bgOpacity').value, 10), blur: parseInt($('bgBlur').value, 10) })
      })
    })
  })
}

// Opacity + blur sliders
if ($('bgOpacity')) {
  $('bgOpacity').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10)
    setText('bgOpacityVal', v + '%')
    if (_bgCfg.type !== 'none') saveBgConfig({ ..._bgCfg, opacity: v })
  })
}
if ($('bgBlur')) {
  $('bgBlur').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10)
    setText('bgBlurVal', v + 'px')
    if (_bgCfg.type !== 'none') saveBgConfig({ ..._bgCfg, blur: v })
  })
}

// Clear button
if ($('bgClear')) {
  $('bgClear').addEventListener('click', () => {
    document.querySelectorAll('.bg-type-btn').forEach(b => b.classList.toggle('active', b.dataset.src === 'none'))
    showBgPanel('none')
    saveBgConfig({ type: 'none' })
  })
}

/* ------------------------------------------------------------------ */
/* VRChat Quick Launch — multi-profile simultaneous VRChat launching   */
/* ------------------------------------------------------------------ */
let qlProfiles = []

function qlSaveProfiles () {
  api.saveSetting('quickLaunchProfiles', qlProfiles)
  qlSyncOscPorts().catch(err => console.warn('[quickLaunch] OSC port sync failed:', err.message))
}

function qlProfileRowHtml (p) {
  const { inPort, outPort } = oscPortsForProfileId(p.id)
  return `<div class="ql-profile-row" data-id="${esc(p.id)}">
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
      <input type="checkbox" class="ql-sel" ${p.selected ? 'checked' : ''} title="Include in Launch selected">
      <input type="number" class="ql-id" value="${esc(p.id)}" min="0" max="50" title="Profile number (--profile=N)">
      <input type="text" class="ql-desc" value="${esc(p.desc || '')}" placeholder="Description" style="flex:1;min-width:120px">
      <label class="ql-flag"><input type="checkbox" class="ql-vr" ${p.vr ? 'checked' : ''}> VR</label>
      <span class="ql-flag" title="OSC ports for this profile — VRChat receives on the first, sends on the second">OSC ${inPort}→${outPort}</span>
      <button class="btn" style="padding:6px 10px" data-action="launch">Launch</button>
      <button class="btn danger" style="padding:6px 10px" data-action="remove">✖</button>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:12px;margin-top:8px">
      <label class="ql-flag"><input type="checkbox" class="ql-debuggui" ${p.debugGui ? 'checked' : ''}> Debug GUI</label>
      <label class="ql-flag"><input type="checkbox" class="ql-sdklog" ${p.sdkLog ? 'checked' : ''}> SDK log</label>
      <label class="ql-flag"><input type="checkbox" class="ql-udonlog" ${p.udonLog ? 'checked' : ''}> UDON log</label>
      <label class="ql-flag">Max FPS <input type="number" class="ql-fps" value="${esc(p.maxFps || '')}" min="0"></label>
      <input type="text" class="ql-custom" value="${esc(p.customArgs || '')}" placeholder="Custom parameters" style="flex:1;min-width:150px">
    </div>
    <div class="muted ql-row-out" style="margin-top:6px;font-size:.76rem"></div>
  </div>`
}

function qlRenderProfiles () {
  const el = $('qlProfiles')
  if (!el) return
  el.innerHTML = qlProfiles.length ? qlProfiles.map(qlProfileRowHtml).join('') : '<div class="muted" style="font-size:.8rem">No profiles yet — add one below.</div>'
}

// Pulls a row's current field values back into its backing profile object
// (identified by the row's stable data-id, not the editable profile-number
// input) so Launch/Launch-all/Remove always act on what's on screen.
function qlReadRow (rowEl) {
  const backingId = rowEl.dataset.id
  const p = qlProfiles.find(x => String(x.id) === String(backingId))
  if (!p) return null
  p.selected = rowEl.querySelector('.ql-sel').checked
  const newId = parseInt(rowEl.querySelector('.ql-id').value, 10)
  if (Number.isFinite(newId)) p.id = newId
  p.desc = rowEl.querySelector('.ql-desc').value
  p.vr = rowEl.querySelector('.ql-vr').checked
  p.debugGui = rowEl.querySelector('.ql-debuggui').checked
  p.sdkLog = rowEl.querySelector('.ql-sdklog').checked
  p.udonLog = rowEl.querySelector('.ql-udonlog').checked
  p.maxFps = rowEl.querySelector('.ql-fps').value
  p.customArgs = rowEl.querySelector('.ql-custom').value
  return p
}

function qlReadInstanceInfo () {
  return {
    mode: $('qlInstMode').value,
    worldId: $('qlInstWorldId').value.trim(),
    location: $('qlInstLocation').value.trim(),
    access: $('qlInstAccess').value
  }
}

// Mirrors every non-default profile's OSC ports (see oscPortsForProfileId —
// profile 0 always matches this app's own primary send/receive ports, so
// only profiles 1+ need mirroring) into the Settings → OSC "extra targets"/
// "extra receivers" lists, so chatbox/AudioLink/avatar-param OSC reaches
// every simultaneously-launched VRChat instance, not just the default one.
// Tracks exactly what it last added (quickLaunchOscManaged) so it can
// cleanly add/remove its own entries as profiles change without touching
// anything the user configured by hand on the OSC settings page.
async function qlSyncOscPorts () {
  const derivedTargets = []
  const derivedReceivers = []
  for (const p of qlProfiles) {
    if ((Number(p.id) || 0) === 0) continue
    const { inPort, outPort } = oscPortsForProfileId(p.id)
    derivedTargets.push({ host: '127.0.0.1', port: inPort })
    derivedReceivers.push(outPort)
  }

  const prevManaged = await api.getSetting('quickLaunchOscManaged', { targets: [], receivers: [] })
  const savedTargets = await api.getSetting('extraOscTargets', [])
  const savedReceivers = await api.getSetting('extraOscReceivers', [])

  const keepTargets = savedTargets.filter(t => !prevManaged.targets.some(m => m.host === t.host && m.port === t.port))
  const keepReceivers = savedReceivers.filter(port => !prevManaged.receivers.includes(port))

  const mergedTargets = [...keepTargets, ...derivedTargets.filter(dt => !keepTargets.some(kt => kt.host === dt.host && kt.port === dt.port))]
  const mergedReceivers = [...new Set([...keepReceivers, ...derivedReceivers])]

  await applyExtraOscTargets(mergedTargets)
  await api.saveSetting('extraOscTargets', mergedTargets)
  if ($('extraOscTargets')) $('extraOscTargets').value = oscTargetsToText(mergedTargets)
  setText('extraOscTargetsOut', mergedTargets.length ? `Mirroring OSC to ${mergedTargets.length} extra target(s).` : 'Only the primary OSC send port is used.')

  setExtraOscReceiverPorts(mergedReceivers)
  await api.saveSetting('extraOscReceivers', mergedReceivers)
  if ($('extraOscReceivers')) $('extraOscReceivers').value = oscPortsToText(mergedReceivers)
  setText('extraOscReceiversOut', mergedReceivers.length ? `Listening on ${mergedReceivers.length} extra receive port(s).` : 'Only the primary receive port is used.')

  await api.saveSetting('quickLaunchOscManaged', { targets: derivedTargets, receivers: derivedReceivers })
}

function qlUpdateInstFieldsVisibility () {
  const mode = $('qlInstMode').value
  $('qlInstWorldId').style.display = mode === 'create' ? '' : 'none'
  $('qlInstLocation').style.display = mode === 'join' ? '' : 'none'
  $('qlInstAccess').style.display = mode === 'create' ? '' : 'none'
}

function qlRefreshExePath (r) {
  if (r && r.ok) {
    $('qlExePath').value = r.path
    setText('qlExeOut', r.isOverride ? 'Using manually selected path.' : "Auto-detected from VRChat's registered launch handler.")
  } else {
    $('qlExePath').value = ''
    setText('qlExeOut', 'Not found — VRChat may not be installed, or use Browse to set the path manually.')
  }
}

if ($('qlProfiles')) {
  api.getSetting('quickLaunchProfiles', []).then(saved => {
    qlProfiles = Array.isArray(saved) ? saved : []
    qlRenderProfiles()
    qlSyncOscPorts().catch(err => console.warn('[quickLaunch] OSC port sync failed:', err.message))
  })
  api.quickLaunchResolveExe().then(qlRefreshExePath)
  qlUpdateInstFieldsVisibility()

  $('qlInstMode').addEventListener('change', qlUpdateInstFieldsVisibility)

  $('qlAutoDetect').addEventListener('click', async () => {
    setText('qlExeOut', 'Detecting…')
    qlRefreshExePath(await api.quickLaunchResolveExe())
  })

  $('qlBrowseExe').addEventListener('click', async () => {
    const r = await api.quickLaunchBrowseExe()
    if (r.ok) qlRefreshExePath({ ok: true, path: r.path, isOverride: true })
  })

  $('qlAddProfile').addEventListener('click', () => {
    const usedIds = new Set(qlProfiles.map(p => p.id))
    let nextId = 0
    while (usedIds.has(nextId)) nextId++
    qlProfiles.push({ id: nextId, desc: '', vr: false, debugGui: false, sdkLog: false, udonLog: false, maxFps: '', customArgs: '', selected: true })
    qlSaveProfiles()
    qlRenderProfiles()
  })

  $('qlLaunchAll').addEventListener('click', async () => {
    document.querySelectorAll('#qlProfiles .ql-profile-row').forEach(qlReadRow)
    qlSaveProfiles()
    const selected = qlProfiles.filter(p => p.selected)
    if (!selected.length) { setText('qlLaunchOut', 'No profiles selected.'); return }
    setText('qlLaunchOut', `Launching ${selected.length} profile(s)…`)
    const r = await api.quickLaunchLaunchAll(selected, qlReadInstanceInfo())
    if (!r.ok) { setText('qlLaunchOut', '✗ ' + (r.error || 'failed')); return }
    const okCount = r.results.filter(x => x.ok).length
    const failMsgs = r.results.filter(x => !x.ok).map(x => `profile ${x.id}: ${x.error}`)
    setText('qlLaunchOut', `✅ Launched ${okCount}/${selected.length}` + (failMsgs.length ? ` — ${failMsgs.join('; ')}` : ''))
  })

  $('qlProfiles').addEventListener('change', e => {
    const row = e.target.closest('.ql-profile-row')
    if (row) { qlReadRow(row); qlSaveProfiles() }
  })

  $('qlProfiles').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    const row = btn.closest('.ql-profile-row')
    const p = qlReadRow(row)
    if (!p) return
    if (btn.dataset.action === 'remove') {
      qlProfiles = qlProfiles.filter(x => x !== p)
      qlSaveProfiles()
      qlRenderProfiles()
      return
    }
    if (btn.dataset.action === 'launch') {
      const out = row.querySelector('.ql-row-out')
      out.textContent = 'Launching…'
      qlSaveProfiles()
      const r = await api.quickLaunchLaunch(p, qlReadInstanceInfo())
      out.textContent = r.ok ? `✅ Launched (pid ${r.pid})` : `✗ ${r.error || 'failed'}`
    }
  })
}

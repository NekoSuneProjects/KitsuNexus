const dgram = require('dgram')

const oscClient = dgram.createSocket('udp4')
const oscListeners = new Set()
const OSC_MAX_LEVEL = 0.92

let oscPort = 9000
let oscReceiver = null
let oscReceiveEnabled = false
let receiverPort = 9001
let oscIncomingCallback = null
let extraOscTargets = []
let extraReceiverPorts = []
const extraOscReceivers = new Map()

const OSC_PATHS = {
  low: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Low',
  bass: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Bass',
  mid: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Mid',
  treble: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Treble',
  volume: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Volume',
  peak: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Peak',
  beat: '/avatar/parameters/VRCOSC/NekoSuneApps/Audiolink/Beat'
}

const CHATBOX_INPUT_PATH = '/chatbox/input'

function setOscPort (port) {
  oscPort = port
}

function normalizeOscTarget (target) {
  if (typeof target === 'number') return { host: '127.0.0.1', port: target }
  if (!target || typeof target !== 'object') return null
  const port = Number(target.port)
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null
  return {
    host: String(target.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.floor(port)
  }
}

function setExtraOscTargets (targets = []) {
  extraOscTargets = (Array.isArray(targets) ? targets : [])
    .map(normalizeOscTarget)
    .filter(Boolean)
}

function getOscTargets () {
  return [{ host: '127.0.0.1', port: oscPort }, ...extraOscTargets]
}

function sendBufferToTargets (buffer, label) {
  getOscTargets().forEach(target => {
    oscClient.send(buffer, target.port, target.host, error => {
      if (error) console.error(`${label || 'OSC'} Error:`, error)
    })
  })
}

// Send many { address, type: 'float'|'int'|'bool'|'floats', value } messages as
// OSC bundles (≤4096 bytes each) to every target — used by face/hand tracking.
function sendMessages (messages) {
  const { createOscBundles } = require('./oscEncode')
  const toArgs = m => m.type === 'floats' ? m.value.map(v => ({ type: 'float', value: Number(v) || 0 }))
    : [{ type: m.type === 'bool' ? 'bool' : m.type === 'int' ? 'int' : 'float', value: m.type === 'int' ? (parseInt(m.value, 10) || 0) : m.type === 'bool' ? !!m.value : (Number(m.value) || 0) }]
  const bundles = createOscBundles(messages.map(m => ({ address: m.address, args: toArgs(m) })))
  for (const b of bundles) sendBufferToTargets(b, 'OSC tracking')
  return bundles.length
}

function setOscReceiverPort (port) {
  if (!Number.isFinite(port) || receiverPort === port) return

  receiverPort = port
  if (oscReceiver) {
    closeOscReceiver()
    ensureOscReceiver()
  }
}

function setExtraOscReceiverPorts (ports = []) {
  extraReceiverPorts = (Array.isArray(ports) ? ports : [])
    .map(port => Math.floor(Number(port)))
    .filter(port => Number.isFinite(port) && port > 0 && port <= 65535 && port !== receiverPort)
    .filter((port, index, list) => list.indexOf(port) === index)

  for (const [port, socket] of extraOscReceivers.entries()) {
    if (!extraReceiverPorts.includes(port)) {
      socket.close()
      extraOscReceivers.delete(port)
    }
  }

  if (oscReceiveEnabled || oscListeners.size > 0) ensureExtraOscReceivers()
}

function sendOsc (levels) {
  const volume = levels.reduce((a, b) => a + b, 0) / levels.length
  const peak = Math.max(...levels)

  const values = [levels[0], levels[1], levels[2], levels[3], volume, peak].map(clampOscLevel)
  const paths = [
    OSC_PATHS.low,
    OSC_PATHS.bass,
    OSC_PATHS.mid,
    OSC_PATHS.treble,
    OSC_PATHS.volume,
    OSC_PATHS.peak
  ]

  values.forEach((val, i) => {
    const buffer = createOscMessage(paths[i], val)
    sendBufferToTargets(buffer, 'OSC')
  })
}

function sendBeat (value) {
  const buffer = createOscMessage(OSC_PATHS.beat, value)
  sendBufferToTargets(buffer, 'OSC Beat')
}

function sendChatboxMessage (message, notify = false) {
  // send=true bypasses the VRChat keyboard; notify=false avoids the chat SFX.
  const buffer = createChatboxMessage(String(message || '').slice(0, 144), true, notify)
  sendBufferToTargets(buffer, 'OSC Chatbox')
}

function clampOscLevel (value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(OSC_MAX_LEVEL, value))
}

function startOscReceiver (port, onIncoming) {
  if (typeof port === 'number') {
    setOscReceiverPort(port)
  }

  oscIncomingCallback = onIncoming
  oscReceiveEnabled = true
  ensureOscReceiver()
}

function stopOscReceiver () {
  oscIncomingCallback = null
  oscReceiveEnabled = false
  closeOscReceiverIfIdle()
}

function addOscListener (listener, port) {
  if (typeof listener !== 'function') {
    throw new TypeError('OSC listener must be a function')
  }

  if (typeof port === 'number') {
    setOscReceiverPort(port)
  }

  oscListeners.add(listener)
  ensureOscReceiver()

  return () => {
    oscListeners.delete(listener)
    closeOscReceiverIfIdle()
  }
}

function ensureOscReceiver () {
  if (oscReceiver) return

  oscReceiver = dgram.createSocket('udp4')
  oscReceiver.on('error', err => {
    console.error('OSC Receiver Error:', err)
  })

  oscReceiver.on('message', handleOscMessage)

  oscReceiver.bind(receiverPort, '0.0.0.0', () => {
    console.log(`OSC receiver listening on port ${receiverPort}`)
    if (typeof oscIncomingCallback === 'function') {
      oscIncomingCallback('/_status', [`Receiver listening on ${receiverPort}`])
    }
  })

  ensureExtraOscReceivers()
}

function ensureExtraOscReceivers () {
  extraReceiverPorts.forEach(port => {
    if (extraOscReceivers.has(port)) return
    const socket = dgram.createSocket('udp4')
    socket.on('error', err => console.error(`OSC Receiver ${port} Error:`, err))
    socket.on('message', handleOscMessage)
    socket.bind(port, '0.0.0.0', () => {
      console.log(`Extra OSC receiver listening on port ${port}`)
      if (typeof oscIncomingCallback === 'function') {
        oscIncomingCallback('/_status', [`Extra receiver listening on ${port}`])
      }
    })
    extraOscReceivers.set(port, socket)
  })
}

function handleOscMessage (msg, rinfo) {
  try {
    const packet = parseOscMessage(msg)
    if (!packet || !packet.address) return

    if (typeof oscIncomingCallback === 'function') {
      oscIncomingCallback(packet.address, packet.args || [])
    }

    oscListeners.forEach(listener => {
      listener(packet.address, packet.args || [], rinfo)
    })
  } catch (err) {
    console.warn('Unable to parse incoming OSC packet:', err)
  }
}

function closeOscReceiverIfIdle () {
  if (!oscReceiveEnabled && oscListeners.size === 0) {
    closeOscReceiver()
  }
}

function closeOscReceiver () {
  if (!oscReceiver) return

  oscReceiver.close()
  oscReceiver = null
  for (const socket of extraOscReceivers.values()) socket.close()
  extraOscReceivers.clear()
}

function align4 (value) {
  return (value + 3) & ~3
}

function readOscString (buffer, offset) {
  let end = offset
  while (end < buffer.length && buffer[end] !== 0) end++
  const str = buffer.toString('utf8', offset, end)
  return { str, next: align4(end + 1) }
}

function parseOscMessage (buffer) {
  const addressData = readOscString(buffer, 0)
  if (!addressData.str) return null

  const typeData = readOscString(buffer, addressData.next)
  if (!typeData.str || !typeData.str.startsWith(',')) {
    return { address: addressData.str, args: [] }
  }

  const args = []
  let offset = typeData.next

  for (let i = 1; i < typeData.str.length; i++) {
    const type = typeData.str[i]
    switch (type) {
      case 'f':
        args.push(buffer.readFloatBE(offset))
        offset += 4
        break
      case 'i':
        args.push(buffer.readInt32BE(offset))
        offset += 4
        break
      case 's': {
        const stringData = readOscString(buffer, offset)
        args.push(stringData.str)
        offset = stringData.next
        break
      }
      case 'T':
        args.push(true)
        break
      case 'F':
        args.push(false)
        break
      default:
        return { address: addressData.str, args }
    }
  }

  return { address: addressData.str, args }
}

function createOscMessage (address, value) {
  const addressBuffer = encodeOscString(address)
  const typeTag = encodeOscString(',f')
  const floatBuffer = Buffer.alloc(4)
  floatBuffer.writeFloatBE(value, 0)
  return Buffer.concat([addressBuffer, typeTag, floatBuffer])
}

// Param Lab: send any avatar parameter as bool / int / float.
function sendParam (address, value, type = 'float') {
  const addr = encodeOscString(address)
  let buf
  if (type === 'bool') {
    buf = Buffer.concat([addr, encodeOscString(value ? ',T' : ',F')])
  } else if (type === 'int') {
    const b = Buffer.alloc(4); b.writeInt32BE(parseInt(value, 10) || 0, 0)
    buf = Buffer.concat([addr, encodeOscString(',i'), b])
  } else {
    const b = Buffer.alloc(4); b.writeFloatBE(Number(value) || 0, 0)
    buf = Buffer.concat([addr, encodeOscString(',f'), b])
  }
  sendBufferToTargets(buf, 'OSC')
}

function createChatboxMessage (message, send, notify) {
  return Buffer.concat([
    encodeOscString(CHATBOX_INPUT_PATH),
    encodeOscString(`,s${send ? 'T' : 'F'}${notify ? 'T' : 'F'}`),
    encodeOscString(message)
  ])
}

function encodeOscString (value) {
  const data = Buffer.from(`${value}\0`, 'utf8')
  const padding = (4 - (data.length % 4)) % 4
  return Buffer.concat([data, Buffer.alloc(padding)])
}

module.exports = {
  setOscPort,
  setExtraOscTargets,
  setOscReceiverPort,
  setExtraOscReceiverPorts,
  sendOsc,
  sendParam,
  sendMessages,
  sendBeat,
  sendChatboxMessage,
  startOscReceiver,
  stopOscReceiver,
  addOscListener,
  parseOscMessage,
  OSC_PATHS,
  CHATBOX_INPUT_PATH
}

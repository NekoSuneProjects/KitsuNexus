const { updateWaveform, calculateLevels } = require('./waveform')

let audioContext
let analyser
let source
let stream
let isAnalyzing = false
let analysisTimer = null
const oscSendIntervalMs = 50

async function loadAudioDevices () {
  const audioSelect = document.getElementById('audioDeviceSelect')
  audioSelect.innerHTML = '<option value="">Loading devices...</option>'

  try {
    let devices = await navigator.mediaDevices.enumerateDevices()

    if (!devices || devices.length === 0) {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true })
        devices = await navigator.mediaDevices.enumerateDevices()
      } catch (permissionError) {
        console.warn('Audio permission request failed:', permissionError)
      }
    }

    const audioInputDevices = devices.filter(device => device.kind === 'audioinput')
    const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput')

    audioSelect.innerHTML = ''

    audioInputDevices.forEach((device, index) => {
      const option = document.createElement('option')
      option.value = device.deviceId
      option.dataset.kind = 'audioinput'
      option.text = `Mic: ${device.label || 'Device ' + (index + 1)}`
      audioSelect.appendChild(option)
    })

    if (audioInputDevices.length === 0 && audioOutputDevices.length > 0) {
      audioOutputDevices.forEach((device, index) => {
        const option = document.createElement('option')
        option.value = device.deviceId
        option.dataset.kind = 'audiooutput'
        option.disabled = true
        option.text = `Playback (not capturable): ${device.label || 'Device ' + (index + 1)}`
        audioSelect.appendChild(option)
      })
    }

    if (audioInputDevices.length === 0) {
      const noDevicesOption = document.createElement('option')
      noDevicesOption.value = ''
      noDevicesOption.text = 'No microphone devices found'
      audioSelect.appendChild(noDevicesOption)
    }

    const savedDevice = await window.electronAPI.getSetting('selectedAudioDevice', '')
    const savedOption = savedDevice
      ? [...audioSelect.options].find(o => o.value === savedDevice && !o.disabled)
      : null

    if (savedOption) {
      audioSelect.value = savedDevice
    } else if (audioInputDevices.length > 0) {
      audioSelect.value = audioInputDevices[0].deviceId
      await window.electronAPI.saveSetting('selectedAudioDevice', audioInputDevices[0].deviceId)
    }
  } catch (error) {
    console.error('Error loading audio devices:', error)
    audioSelect.innerHTML = ''
    const errorOption = document.createElement('option')
    errorOption.value = ''
    errorOption.text = 'Unable to load devices'
    audioSelect.appendChild(errorOption)
  }
}

async function setupAudioAnalysis (deviceId, callbacks = {}) {
  const { onLevels, onError } = callbacks

  try {
    if (audioContext) stopAudioAnalysis()

    audioContext = new (window.AudioContext || window.webkitAudioContext)()

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    analyser = audioContext.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.2

    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    })

    source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)

    isAnalyzing = true
    const dataArray = new Float32Array(analyser.frequencyBinCount)
    let smoothedLevels = [0, 0, 0, 0]
    const smoothing = 0.6

    if (analysisTimer) {
      clearInterval(analysisTimer)
    }

    analysisTimer = setInterval(() => {
      if (!isAnalyzing) return

      analyser.getFloatFrequencyData(dataArray)
      const levels = calculateLevels(dataArray, audioContext.sampleRate)
      smoothedLevels = smoothedLevels.map((prev, i) => prev * smoothing + levels[i] * (1 - smoothing))
      updateWaveform(smoothedLevels)

      if (typeof onLevels === 'function') {
        onLevels(smoothedLevels)
      }
    }, oscSendIntervalMs)
    return true
  } catch (err) {
    stopAudioAnalysis()
    if (typeof onError === 'function') {
      onError(err)
    } else {
      console.error('AUDIO START FAILED:', err)
    }
    return false
  }
}

function stopAudioAnalysis () {
  if (analysisTimer) {
    clearInterval(analysisTimer)
    analysisTimer = null
  }

  if (source) source.disconnect()
  if (stream) stream.getTracks().forEach(track => track.stop())
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
  source = null
  stream = null
  analyser = null
  audioContext = null
  isAnalyzing = false
}

module.exports = {
  loadAudioDevices,
  setupAudioAnalysis,
  stopAudioAnalysis
}

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setupAudioAnalysis, stopAudioAnalysis } = require('../modules/vrchat/audio/audioModule')

test('failed microphone startup reports failure and releases the audio context', async () => {
  const originalWindow = global.window
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator')
  let closed = 0
  try {
    global.window = {
      AudioContext: class {
        state = 'running'
        createAnalyser () { return { fftSize: 0, smoothingTimeConstant: 0 } }
        close () { closed++; return Promise.resolve() }
      }
    }
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => { throw new Error('Microphone unavailable') } } }
    })
    let message = ''
    const started = await setupAudioAnalysis('missing-device', { onError: err => { message = err.message } })
    assert.equal(started, false)
    assert.equal(message, 'Microphone unavailable')
    assert.equal(closed, 1)
    stopAudioAnalysis() // A failed start should also be safe to stop again.
    assert.equal(closed, 1)
  } finally {
    global.window = originalWindow
    if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator)
    else delete global.navigator
  }
})

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PHRASES, createHalloweenSpeech } = require('../modules/ui/halloweenPhrases')

function fakeBubble () {
  const classes = new Set()
  return {
    textContent: '', offsetWidth: 200,
    classList: {
      add: cls => classes.add(cls),
      remove: cls => classes.delete(cls),
      contains: cls => classes.has(cls)
    }
  }
}

test('Ghostface rotates phrases every five seconds, restarts and stops with the seasonal theme', () => {
  const a = fakeBubble(); const b = fakeBubble()
  let callback; let milliseconds; let starts = 0; let stops = 0
  const speech = createHalloweenSpeech([a, b], {
    setTimer: (fn, ms) => { callback = fn; milliseconds = ms; starts++; return starts },
    clearTimer: () => { stops++ }
  })
  assert.ok(PHRASES.length >= 8)
  speech.setActive(true)
  speech.setActive(true)
  assert.equal(starts, 1)
  assert.equal(milliseconds, 5000)
  assert.equal(a.textContent, 'DO YOU LIKE WATCHING SCARY MOVIES?')
  assert.equal(b.textContent, a.textContent)
  assert.equal(a.classList.contains('is-speaking'), true)
  callback()
  assert.equal(a.textContent, "WHAT'S YOUR FAVOURITE SCARY MOVIE?")
  for (let i = 0; i < PHRASES.length - 1; i++) callback()
  assert.equal(a.textContent, PHRASES[0])
  speech.setActive(false)
  assert.equal(stops, 1)
  assert.equal(a.classList.contains('is-speaking'), false)
  speech.setActive(true)
  assert.equal(starts, 2)
})

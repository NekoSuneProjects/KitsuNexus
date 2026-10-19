'use strict'

const PHRASES = Object.freeze([
  'DO YOU LIKE WATCHING SCARY MOVIES?',
  "WHAT'S YOUR FAVOURITE SCARY MOVIE?",
  'DO YOU WANT TO PLAY A GAME?',
  'LOOK BEHIND YOU.',
  'WHO IS YOUR FAVOURITE HORROR VILLAIN?',
  'DID YOU HEAR THAT?',
  'SOMEONE IS AT THE DOOR.',
  'THE NIGHT IS STILL YOUNG.',
  'YOU CAN’T HIDE FOREVER.',
  'WHAT WAS THAT NOISE?',
  'DON’T ANSWER THE PHONE.',
  'I CAN SEE YOU.'
])

function createHalloweenSpeech (bubbles, { setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let timer = null
  let index = 0
  const elements = Array.from(bubbles)

  function next () {
    for (const bubble of elements) {
      bubble.textContent = PHRASES[index]
      bubble.classList.remove('is-speaking')
      // Restart the 5-second appear / vanish cycle for the new phrase.
      void bubble.offsetWidth
      bubble.classList.add('is-speaking')
    }
    index = (index + 1) % PHRASES.length
  }

  function setActive (active) {
    if (active && timer === null) {
      next()
      timer = setTimer(next, 5000)
    } else if (!active && timer !== null) {
      clearTimer(timer)
      timer = null
      for (const bubble of elements) bubble.classList.remove('is-speaking')
    }
  }

  return { setActive }
}

module.exports = { PHRASES, createHalloweenSpeech }

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { ChatboxComposer, fitLines, clip, MAX_CHATBOX } = require('../modules/vrchat/chatbox/chatboxComposer')

const LONG_SONG = 'Artist Name feat. Another Artist & Third Person - An Extremely Long Hardstyle Frenchcore Remix Title (Extended Festival Edit) [2026 Remaster]'

test('a long first line no longer blanks the whole chatbox', () => {
  const c = new ChatboxComposer({ sendChatboxMessage: () => {} })
  c.setModes({ status: 'off' })
  c.update({ song: LONG_SONG, songBar: '▓▓▓▓░░░░░░', songTime: '1:23-5:45', cpu: 10, gpu: 20, ramPct: 30, hr: 80, hrOnline: true })
  const msg = c.buildMessage()
  assert.ok(msg.length > 0 && msg.length <= MAX_CHATBOX)
  const lines = msg.split('\n')
  assert.equal(lines.length, 4, 'now playing, stats, heart rate and clock all still shown')
  assert.match(lines[0], /^🎵 Artist Name.*…$/)
  assert.equal(lines[1], '🖥 CPU 10% | GPU 20% | RAM 30%')
  assert.equal(lines[2], '💗 80 bpm')
})

test('blocks that already fit are unchanged', () => {
  assert.equal(fitLines(['a', 'b', 'c']), 'a\nb\nc')
})

test('only the longest lines are shortened, total stays within 144', () => {
  const out = fitLines(['x'.repeat(200), 'short line', 'y'.repeat(100)])
  assert.ok(out.length <= MAX_CHATBOX)
  const [a, b, c] = out.split('\n')
  assert.equal(b, 'short line')
  assert.ok(a.endsWith('…') && c.endsWith('…'))
})

test('clip never splits an emoji', () => {
  const s = clip('x'.repeat(140) + '😀😀😀', 144)
  assert.ok(s.length <= 144)
  assert.doesNotMatch(s, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})

test('manual messages are capped without half emojis', () => {
  let sent = ''
  const c = new ChatboxComposer({ sendChatboxMessage: t => { sent = t } })
  c.sendNow('x'.repeat(143) + '😀')
  assert.ok(sent.length <= 144)
  assert.doesNotMatch(sent, /[\uD800-\uDBFF]$/)
  c.clearHold()
})

test('OSC chatbox send drops half emojis left by callers that pre-sliced', () => {
  const { chatboxText } = require('../modules/vrchat/osc/oscModule')
  const preSliced = ('x'.repeat(143) + '😀').slice(0, 144) // ends in a lone high surrogate
  const out = chatboxText(preSliced)
  assert.equal(out, 'x'.repeat(143))
  assert.equal(chatboxText('hi 😀'), 'hi 😀')
})

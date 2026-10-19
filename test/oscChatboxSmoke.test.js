'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { ChatboxComposer } = require('../modules/vrchat/chatbox/chatboxComposer')

test('chatbox composition remains independent of booster status', () => {
  const composer = new ChatboxComposer({ sendChatboxMessage: () => {} })
  composer.setModes({ nowPlaying: 'off', stats: 'off', clock: 'off' })
  composer.setPresets(['KitsuNexus OSC smoke'])
  assert.match(composer.buildMessage(), /KitsuNexus OSC smoke/)
  assert.doesNotMatch(composer.buildMessage(), /[Bb]oost|[Cc]onstellation/)
})

test('sendChatboxMessage still emits an OSC UDP datagram on the selected port', () => {
  // Isolate OSC's long-lived UDP socket from the test runner.
  const script = `
    const dgram = require('node:dgram')
    const socket = dgram.createSocket('udp4')
    socket.on('message', payload => {
      const message = payload.toString('utf8')
      process.exit(message.includes('/chatbox/input') && message.includes('KitsuNexus OSC smoke') ? 0 : 2)
    })
    socket.bind(0, '127.0.0.1', () => {
      const osc = require('./modules/vrchat/osc/oscModule')
      osc.setOscPort(socket.address().port)
      osc.sendChatboxMessage('KitsuNexus OSC smoke')
    })
    setTimeout(() => process.exit(3), 1500)
  `
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), timeout: 4000, encoding: 'utf8'
  })
  assert.equal(result.status, 0, `${result.stderr || ''} ${result.stdout || ''}`)
})

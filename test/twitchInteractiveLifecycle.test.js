'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const EventEmitter = require('node:events')

const pending = []
let sockets = 0
class FakeSocket extends EventEmitter {
  constructor () { super(); sockets++ }
  close () {}
}

const load = Module._load
let interactive
try {
  Module._load = function (name, ...args) {
    if (name === 'axios') return { get: () => new Promise(resolve => pending.push(resolve)), post: () => Promise.resolve() }
    if (name === 'ws') return FakeSocket
    return load.call(this, name, ...args)
  }
  interactive = require('../modules/live/twitch/interactive')
} finally { Module._load = load }

function authorize (login = 'channel') {
  assert.equal(pending.length, 3)
  const requests = pending.splice(0)
  requests[0]({ data: { scopes: ['chat:read', 'channel:read:redemptions'], client_id: 'public' } })
  requests[1]({ data: { data: [{ id: '123', login }] } })
  requests[2]({ data: { data: [{ id: '123', login }] } })
}

function start () {
  return interactive.start({ login: 'channel', clientId: 'public', token: 'access', mappings: 'command | !hello | 1' }, () => {})
}

test('stopping during Twitch identity lookup never reopens sockets', async () => {
  const before = sockets
  const starting = start()
  interactive.stop(false)
  authorize()
  assert.equal((await starting).running, false)
  assert.equal(sockets, before)
  assert.equal(interactive.getState().running, false)
})

test('old login completion cannot replace a newer Twitch connection', async () => {
  const oldStart = start()
  const oldRequests = pending.splice(0)
  const newStart = start()
  const before = sockets
  authorize()
  assert.equal((await newStart).running, true)
  assert.equal(sockets, before + 2)

  oldRequests[0]({ data: { scopes: ['chat:read', 'channel:read:redemptions'], client_id: 'public' } })
  oldRequests[1]({ data: { data: [{ id: '123', login: 'old-user' }] } })
  oldRequests[2]({ data: { data: [{ id: '123', login: 'old-user' }] } })
  assert.equal((await oldStart).running, false)
  assert.equal(interactive.getState().running, true)
  assert.equal(sockets, before + 2)
  interactive.stop(false)
})

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const pending = []
const originalLoad = Module._load
let followers
try {
  Module._load = function (name, ...args) {
    if (name === 'axios') return {
      get: (url, options) => new Promise(resolve => pending.push({ url, options, resolve })),
      post: () => { throw new Error('Unexpected refresh') },
    }
    return originalLoad.call(this, name, ...args)
  }
  followers = require('../modules/live/twitch/followers')
} finally { Module._load = originalLoad }

const config = token => ({ clientId: 'public-id', token, login: 'channel' })

test('stopping during first follower request cancels polling and clears tokens', async () => {
  const starting = followers.startTwitch(config('old-secret'), () => {})
  assert.equal(followers.getTwitchState().running, true)
  const first = pending.shift()
  assert.equal(first.options.headers.Authorization, 'Bearer old-secret')
  followers.stopTwitch()
  first.resolve({ data: { data: [{ id: '123' }] } })
  await starting
  assert.equal(followers.getTwitchState().running, false)
  assert.equal(followers.getTwitchState().token, '')
  assert.equal(pending.length, 0)
})

test('token replacement while first request runs starts polling with the new token', async () => {
  const oldStart = followers.startTwitch(config('old-secret'), () => {})
  const oldRequest = pending.shift()
  const newStart = followers.startTwitch(config('new-secret'), () => {})
  const newRequest = pending.shift()
  assert.equal(followers.getTwitchState().running, true)
  assert.equal(newRequest.options.headers.Authorization, 'Bearer new-secret')

  oldRequest.resolve({ data: { data: [{ id: 'old-channel' }] } })
  await oldStart
  assert.equal(pending.length, 0)

  newRequest.resolve({ data: { data: [{ id: 'new-channel' }] } })
  // Allow resolveBroadcasterId to schedule the follow-up followers request.
  await new Promise(resolve => setImmediate(resolve))
  const countRequest = pending.shift()
  assert.ok(countRequest)
  assert.equal(countRequest.options.headers.Authorization, 'Bearer new-secret')
  assert.equal(countRequest.options.params.broadcaster_id, 'new-channel')
  countRequest.resolve({ data: { total: 54 } })
  await newStart
  assert.equal(followers.getTwitchState().followers, 54)
  assert.equal(followers.getTwitchState().running, true)
  followers.stopTwitch()
  assert.equal(followers.getTwitchState().running, false)
  assert.equal(followers.getTwitchState().token, '')
})

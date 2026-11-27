'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFriendAlerts, normalizeConfig, instanceKey, COOLDOWN_MS } = require('../modules/vrchat/friends/friendAlerts')

const MY_LOC = 'wrld_4a65ba53-d8df-40a7-b67d-30c63bff0e95:07696~group(grp_f11e)~groupAccessType(public)~region(us)'

function setup (cfg, loc = MY_LOC) {
  let t = 1_000_000
  const sent = []
  const alerts = createFriendAlerts({ getConfig: () => cfg, getMyLocation: () => loc, notify: a => sent.push(a), now: () => t })
  return { alerts, sent, advance: ms => { t += ms } }
}

test('alerts when a watched friend (by name, any case) comes online', () => {
  const { alerts, sent } = setup({ enabled: true, friends: ['fumikoecho'] })
  alerts.handleFeed({ type: 'online', userId: 'usr_6e6b', name: 'FumikoEcho', platform: 'standalonewindows' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].title, 'FumikoEcho is online')
  assert.equal(sent[0].body, 'on PC')
})

test('matches by usr_ id so a renamed friend still alerts', () => {
  const { alerts, sent } = setup({ enabled: true, friends: ['usr_6e6b'] })
  alerts.handleFeed({ type: 'online', userId: 'usr_6e6b', name: 'BrandNewName' })
  assert.equal(sent.length, 1)
})

test('ignores friends not on the list, and does nothing while disabled', () => {
  const a = setup({ enabled: true, friends: ['Someone'] })
  a.alerts.handleFeed({ type: 'online', userId: 'usr_x', name: 'Other' })
  assert.equal(a.sent.length, 0)
  const b = setup({ enabled: false, friends: ['Other'] })
  b.alerts.handleFeed({ type: 'online', userId: 'usr_x', name: 'Other' })
  assert.equal(b.sent.length, 0)
})

test('alerts when a watched friend moves into my instance, not another one', () => {
  const { alerts, sent } = setup({ enabled: true, friends: ['FumikoEcho'] })
  alerts.handleFeed({ type: 'gps', userId: 'usr_6e6b', name: 'FumikoEcho', location: 'wrld_other:1~region(eu)', worldName: 'Elsewhere' })
  assert.equal(sent.length, 0)
  // same instance, tags reported differently
  alerts.handleFeed({ type: 'gps', userId: 'usr_6e6b', name: 'FumikoEcho', location: 'wrld_4a65ba53-d8df-40a7-b67d-30c63bff0e95:07696~region(us)', worldName: 'Drinking Night' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].kind, 'join')
  assert.match(sent[0].body, /Drinking Night/)
})

test('no "joining you" alert when I am not in a world', () => {
  const { alerts, sent } = setup({ enabled: true, friends: ['FumikoEcho'] }, '')
  alerts.handleFeed({ type: 'gps', userId: 'usr_6e6b', name: 'FumikoEcho', location: MY_LOC })
  assert.equal(sent.length, 0)
})

test('per-friend cooldown stops repeat alerts, then allows them again', () => {
  const { alerts, sent, advance } = setup({ enabled: true, friends: ['FumikoEcho'] })
  const e = { type: 'online', userId: 'usr_6e6b', name: 'FumikoEcho' }
  alerts.handleFeed(e); alerts.handleFeed(e)
  assert.equal(sent.length, 1)
  advance(COOLDOWN_MS + 1)
  alerts.handleFeed(e)
  assert.equal(sent.length, 2)
})

test('respects the online / join toggles', () => {
  const { alerts, sent } = setup({ enabled: true, friends: ['F'], online: false, joinInstance: false })
  alerts.handleFeed({ type: 'online', name: 'F' })
  alerts.handleFeed({ type: 'gps', name: 'F', location: MY_LOC })
  assert.equal(sent.length, 0)
})

test('config accepts a comma/newline string and de-duplicates', () => {
  assert.deepEqual(normalizeConfig({ friends: 'A, B\nA\n\n' }).friends, ['A', 'B'])
  assert.equal(instanceKey('wrld_a:123~x(y)'), 'wrld_a:123')
  assert.equal(instanceKey('private'), '')
})

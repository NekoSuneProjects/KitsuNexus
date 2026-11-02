'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
test('log tail suppresses historical replay and delivers new join, avatar and leave events together', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsu-log-tail-'))
  try {
    const logs = path.join(home, 'AppData', 'LocalLow', 'VRChat', 'VRChat'); fs.mkdirSync(logs, { recursive: true })
    const file = path.join(logs, 'output_log_test.txt')
    fs.writeFileSync(file, '[Behaviour] OnPlayerJoined Historical (usr_old)\n')
    let poll
    const context = { module: { exports: {} }, Buffer, Date, console, setInterval: fn => { poll = fn; return 1 }, clearInterval () {}, require: name => name === 'os' ? { homedir: () => home } : name === './activityEvents' ? require('../modules/vrchat/world/activityEvents') : require(name) }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules/vrchat/world/vrchatWorld.js'), 'utf8'), context)
    const updates = []; context.module.exports.startVrcWorld(value => updates.push(value))
    assert.equal(updates.at(-1).activityEvents.length, 0)
    const baseline = updates.at(-1).activitySequence
    fs.appendFileSync(file, '[Behaviour] OnPlayerJoined New Player (usr_new)\n[Behaviour] Switching New Player to avatar New Avatar\n[Behaviour] OnPlayerLeft New Player (usr_new)\n')
    poll()
    assert.equal(updates.at(-1).activitySequence, baseline + 3)
    assert.deepEqual(Array.from(updates.at(-1).activityEvents, e => e.kind), ['join', 'avatar', 'leave'])
    assert.equal(updates.at(-1).players.includes('New Player'), false)
    context.module.exports.stopVrcWorld()
  } finally { fs.rmSync(home, { recursive: true, force: true }) }
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { mergeSidebarOrder } = require('../modules/ui/sidebarOrder')

test('new buttons go after their default neighbour, not to the bottom of the sidebar', () => {
  const defaults = ['home', 'avatars', 'history', 'feed', 'ai', 'tonref', 'tools', 'oscapps', 'facetracking', 'audio', 'about']
  const saved = ['home', 'history', 'avatars', 'ai', 'tonref', 'tools', 'oscapps', 'audio', 'about'] // older save: no feed / facetracking
  assert.deepEqual(mergeSidebarOrder(saved, defaults),
    // feed follows its default neighbour (history), wherever the user moved it
    ['home', 'history', 'feed', 'avatars', 'ai', 'tonref', 'tools', 'oscapps', 'facetracking', 'audio', 'about'])
})

test('buttons that no longer exist are dropped; a complete order is unchanged', () => {
  assert.deepEqual(mergeSidebarOrder(['a', 'gone', 'b'], ['a', 'b']), ['a', 'b'])
  assert.deepEqual(mergeSidebarOrder(['b', 'a'], ['a', 'b']), ['b', 'a'])
  assert.deepEqual(mergeSidebarOrder([], ['a', 'b']), ['a', 'b'])
  assert.deepEqual(mergeSidebarOrder(['b'], ['a', 'b']), ['a', 'b'], 'a new first button stays first')
})

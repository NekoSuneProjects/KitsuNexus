'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { searchUrl, DEFAULT_SEARCH_ENDPOINT } = require('../modules/ai/webSearch')

test('default endpoint is NekoSune Search /api/search', () => {
  assert.equal(searchUrl(DEFAULT_SEARCH_ENDPOINT), 'https://search.nekosunevr.co.uk/api/search')
})

test('bare SearXNG instance URLs still get /search appended', () => {
  assert.equal(searchUrl('https://searx.example.org/'), 'https://searx.example.org/search')
  assert.equal(searchUrl('https://example.org/searx'), 'https://example.org/searx/search')
})

test('a pasted full example URL keeps its path and drops its query', () => {
  assert.equal(searchUrl('https://search.nekosunevr.co.uk/api/search?format=json&q=NekoSuneVR'), 'https://search.nekosunevr.co.uk/api/search')
  assert.equal(searchUrl('https://searx.example.org/search/'), 'https://searx.example.org/search')
})

test('junk endpoints are rejected', () => {
  assert.equal(searchUrl(''), '')
  assert.equal(searchUrl('not a url'), '')
})

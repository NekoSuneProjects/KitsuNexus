'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

function createArtworkLookup (reply) {
  const source = fs.readFileSync(path.join(__dirname, '../modules/media/artworkLookup.js'), 'utf8')
  const module = { exports: {} }
  const sandbox = {
    module,
    Buffer,
    Date,
    URL,
    URLSearchParams,
    require (id) {
      if (id === '../../package.json') return require('../package.json')
      assert.equal(id, 'https')
      return {
        get (url, _opts, callback) {
          const req = new EventEmitter()
          req.setTimeout = () => {}
          req.destroy = () => {}
          process.nextTick(() => {
            const res = new EventEmitter()
            res.statusCode = 200
            res.headers = {}
            res.setEncoding = () => {}
            res.destroy = () => {}
            callback(res)
            res.emit('data', reply(url))
            res.emit('end')
          })
          return req
        }
      }
    }
  }
  vm.runInNewContext(source, sandbox, { filename: 'artworkLookup.js' })
  return module.exports.lookupArtwork
}

test('unrelated search results cannot replace a track with the wrong cover', async () => {
  const lookup = createArtworkLookup(url => JSON.stringify(url.includes('deezer')
    ? { data: [{ title: 'Unrelated', artist: { name: 'Someone' }, album: { cover_xl: 'https://example.com/wrong.jpg' } }] }
    : { results: [{ trackName: 'Wrong track', artistName: 'Wrong artist', artworkUrl100: 'https://example.com/also-wrong.jpg' }] }))
  assert.equal(await lookup({ artist: 'Queen', title: 'Another One Bites The Dust' }), null)
})

test('oversized responses are discarded and the next provider can still return artwork', async () => {
  const lookup = createArtworkLookup(url => url.includes('deezer') ? 'x'.repeat(1024 * 1024 + 1) :
    JSON.stringify({ results: [{ trackName: 'Song', artistName: 'Artist', artworkUrl100: 'https://is1-ssl.mzstatic.com/cover.jpg' }] }))
  const result = await lookup({ artist: 'Artist', title: 'Song' })
  assert.equal(result?.image, 'https://is1-ssl.mzstatic.com/cover.jpg')
})

test('remote artwork cannot use local files, arbitrary hosts or non-HTTPS schemes', async () => {
  const lookup = createArtworkLookup(url => JSON.stringify(url.includes('deezer')
    ? { data: [{ title: 'Song', artist: { name: 'Artist' }, album: { cover_xl: 'http://127.0.0.1/private' } }] }
    : { results: [{ trackName: 'Song', artistName: 'Artist', artworkUrl100: 'https://attacker.example/cover.jpg' }] }))
  assert.equal(await lookup({ artist: 'Artist', title: 'Song' }), null)
})

test('provides duration only for an exact catalog track title', async () => {
  const lookup = createArtworkLookup(url => JSON.stringify(url.includes('deezer')
    ? { data: [{ title: 'Song (Remix)', duration: 350, artist: { name: 'Artist' },
      album: { cover_xl: 'https://cdn.dzcdn.net/art.jpg' } }] }
    : { results: [{ trackName: 'Song', artistName: 'Artist', trackTimeMillis: 193000,
      artworkUrl100: 'https://is1-ssl.mzstatic.com/cover.jpg' }] }))
  const media = await lookup({ artist: 'Artist', title: 'Song' })
  assert.equal(media?.durationMs, 0) // Do not borrow the remix duration.

  const exact = createArtworkLookup(url => JSON.stringify(url.includes('deezer')
    ? { data: [{ title: 'Song', duration: 193, artist: { name: 'Artist' },
      album: { cover_xl: 'https://cdn.dzcdn.net/art.jpg' } }] }
    : { results: [] }))
  assert.equal((await exact({ artist: 'Artist', title: 'Song' }))?.durationMs, 193000)
})

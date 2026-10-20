'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const routes = require('../src/routes/desktop')
const config = require('../src/config')

async function withServer (run) {
  const app = express()
  app.use(routes)
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const get = path => new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path }, response => {
      let text = ''
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }))
    }).on('error', reject)
  })
  try { await run(get) } finally { await new Promise(resolve => server.close(resolve)) }
}

test('desktop endpoints expose only public config and cached release metadata', async () => {
  const original = global.fetch
  const originalAppId = config.discordRichPresenceAppId
  config.discordRichPresenceAppId = '1234567890123456789'
  let upstreamCalls = 0
  global.fetch = async url => {
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/NekoSuneProjects\/KitsuNexus\/releases\/latest$/)
    upstreamCalls++
    return { ok: true, json: async () => ({
      tag_name: 'v2.0.0', body: 'Release notes', html_url: 'https://github.com/NekoSuneProjects/KitsuNexus/releases/tag/v2.0.0',
      assets: [{ name: 'KitsuNexus-Setup-2.0.0-x64.exe', browser_download_url: 'https://github.com/NekoSuneProjects/KitsuNexus/releases/download/v2.0.0/KitsuNexus-Setup-2.0.0-x64.exe', size: 123 }]
    }) }
  }
  try {
    await withServer(async get => {
      const settings = await get('/api/desktop/config')
      assert.equal(settings.status, 200)
      assert.equal(settings.data.discordAppId, '1234567890123456789')
      assert.deepEqual(Object.keys(settings.data).sort(), ['discordAppId', 'ok'])
      const first = await get('/api/desktop/updates/latest')
      const second = await get('/api/desktop/updates/latest')
      assert.equal(first.status, 200)
      assert.deepEqual(first.data, second.data)
      assert.equal(first.data.release.tag_name, 'v2.0.0')
      assert.equal(upstreamCalls, 1)
    })
  } finally {
    global.fetch = original
    config.discordRichPresenceAppId = originalAppId
  }
})

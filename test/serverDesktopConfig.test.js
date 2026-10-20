'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { desktopEndpoint, getDiscordAppId, FALLBACK_DISCORD_APP_ID } = require('../modules/integrations/maintenance/serverConfig')
const updater = require('../modules/integrations/maintenance/updater')

const officialAsset = 'https://github.com/NekoSuneProjects/KitsuNexus/releases/download/v2.0.0/KitsuNexus-Setup-2.0.0-x64.exe'
const release = {
  tag_name: 'v2.0.0',
  body: 'Release notes',
  html_url: 'https://github.com/NekoSuneProjects/KitsuNexus/releases/tag/v2.0.0',
  assets: [{ name: 'KitsuNexus-Setup-2.0.0-x64.exe', browser_download_url: officialAsset, digest: 'sha256:' + 'a'.repeat(64), size: 123 }]
}

test('desktop config uses the selected server but rejects invalid Discord IDs', async () => {
  assert.equal(desktopEndpoint('https://kitsunexus.example/', '/api/desktop/config'), 'https://kitsunexus.example/api/desktop/config')
  assert.throws(() => desktopEndpoint('ftp://invalid.example', '/api/desktop/config'))
  const ok = { get: async url => {
    assert.equal(url, 'https://kitsunexus.example/api/desktop/config')
    return { data: { ok: true, discordAppId: '1234567890123456789' } }
  } }
  assert.equal(await getDiscordAppId('https://kitsunexus.example/', ok), '1234567890123456789')
  const bad = { get: async () => ({ data: { ok: true, discordAppId: 'not-a-discord-id' } }) }
  assert.equal(await getDiscordAppId('https://kitsunexus.example/', bad), FALLBACK_DISCORD_APP_ID)
  const offline = { get: async () => { throw new Error('offline') } }
  assert.equal(await getDiscordAppId('https://kitsunexus.example/', offline), FALLBACK_DISCORD_APP_ID)
})

test('update checks use the KitsuNexus server before GitHub', async () => {
  const calls = []
  const fake = { get: async url => {
    calls.push(url)
    assert.match(url, /\/api\/desktop\/updates\/latest$/)
    return { data: { ok: true, release } }
  } }
  const result = await updater.check('1.0.80', 'https://kitsunexus.example', fake)
  assert.deepEqual(calls, ['https://kitsunexus.example/api/desktop/updates/latest'])
  assert.equal(result.ok, true)
  assert.equal(result.available, true)
  assert.equal(result.updateAssetUrl, process.platform === 'win32' ? officialAsset : null)
  assert.equal(result.latest, '2.0.0')
})

test('outdated server API falls back to official GitHub releases', async () => {
  const calls = []
  const fake = { get: async url => {
    calls.push(url)
    if (url.includes('/api/desktop/updates/latest')) throw new Error('404')
    return { data: release }
  } }
  const result = await updater.check('2.0.0', 'https://kitsunexus.example', fake)
  assert.equal(calls.length, 2)
  assert.match(calls[1], /^https:\/\/api\.github\.com\/repos\/NekoSuneProjects\/KitsuNexus\/releases\/latest$/)
  assert.equal(result.available, false)
})

test('server metadata cannot provide a non-GitHub installer URL', async () => {
  const fake = { get: async () => ({ data: { ok: true, release: {
    ...release, html_url: 'https://unsafe.example/install',
    assets: [{ ...release.assets[0], browser_download_url: 'https://unsafe.example/file.exe' }]
  } } }) }
  const result = await updater.check('1.0.80', 'https://kitsunexus.example', fake)
  if (process.platform === 'win32') {
    assert.equal(result.ok, false)
    assert.match(result.error, /official/)
  } else {
    assert.equal(result.url, updater.RELEASES_PAGE)
    assert.equal(result.installerUrl, updater.RELEASES_PAGE)
  }
})

'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { avatarUrls, bannerUrls, loadProfileImages } = require('../modules/ui/profileImages')

const cdn = name => `https://files.vrchat.cloud/${name}.png`

test('friend icon, thumbnail, banner and VRChat Plus override retain expected priorities', () => {
  assert.deepEqual(avatarUrls({ iconUrl: cdn('icon') }), [cdn('icon')])
  assert.deepEqual(avatarUrls({ currentAvatarThumbnailImageUrl: cdn('thumb') }), [cdn('thumb')])
  assert.deepEqual(bannerUrls({ currentAvatarImageUrl: cdn('banner') }), [cdn('banner')])
  assert.equal(bannerUrls({ tags: ['system_supporter'], profilePicOverride: cdn('custom'), currentAvatarImageUrl: cdn('banner') })[0], cdn('custom'))
  assert.equal(bannerUrls({ currentAvatarImageUrl: cdn('banner'), profilePicOverride: cdn('custom') })[0], cdn('banner'))
  assert.deepEqual(avatarUrls({ userIcon: 'javascript:alert(1)', iconUrl: cdn('valid') }), [cdn('valid')])
  assert.deepEqual(bannerUrls({}), [])
})

test('failed friend thumbnail and banner fall back, while stale profiles cannot replace current imagery', () => {
  const probes = []
  class Probe {
    constructor () { probes.push(this) }
    set src (url) { this.url = url }
  }
  const avatar = { src: '', onerror: null }
  const banner = { style: { backgroundImage: 'old' } }
  const user = {
    userIcon: cdn('broken-icon'),
    iconUrl: cdn('good-icon'),
    currentAvatarImageUrl: cdn('broken-banner'),
    currentAvatarThumbnailImageUrl: cdn('good-thumb')
  }
  let active = true
  const cleanup = loadProfileImages(user, { avatar, banner, ImageClass: Probe, isCurrent: () => active })
  assert.equal(avatar.src, cdn('broken-icon'))
  assert.equal(probes[0].url, cdn('broken-banner'))
  avatar.onerror()
  assert.equal(avatar.src, cdn('good-icon'))
  probes[0].onerror()
  assert.equal(probes[1].url, cdn('good-thumb'))
  probes[1].onload()
  assert.match(banner.style.backgroundImage, /good-thumb/)
  active = false
  cleanup()
  assert.equal(probes[1].onload, null)
  assert.equal(avatar.onerror, null)
})

test('profiles with no usable images receive the bundled logo and seasonal banner fallback', () => {
  const avatar = { src: '', onerror: null }
  const banner = { style: { backgroundImage: 'old' } }
  loadProfileImages({}, { avatar, banner, ImageClass: class {} })
  assert.equal(avatar.src, 'assets/logo.png')
  assert.equal(banner.style.backgroundImage, '')
})

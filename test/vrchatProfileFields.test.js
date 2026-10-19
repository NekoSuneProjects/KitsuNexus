'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')

test('VRChat friend profile keeps public image fields and cannot overwrite logged-in identity', async () => {
  const corePath = require.resolve('../modules/vrchat/api/vrchatClient')
  const apiPath = require.resolve('../modules/vrchat/api/vrchatApi')
  const prior = require.cache[corePath]
  const previousApi = require.cache[apiPath]
  let currentId = ''
  const me = { id: 'usr_self', displayName: 'Self', userIcon: 'https://example.test/self.png' }
  const friend = { id: 'usr_friend', displayName: 'Friend', status: 'active' }
  const publicFriend = {
    id: 'usr_friend', displayName: 'Friend', iconUrl: 'https://example.test/icon.png',
    profilePicOverride: 'https://example.test/custom.png',
    currentAvatarImageUrl: 'https://example.test/avatar.png',
    currentAvatarThumbnailImageUrl: 'https://example.test/thumb.png', hasVrcPlus: true
  }
  const core = {
    memo: (_key, _ttl, work) => work(),
    call: async name => {
      if (name === 'getCurrentUser') return { ok: true, data: me }
      if (name === 'getUser') return { ok: true, data: friend }
      if (name === 'getPublicProfile') return { ok: true, data: publicFriend }
      throw new Error(`Unexpected API call: ${name}`)
    },
    setLoggedIn: () => {}, setCurrentUserId: id => { currentId = id },
    getCurrentUserId: () => currentId,
    isLoggedIn: () => true, invalidate: () => {}, logout: () => {}
  }
  try {
    require.cache[corePath] = { id: corePath, filename: corePath, loaded: true, exports: core }
    delete require.cache[apiPath]
    const api = require(apiPath)
    const self = await api.fetchUser()
    assert.equal(self.user.userIcon, me.userIcon)
    assert.equal(currentId, 'usr_self')
    const viewed = await api.getUser('usr_friend')
    assert.equal(viewed.ok, true)
    assert.equal(viewed.user.iconUrl, publicFriend.iconUrl)
    assert.equal(viewed.user.profilePicOverride, publicFriend.profilePicOverride)
    assert.equal(viewed.user.currentAvatarImageUrl, publicFriend.currentAvatarImageUrl)
    assert.equal(viewed.user.currentAvatarThumbnailImageUrl, publicFriend.currentAvatarThumbnailImageUrl)
    assert.equal(viewed.user.hasVrcPlus, true)
    assert.equal(currentId, 'usr_self')
  } finally {
    if (prior) require.cache[corePath] = prior
    else delete require.cache[corePath]
    if (previousApi) require.cache[apiPath] = previousApi
    else delete require.cache[apiPath]
  }
})

'use strict'

const { safeHttpUrl } = require('../security/rendererContent')

function uniqueUrls (values) {
  return [...new Set(values.map(safeHttpUrl).filter(Boolean))]
}

function avatarUrls (user = {}) {
  return uniqueUrls([
    user.userIcon, user.iconUrl, user.profilePicOverride,
    user.currentAvatarThumbnailImageUrl, user.currentAvatarImageUrl
  ])
}

function bannerUrls (user = {}) {
  const isPlus = user.hasVrcPlus || (user.tags || []).includes('system_supporter')
  return uniqueUrls([
    ...(isPlus ? [user.profilePicOverride] : []),
    user.currentAvatarImageUrl, user.profilePicOverride,
    user.currentAvatarThumbnailImageUrl, user.userIcon, user.iconUrl
  ])
}

// Only apply a result while this particular profile request is still current.
// The next valid URL is tried when an image is missing, denied or expired.
function loadProfileImages (user, { avatar, banner, ImageClass = Image, isCurrent = () => true }) {
  let disposed = false
  const active = () => !disposed && isCurrent()
  const avas = avatarUrls(user)
  const banners = bannerUrls(user)
  const pending = []

  avatar.onerror = null
  avatar.src = 'assets/logo.png'
  banner.style.backgroundImage = ''

  function tryAvatar (index) {
    if (!active()) return
    if (index >= avas.length) { avatar.onerror = null; avatar.src = 'assets/logo.png'; return }
    avatar.onerror = () => tryAvatar(index + 1)
    avatar.src = avas[index]
  }

  function tryBanner (index) {
    if (!active() || index >= banners.length) return
    const src = banners[index]
    const probe = new ImageClass()
    pending.push(probe)
    probe.onload = () => {
      if (active()) banner.style.backgroundImage = `linear-gradient(0deg, rgba(18,7,21,.22), transparent 65%), url(${JSON.stringify(src)})`
    }
    probe.onerror = () => { if (active()) tryBanner(index + 1) }
    probe.src = src
  }

  tryAvatar(0)
  tryBanner(0)
  return () => {
    disposed = true
    avatar.onerror = null
    for (const probe of pending) { probe.onload = null; probe.onerror = null }
  }
}

module.exports = { avatarUrls, bannerUrls, loadProfileImages }

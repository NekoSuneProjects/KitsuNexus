'use strict'

const crypto = require('node:crypto')
const config = require('../config')
const session = require('./session')

// A session-bound CSRF token prevents a third-party form from unlinking Twitch.
function createUnlinkToken (req) {
  const cookie = req.cookies?.[session.COOKIE_NAME]
  if (!cookie || !req.user?.id) return ''
  return crypto.createHmac('sha256', config.jwtSecret)
    .update(`twitch-unlink:${req.user.id}:${cookie}`).digest('hex')
}

function verifyUnlinkToken (req) {
  const supplied = req.body?._twitchCsrf
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false
  const expected = createUnlinkToken(req)
  return !!expected && crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
}

module.exports = { createUnlinkToken, verifyUnlinkToken }

require('dotenv').config()
const crypto = require('crypto')

if (!process.env.JWT_SECRET) {
  console.warn('[config] JWT_SECRET not set in .env — using a random one-off secret. ' +
    'Every restart will invalidate existing sessions. Set JWT_SECRET before deploying for real.')
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 8080,
  siteUrl: process.env.SITE_URL || 'http://localhost:8080',
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
}

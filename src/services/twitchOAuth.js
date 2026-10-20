'use strict'

const crypto = require('node:crypto')
const config = require('../config')
const { TwitchLink } = require('../db')

const inflightRefresh = new Map()
const hasConfig = () => !!(config.twitchClientId && config.twitchClientSecret && config.twitchTokenKey)

function cipherKey () {
  if (!config.twitchTokenKey) throw new Error('TWITCH_TOKEN_KEY is missing')
  return crypto.createHash('sha256').update(`kitsunexus-twitch-v1:${config.twitchTokenKey}`).digest()
}

function encrypt (plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv)
  const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), payload].map(b => b.toString('base64url')).join('.')
}

function decrypt (sealed) {
  const parts = String(sealed || '').split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted Twitch token')
  const [iv, tag, payload] = parts.map(p => Buffer.from(p, 'base64url'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8')
}

async function tokenRequest (params) {
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret, ...params }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Twitch token exchange failed (${response.status})`)
  return response.json()
}

async function authorizedUser (accessToken) {
  const response = await fetch('https://api.twitch.tv/helix/users', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': config.twitchClientId },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Twitch identity lookup failed (${response.status})`)
  const data = await response.json()
  const user = data.data?.[0]
  if (!user?.id || !user?.login) throw new Error('Twitch did not return an account')
  return user
}

async function linkCode (userId, code) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.twitchRedirectUri })
  if (!tokens.access_token || !tokens.refresh_token) throw new Error('Twitch did not return renewable credentials')
  const requiredScopes = config.twitchScopes.split(/\s+/).filter(Boolean)
  if (!Array.isArray(tokens.scope) || requiredScopes.some(scope => !tokens.scope.includes(scope))) {
    throw new Error('Twitch did not grant every required permission')
  }
  const identity = await authorizedUser(tokens.access_token)
  const existingOwner = await TwitchLink.findOne({ where: { twitchId: identity.id } })
  if (existingOwner && existingOwner.userId !== userId) return { ok: false, conflict: true }

  const values = {
    twitchId: identity.id,
    login: identity.login,
    displayName: identity.display_name || identity.login,
    scopes: (tokens.scope || []).join(' '),
    encryptedAccessToken: encrypt(tokens.access_token),
    encryptedRefreshToken: encrypt(tokens.refresh_token),
    expiresAt: new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000),
  }
  const linked = await TwitchLink.findOne({ where: { userId } })
  if (linked) await linked.update(values)
  else await TwitchLink.create({ userId, ...values })
  return { ok: true, login: identity.login }
}

async function credentials (userId) {
  const linked = await TwitchLink.findOne({ where: { userId } })
  if (!linked) return { ok: true, connected: false }

  if (new Date(linked.expiresAt).getTime() - Date.now() < 5 * 60_000) {
    // Serialize refresh for simultaneous devices; Twitch rotates refresh tokens.
    if (!inflightRefresh.has(userId)) {
      const pending = (async () => {
        const fresh = await TwitchLink.findOne({ where: { userId } })
        if (!fresh) return
        if (new Date(fresh.expiresAt).getTime() - Date.now() >= 5 * 60_000) return
        const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(fresh.encryptedRefreshToken) })
        if (!tokens.access_token) throw new Error('Twitch did not return a refreshed access token')
        // An OAuth relink or another refresh may replace the token while the
        // network request runs. Never overwrite newer credentials with that result.
        await TwitchLink.update({
          encryptedAccessToken: encrypt(tokens.access_token),
          encryptedRefreshToken: encrypt(tokens.refresh_token || decrypt(fresh.encryptedRefreshToken)),
          expiresAt: new Date(Date.now() + Math.max(0, Number(tokens.expires_in) || 0) * 1000),
          scopes: Array.isArray(tokens.scope) ? tokens.scope.join(' ') : fresh.scopes,
        }, { where: { id: fresh.id, encryptedRefreshToken: fresh.encryptedRefreshToken } })
      })().finally(() => inflightRefresh.delete(userId))
      inflightRefresh.set(userId, pending)
    }
    await inflightRefresh.get(userId)
  }
  const current = await TwitchLink.findOne({ where: { userId } })
  if (!current) return { ok: true, connected: false }
  return {
    ok: true, connected: true, login: current.login, displayName: current.displayName,
    clientId: config.twitchClientId,
    accessToken: decrypt(current.encryptedAccessToken),
    expiresAt: new Date(current.expiresAt).toISOString(),
  }
}

// Remove the link before making an external request. A callback that relinks
// Twitch while revocation is in flight must not be deleted by the old unlink.
// Compare the encrypted refresh token so a concurrent refresh or relink cannot
// cause us to delete a different authorization than the one we read.
async function unlink (userId) {
  let linked = null
  for (let attempt = 0; attempt < 5; attempt++) {
    linked = await TwitchLink.findOne({ where: { userId } })
    if (!linked) return { ok: true, connected: false }
    const removed = await TwitchLink.destroy({ where: {
      id: linked.id, userId, encryptedRefreshToken: linked.encryptedRefreshToken,
    } })
    if (removed) break
    if (attempt === 4) throw new Error('Twitch authorization changed during unlink. Please retry.')
  }
  if (linked && hasConfig()) {
    try {
      const response = await fetch('https://id.twitch.tv/oauth2/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.twitchClientId, token: decrypt(linked.encryptedAccessToken) }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok && response.status !== 400) console.warn('[twitchOAuth] revocation returned', response.status)
    } catch (err) {
      console.warn('[twitchOAuth] revocation unavailable:', err.message)
    }
  }
  return { ok: true, connected: false }
}

module.exports = { hasConfig, linkCode, credentials, unlink, encrypt, decrypt }

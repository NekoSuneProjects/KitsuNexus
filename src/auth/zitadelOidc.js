// Minimal OIDC (Authorization Code + PKCE) client for the self-hosted NekoSuneVR ZITADEL
// instance. Every deployment-specific detail (issuer, client id/secret, redirect URI, scopes)
// comes from config.js/env — see .env.example. Endpoint URLs themselves are always read from
// the discovery document at request time rather than hardcoded, since ZITADEL can change paths
// on upgrade.

const crypto = require('crypto')
const { createRemoteJWKSet, jwtVerify } = require('jose')
const config = require('../config')

let discoveryCache = null
let discoveryCachedAt = 0
const DISCOVERY_TTL_MS = 10 * 60 * 1000

async function discovery () {
  if (discoveryCache && Date.now() - discoveryCachedAt < DISCOVERY_TTL_MS) return discoveryCache
  const res = await fetch(`${config.zitadelEndpoint}/.well-known/openid-configuration`)
  if (!res.ok) throw new Error(`ZITADEL discovery document fetch failed: ${res.status}`)
  const doc = await res.json()
  if (doc.issuer !== config.zitadelEndpoint) {
    throw new Error(`ZITADEL issuer mismatch: configured ${config.zitadelEndpoint}, discovery says ${doc.issuer}`)
  }
  discoveryCache = doc
  discoveryCachedAt = Date.now()
  return doc
}

let jwks = null
let jwksForIssuer = null
async function getJwks () {
  const doc = await discovery()
  if (!jwks || jwksForIssuer !== doc.issuer) {
    jwks = createRemoteJWKSet(new URL(doc.jwks_uri))
    jwksForIssuer = doc.issuer
  }
  return jwks
}

function base64url (buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomState () { return base64url(crypto.randomBytes(24)) }
function generateCodeVerifier () { return base64url(crypto.randomBytes(48)) }
function codeChallengeFromVerifier (verifier) { return base64url(crypto.createHash('sha256').update(verifier).digest()) }

async function buildAuthorizeUrl ({ state, nonce, codeChallenge }) {
  const doc = await discovery()
  const url = new URL(doc.authorization_endpoint)
  url.searchParams.set('client_id', config.zitadelClientId)
  url.searchParams.set('redirect_uri', config.zitadelRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.zitadelScopes)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// Confidential app (client secret configured) authenticates via HTTP Basic; PKCE is sent
// regardless — it doesn't hurt a confidential client and protects public ones.
async function exchangeCode ({ code, codeVerifier }) {
  const doc = await discovery()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.zitadelClientId,
    code,
    redirect_uri: config.zitadelRedirectUri,
    code_verifier: codeVerifier,
  })
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (config.zitadelClientSecret) {
    headers.Authorization = 'Basic ' + Buffer.from(`${config.zitadelClientId}:${config.zitadelClientSecret}`).toString('base64')
  }
  const res = await fetch(doc.token_endpoint, { method: 'POST', headers, body })
  if (!res.ok) throw new Error(`ZITADEL token exchange failed: ${res.status} ${await res.text()}`)
  return res.json() // { access_token, id_token, refresh_token?, expires_in, token_type }
}

// Verifies signature (against the live JWKS, RS256) + iss/aud/exp, then checks nonce ourselves
// (jose doesn't have a dedicated nonce option). Never accept an unverified token.
async function verifyIdToken (idToken, { nonce }) {
  const doc = await discovery()
  const key = await getJwks()
  const { payload } = await jwtVerify(idToken, key, { issuer: doc.issuer, audience: config.zitadelClientId })
  if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch')
  return payload
}

async function fetchUserinfo (accessToken) {
  const doc = await discovery()
  const res = await fetch(doc.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`ZITADEL userinfo fetch failed: ${res.status}`)
  return res.json()
}

module.exports = {
  randomState, generateCodeVerifier, codeChallengeFromVerifier,
  buildAuthorizeUrl, exchangeCode, verifyIdToken, fetchUserinfo,
}

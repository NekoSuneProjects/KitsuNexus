const crypto = require('crypto')

function generateToken () {
  return crypto.randomBytes(32).toString('hex')
}

function hashToken (token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

// 6 chars, uppercase alphanumeric with visually-ambiguous characters (0/O, 1/I/L) removed —
// meant to be read off a screen and typed on another device.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generatePairingCode () {
  let code = ''
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return code
}

// Longer than a pairing code since it's clicked from a URL rather than typed — needs enough
// entropy that share links can't be feasibly guessed/enumerated by scanning /s/<code>.
const SHARE_CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
function generateShareCode () {
  let code = ''
  for (let i = 0; i < 10; i++) code += SHARE_CODE_ALPHABET[crypto.randomInt(SHARE_CODE_ALPHABET.length)]
  return code
}

// A user's overlayId is a long-lived, unguessable *credential* embedded in a public URL (unlike
// a share code, which is meant to be handed out on purpose) — 22 base62 chars (~131 bits) makes
// scanning for a valid one infeasible.
const OVERLAY_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function generateOverlayId () {
  let id = ''
  for (let i = 0; i < 22; i++) id += OVERLAY_ID_ALPHABET[crypto.randomInt(OVERLAY_ID_ALPHABET.length)]
  return id
}

module.exports = { generateToken, hashToken, generatePairingCode, generateShareCode, generateOverlayId }

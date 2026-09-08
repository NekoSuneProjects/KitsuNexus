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

module.exports = { generateToken, hashToken, generatePairingCode }

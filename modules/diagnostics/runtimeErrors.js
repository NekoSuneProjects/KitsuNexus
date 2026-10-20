'use strict'

const fs = require('fs')
const path = require('path')

const MAX_LOG_BYTES = 1024 * 1024

function safeDetails (value) {
  const raw = value instanceof Error ? (value.stack || value.message) : String(value ?? '')
  return raw
    // Runtime error messages sometimes contain URLs with authentication grants.
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[url]')
    .replace(/\b(Bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/\b(access_token|refresh_token|client_secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 3000)
}

function writeRuntimeError (dataDir, type, error) {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const file = path.join(dataDir, 'runtime-errors.log')
    if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG_BYTES) {
      fs.renameSync(file, `${file}.old`)
    }
    const kind = String(type || 'error').replace(/[^\w:-]/g, '').slice(0, 64)
    fs.appendFileSync(file, `${new Date().toISOString()} [${kind}] ${safeDetails(error)}\n`, 'utf8')
  } catch (_) { /* diagnostics must never cause another failure */ }
}

module.exports = { writeRuntimeError, safeDetails }

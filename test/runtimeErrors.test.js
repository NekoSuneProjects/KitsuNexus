'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { safeDetails, writeRuntimeError } = require('../modules/diagnostics/runtimeErrors')

test('runtime errors are saved, bounded and redact URLs and credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-errors-'))
  try {
    const file = path.join(dir, 'runtime-errors.log')
    writeRuntimeError(dir, 'renderer:error', 'Failed at https://example.com/?access_token=secret Bearer secret access_token=secret')
    const contents = fs.readFileSync(file, 'utf8')
    assert.match(contents, /\[renderer:error\]/)
    assert.match(contents, /\[url\]/)
    assert.doesNotMatch(contents, /secret|example\.com/)
    fs.writeFileSync(file, 'x'.repeat(1024 * 1024))
    writeRuntimeError(dir, 'uncaughtException', new Error('an error'))
    assert.ok(fs.existsSync(`${file}.old`))
    assert.match(fs.readFileSync(file, 'utf8'), /an error/)
    assert.ok(safeDetails('a'.repeat(10000)).length <= 3000)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

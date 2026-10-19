'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateUpdateUrl, validateUpdateName, validateUpdateDigest, validateWindowsCommandArgument } = require('../updater/updateSecurity')

const trusted = 'https://github.com/NekoSuneProjects/KitsuNexus/releases/download/v1.0.80/KitsuNexus-Setup-1.0.80-x64.exe'

test('updater accepts only official GitHub releases and controlled asset redirects', () => {
  assert.equal(validateUpdateUrl(trusted), trusted)
  assert.throws(() => validateUpdateUrl('https://example.com/fake.exe'), /official/)
  assert.throws(() => validateUpdateUrl('https://github.com.attacker.test/NekoSuneProjects/KitsuNexus/releases/download/x/a.exe'), /official/)
  assert.throws(() => validateUpdateUrl('https://github.com/OtherOrg/OtherRepo/releases/download/x/a.exe'), /official/)
  assert.throws(() => validateUpdateUrl('http://github.com/NekoSuneProjects/KitsuNexus/releases/download/x/a.exe'), /HTTPS/)
  assert.throws(() => validateUpdateUrl('https://user:pass@github.com/NekoSuneProjects/KitsuNexus/releases/download/x/a.exe'), /HTTPS/)
  assert.throws(() => validateUpdateUrl('https://release-assets.githubusercontent.com/asset'), /official/)
  assert.equal(validateUpdateUrl('https://release-assets.githubusercontent.com/asset?token=foo', true), 'https://release-assets.githubusercontent.com/asset?token=foo')
  assert.throws(() => validateUpdateUrl('https://evil.example/asset', true), /official/)
  assert.throws(() => validateUpdateUrl('file:///tmp/asset', true), /HTTPS/)
})

test('updater rejects traversal and unexpected installer file types', () => {
  assert.equal(validateUpdateName('KitsuNexus-Setup-1.0.80-x64.exe', 'win32'), 'KitsuNexus-Setup-1.0.80-x64.exe')
  assert.equal(validateUpdateName('KitsuNexus-1.0.80.AppImage', 'linux'), 'KitsuNexus-1.0.80.AppImage')
  for (const name of ['../../bad.exe', 'subdir\\bad.exe', 'bad..exe', 'evil.exe" --silent', 'evil.ps1', '/tmp/test.exe']) {
    assert.throws(() => validateUpdateName(name, 'win32'), /Invalid|Unsupported/, name)
  }
  assert.throws(() => validateUpdateName('update.exe', 'linux'), /Unsupported/)
})

test('updater accepts valid SHA-256 release digests and rejects invalid ones', () => {
  const bytes = 'ab'.repeat(32)
  assert.equal(validateUpdateDigest('sha256:' + bytes), bytes)
  assert.equal(validateUpdateDigest(''), '')
  assert.throws(() => validateUpdateDigest('md5:' + 'a'.repeat(32)), /digest/)
  assert.throws(() => validateUpdateDigest('sha256:abc'), /digest/)
})

test('Windows installer launch arguments cannot expand environment variables or shell operators', () => {
  assert.equal(validateWindowsCommandArgument('C:\\Program Files\\KitsuNexus\\Setup.exe'), 'C:\\Program Files\\KitsuNexus\\Setup.exe')
  for (const arg of ['C:\\Users\\%USERNAME%\\Setup.exe', 'C:\\A&whoami\\Setup.exe', 'C:\\A^B\\Setup.exe', '/D=C:\\Apps|cmd', '/D=C:\\dir!var!', 'C:\\x" malicious']) {
    assert.throws(() => validateWindowsCommandArgument(arg), /unsupported Windows command/, arg)
  }
})

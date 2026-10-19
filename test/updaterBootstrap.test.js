'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { ensureExternalUpdater, externalUpdaterPath, updaterSignalPaths, md5File, startUpdate } = require('../modules/integrations/maintenance/updater')

function workspace (run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-updater-test-'))
  try {
    const source = path.join(root, 'bundled.exe')
    const target = path.join(root, 'KitsuNexus-updater', 'Update.exe')
    return run({ source, target, root })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('installs, verifies and refreshes the updater by MD5 even with an unchanged version marker', () => {
  workspace(({ source, target }) => {
    fs.writeFileSync(source, 'updater version one')
    assert.equal(ensureExternalUpdater({ platform: 'win32', source, target }), target)
    assert.equal(md5File(source), md5File(target))

    // The old bootstrapper would incorrectly skip replacement here.
    fs.writeFileSync(`${target}.version`, '1.0.3\n')
    fs.writeFileSync(source, 'updater version two')
    assert.equal(ensureExternalUpdater({ platform: 'win32', source, target }), target)
    assert.equal(fs.readFileSync(target, 'utf8'), 'updater version two')

    fs.writeFileSync(target, 'corrupt updater')
    assert.equal(ensureExternalUpdater({ platform: 'win32', source, target }), target)
    assert.equal(md5File(target), md5File(source))
    assert.equal(ensureExternalUpdater({ platform: 'win32', source, target }), target)
  })
})

test('uses a verified staged helper if Windows has locked Update.exe', () => {
  workspace(({ source, target }) => {
    fs.writeFileSync(source, 'new updater contents')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'running old updater')
    const originalRename = fs.renameSync
    try {
      fs.renameSync = (from, to) => {
        if (from === target) {
          const err = new Error('File is in use')
          err.code = 'EPERM'
          throw err
        }
        return originalRename(from, to)
      }
      const staged = ensureExternalUpdater({ platform: 'win32', source, target })
      assert.notEqual(staged, target)
      assert.equal(md5File(staged), md5File(source))
      assert.equal(fs.readFileSync(target, 'utf8'), 'running old updater')
    } finally {
      fs.renameSync = originalRename
    }

    // Once the running updater exits, the next launch replaces Update.exe.
    assert.equal(ensureExternalUpdater({ platform: 'win32', source, target }), target)
    assert.equal(md5File(source), md5File(target))
  })
})

test('handshake paths are deterministic and token scoped', () => {
  workspace(({ root }) => {
    const paths = updaterSignalPaths('a'.repeat(32), root)
    assert.equal(paths.ready, path.join(root, `kitsunexus-updater-${'a'.repeat(32)}.ready`))
    assert.equal(paths.ack, path.join(root, `kitsunexus-updater-${'a'.repeat(32)}.ack`))
    assert.equal(updaterSignalPaths('../invalid', root), null)
    if (process.platform === 'win32') {
      assert.equal(externalUpdaterPath(), path.join(process.env.LOCALAPPDATA, 'KitsuNexus-updater', 'Update.exe'))
    }
  })
})

test('main app waits for the helper ready signal, writes acknowledgement, then quits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunexus-updater-handshake-'))
  const previousAppData = process.env.LOCALAPPDATA
  try {
    if (process.platform === 'win32') process.env.LOCALAPPDATA = root
    const updaterRoot = path.join(root, 'updater')
    fs.mkdirSync(updaterRoot, { recursive: true })
    const confirmed = path.join(root, 'received-ack.txt')
    fs.writeFileSync(path.join(updaterRoot, 'main.js'), `
      const fs = require('fs')
      const path = require('path')
      const payload = JSON.parse(process.env.KITSUNEXUS_UPDATE_PAYLOAD)
      const signal = path.join(payload.signalDir, 'kitsunexus-updater-' + payload.readyToken)
      fs.mkdirSync(payload.signalDir, { recursive: true })
      fs.writeFileSync(signal + '.ready', process.pid.toString())
      const interval = setInterval(() => {
        if (!fs.existsSync(signal + '.ack')) return
        fs.writeFileSync(${JSON.stringify(confirmed)}, fs.readFileSync(signal + '.ack', 'utf8'))
        fs.unlinkSync(signal + '.ready')
        fs.unlinkSync(signal + '.ack')
        clearInterval(interval)
      }, 20)
    `)

    let quitCalled = false
    const childPid = await startUpdate({
      url: 'https://github.com/NekoSuneProjects/KitsuNexus/releases/download/v1.0.80/KitsuNexus-Setup-1.0.80-x64.exe',
      name: 'test.exe',
      version: '1.0.0',
      appRootDir: root,
      isPackaged: false,
      execPath: path.join(root, 'KitsuNexus.exe'),
      pid: process.pid
    }, () => { quitCalled = true })
    assert.ok(childPid > 0)
    assert.equal(quitCalled, true)
    const deadline = Date.now() + 3000
    while (!fs.existsSync(confirmed) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.equal(fs.readFileSync(confirmed, 'utf8').trim(), String(process.pid))
  } finally {
    if (previousAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previousAppData
    fs.rmSync(root, { recursive: true, force: true })
  }
})

'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-shots-'))
require('../modules/vrchat/tools/vrcTools')
require.cache[require.resolve('../modules/vrchat/tools/vrcTools')].exports.resolvePhotosDir = () => dir
const sm = require('../modules/vrchat/tools/screenshotMetadata')

const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 } return ~c >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const itxt = (k, text) => chunk('iTXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, 'utf8')]))
function png ({ xmp, idats = 40 } = {}) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr)]
  if (xmp) parts.push(itxt('XML:com.adobe.xmp', xmp))
  const data = zlib.deflateSync(Buffer.alloc(4 * 13))
  for (let i = 0; i < idats; i++) parts.push(chunk('IDAT', i === 0 ? data : Buffer.alloc(0)))
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}
const XMP = '<x:xmpmeta><rdf:Description><xmp:Author>NekoSuneVR</xmp:Author><xmp:CreateDate>2026-11-26T21:25:26.1389270+00:00</xmp:CreateDate></rdf:Description><rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/"><vrc:WorldID>wrld_a0b6ef1c-871c-4b86-b735-5e18210e956f</vrc:WorldID><vrc:WorldDisplayName>Starlit &amp; Cabin</vrc:WorldDisplayName><vrc:AuthorID>usr_88e0</vrc:AuthorID></rdf:Description></x:xmpmeta>'

test('file names in all three VRChat layouts are parsed', () => {
  const a = sm.parseFileName('VRChat_2026-11-26_21-25-25.936_1920x1080_wrld_a0b6ef1c-871c-4b86-b735-5e18210e956f.png')
  assert.equal(a.width, 1920); assert.equal(a.worldId, 'wrld_a0b6ef1c-871c-4b86-b735-5e18210e956f')
  assert.equal(new Date(a.takenAt).getFullYear(), 2026)
  assert.ok(sm.parseFileName('VRChat_2022-07-23_12-34-19.635.png').takenAt)
  const c = sm.parseFileName('VRChat_1920x1080_2020-12-18_19-25-53.png')
  assert.equal(c.width, 1920); assert.equal(new Date(c.takenAt).getFullYear(), 2020)
})

test("reads VRChat's own XMP when there is no Description", () => {
  const f = path.join(dir, 'VRChat_2026-11-26_21-25-25.936_1920x1080.png')
  fs.writeFileSync(f, png({ xmp: XMP }))
  const m = sm.readMetadata(f)
  assert.equal(m.source, 'VRChat')
  assert.equal(m.world.name, 'Starlit & Cabin')
  assert.equal(m.world.id, 'wrld_a0b6ef1c-871c-4b86-b735-5e18210e956f')
  assert.equal(m.author.displayName, 'NekoSuneVR')
})

test('embedding adds a Description once, never overwrites an existing one', async () => {
  const f = path.join(dir, 'VRChat_2026-11-27_10-00-00.000_1920x1080.png')
  fs.writeFileSync(f, png({ xmp: XMP }))
  const written = await sm.embedForFile(f)
  assert.ok(written, 'first embed writes')
  assert.equal(sm.readMetadata(f).source, 'KitsuNexus')
  assert.equal(await sm.embedForFile(f), null, 'second pass leaves the file alone (no rewrite loop)')
  // a VRCX-tagged photo is never overwritten
  const v = path.join(dir, 'VRChat_2026-11-27_10-01-00.000_1920x1080.png')
  const base = png()
  const iend = base.length - 12
  fs.writeFileSync(v, Buffer.concat([base.subarray(0, iend), itxt('Description', JSON.stringify({ application: 'VRCX', world: { name: 'W', id: 'wrld_x' }, players: [{ id: 'usr_1', displayName: 'Pal' }] })), base.subarray(iend)]))
  assert.equal(await sm.embedForFile(v), null)
  const m = sm.readMetadata(v)
  assert.equal(m.source, 'VRCX'); assert.deepEqual(m.players.map(p => p.displayName), ['Pal'])
  assert.ok(!fs.existsSync(f + '.kntmp'))
})

test('a half-written PNG (no IEND yet) is reported as incomplete, not silently skipped', async () => {
  const f = path.join(dir, 'VRChat_2026-11-27_10-02-00.000_1920x1080.png')
  const full = png(); fs.writeFileSync(f, full.subarray(0, full.length - 12))
  await assert.rejects(() => sm.embedForFile(f), e => e.code === 'INCOMPLETE')
})

test('gallery lists newest first (from the file name) incl. month subfolders, and searches players', async () => {
  fs.mkdirSync(path.join(dir, '2026-11'), { recursive: true })
  fs.copyFileSync(path.join(dir, 'VRChat_2026-11-27_10-01-00.000_1920x1080.png'), path.join(dir, '2026-11', 'VRChat_2026-11-28_09-00-00.000_1920x1080.png'))
  const r = await sm.listScreenshots({ limit: 10 })
  assert.equal(r.items[0].name, 'VRChat_2026-11-28_09-00-00.000_1920x1080.png')
  assert.ok(r.total >= 4)
  const s = await sm.listScreenshots({ query: 'pal' })
  assert.equal(s.total, 2)
})

test('only files inside the photos folder are accepted for open/thumbnail', () => {
  assert.equal(sm.isInPhotosDir(path.join(dir, '2026-11', 'VRChat_2026-11-28_09-00-00.000_1920x1080.png')), true)
  assert.equal(sm.isInPhotosDir(path.join(dir, '..', 'VRChat_x.png')), false)
  assert.equal(sm.isInPhotosDir(path.join(dir, 'notes.txt')), false)
})

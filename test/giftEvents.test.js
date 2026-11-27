'use strict'
// VRC+ gift detection, built from real data (2026-11-26/27): the Hype Train
// notification lines from VRChat's log and the on-screen gift banner.
const test = require('node:test')
const assert = require('node:assert/strict')
const gifts = require('../modules/vrchat/world/giftEvents')
const { ActivityEvents } = require('../modules/vrchat/world/activityEvents')
const { OcrTranslateController } = require('../modules/integrations/osc/ocr/ocrTranslateModule')

const HYPE_LINE = '2026.11.26 21:51:06 Debug      -  Received Notification: <Notification from username:, sender user id: to usr_88e0a1ad-10a5-43ed-8155-7b7886bfb3f9 of type: hypetrain, id: not_6863032e-5e5e-4ccb-89b0-0eb8621fdbbc, created at: 11/26/2026 21:51:05 UTC, details: {{}}, type:hypetrain, m seen:False, message: "Claim your Frosty Ski Goggles + All Aboard Sticker +  from your inventory.">'

test('the real Hype Train notification becomes a gift activity event', () => {
  const a = new ActivityEvents()
  a.process(HYPE_LINE)
  const e = a.snapshot().pop()
  assert.equal(e.kind, 'gift')
  assert.equal(e.name, 'Hype Train')
  assert.equal(e.detail, 'Claim your Frosty Ski Goggles + All Aboard Sticker from your inventory.')
})

test('gift-mentioning noise in the log is ignored', () => {
  for (const l of [
    '2026.11.27 16:26:59 Debug      -  [API] Requesting Get hypetrain/wrld_3c231334:60816~region(use) {{}} retryCount: 2',
    '2026.11.26 09:43:46 Debug      -  [API] Requesting Get subscriptions?bulkGifts=true {{}} retryCount: 2',
    '2026.11.26 09:43:52 Debug      -  AnswerNotification for notification:<Notification from username:, sender user id:8JoV9XEdpo to  of type: localNotifs, id: 20070216, message: "Send Gifts, Earn Rewards!">',
    '2026.11.27 10:17:09 Debug      -  [API] ApiHypeTrainInstanceInfo:: '
  ]) assert.equal(gifts.parseGiftLogLine(l), null, l)
})

test('the on-screen gift banner names the gifter; the Hype Train HUD does not alert', () => {
  assert.deepEqual(gifts.describe(gifts.parseGiftScreenText('Sent From Space gifted VRC+ 1')), { name: 'Sent From Space', detail: 'Gifted VRC+ (1 gift)' })
  assert.deepEqual(gifts.describe(gifts.parseGiftScreenText('NekoSuneVR gifted VRC+ 5')), { name: 'NekoSuneVR', detail: 'Gifted VRC+ (5 gifts)' })
  assert.deepEqual(gifts.describe(gifts.parseGiftScreenText('NekoSuneVR gifted FumikoEcho VRC+')), { name: 'NekoSuneVR → FumikoEcho', detail: 'Gifted VRC+' })
  for (const t of ['2/15 VRC+ gifts', 'Lvl 1: 2 gifts of 5', 'Send VRC+ gifts to contribute', 'VRC+ HYPE TRAIN ACTIVE!', 'I got you a gift lol']) {
    assert.equal(gifts.parseGiftScreenText(t), null, t)
  }
})

test('OCR: a gift banner gets a 🎁 label over it on screen and alerts once', async () => {
  const alerts = []; let overlay = null
  const line = { text: 'Sent From Space gifted VRC+ 1', confidence: 90, bbox: { x0: 790, y0: 65, x1: 1160, y1: 95 }, words: 'Sent From Space gifted VRC+ 1'.split(' ').map((w, i) => ({ text: w, confidence: 90, bbox: { x0: 790 + i * 60, y0: 65, x1: 840 + i * 60, y1: 95 } })) }
  const c = new OcrTranslateController({ recognize: async () => ({ lines: [line] }), translate: async () => '', onOverlay: p => { overlay = p }, onGift: g => alerts.push(g) })
  c.configure({ textStyle: 'light' })
  const fake = { width: 1920, height: 1080, toDataURL: () => '' }
  await c.recognizeCanvas(fake, { vw: 1920, vh: 1080, sx: 0, sy: 0 })
  await c.recognizeCanvas(fake, { vw: 1920, vh: 1080, sx: 0, sy: 0 }) // banner still on screen next scan
  assert.equal(alerts.length, 1, 'one alert per gift')
  assert.equal(alerts[0].name, 'Sent From Space')
  assert.equal(overlay.labels.length, 1)
  assert.match(overlay.labels[0].text, /^🎁 Sent From Space - Gifted VRC\+ \(1 gift\)$/)
})

test('KitsuNexus\' own HUD gift card and the Hype Train reminder are never read as a new gift', () => {
  for (const t of ['Sent From Space Gifted VRC+ (1 gift)', 'Less than 90 seconds left! Send a VRC+ Gift to keep the train going']) {
    assert.equal(gifts.parseGiftScreenText(t), null, t)
  }
})

test('own windows (HUD) are mapped into frame pixels so OCR can blank them out', async () => {
  const overlay = require('../modules/vr/overlay/translateOverlay')
  const fakeWin = (b, visible = true, onTop = true) => ({ isDestroyed: () => false, isVisible: () => visible, isMinimized: () => false, isAlwaysOnTop: () => onTop, isFocused: () => false, getBounds: () => b })
  const electron = {
    screen: { getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) },
    // HUD (always on top) is masked; a hidden window and the main window sitting behind the game are not
    BrowserWindow: { getAllWindows: () => [fakeWin({ x: 1480, y: 50, width: 420, height: 180 }), fakeWin({ x: 0, y: 0, width: 50, height: 50 }, false), fakeWin({ x: 360, y: 145, width: 1200, height: 760 }, true, false)] }
  }
  overlay.setCaptureSource({ id: 'screen:1:0', display_id: '1' })
  // frame captured at half resolution: rects scale with it; hidden windows are skipped
  const rects = await overlay.ownWindowFrameRects(960, 540, electron)
  assert.deepEqual(rects, [{ x0: 740, y0: 25, x1: 950, y1: 115 }])
})

// Real lines from a live gift received on 2026-11-27.
const VRCPLUS_LINE = '2026.11.27 17:15:35 Debug      -  Received Notification: <Notification from username:Salsa Shark, sender user id:usr_8e426b07-5426-41b0-a6fb-6d1dcc35c252 to usr_88e0a1ad-10a5-43ed-8155-7b7886bfb3f9 of type: vrcplus, id: not_4b1febea-d126-4e4a-930a-a04f4ab84147, created at: 11/27/2026 17:15:33 UTC, details: {{VRCPlusGift=True}}, type:vrcplus, m seen:False, message: "Salsa Shark has gifted you 1 months of VRC+!">'
const BADGE_LINE = '2026.11.27 17:15:45 Debug      -  Received Notification: <Notification from username:, sender user id: to usr_88e0a1ad-10a5-43ed-8155-7b7886bfb3f9 of type: badge, id: not_139d1eb3-eff8-41a5-a28c-303e1f530a15, created at: 11/27/2026 17:15:35 UTC, details: {{}}, type:badge, m seen:False, message: "You\'ve received a new badge: Supporter - Supports VRChat through VRC+">'

test('a VRC+ gift you receive is read from the log with the gifter and months', () => {
  const g = gifts.parseGiftLogLine(VRCPLUS_LINE)
  assert.equal(g.kind, 'received')
  assert.equal(g.from, 'Salsa Shark')
  assert.equal(g.fromId, 'usr_8e426b07-5426-41b0-a6fb-6d1dcc35c252')
  assert.equal(g.months, 1)
  assert.deepEqual(gifts.describe(g), { name: 'Salsa Shark gifted you', detail: '1 month of VRC+' })
  const a = new ActivityEvents(); a.process(VRCPLUS_LINE)
  assert.deepEqual((({ kind, name, detail }) => ({ kind, name, detail }))(a.snapshot().pop()), { kind: 'gift', name: 'Salsa Shark gifted you', detail: '1 month of VRC+' })
})

test('new badges are read from the log; the subscription-details line is noise', () => {
  assert.deepEqual(gifts.describe(gifts.parseGiftLogLine(BADGE_LINE)), { name: 'New badge', detail: 'Supporter - Supports VRChat through VRC+' })
  assert.equal(gifts.parseGiftLogLine('2026.11.27 17:15:35 Debug      -  Get VRChat Subscription Details! Subscription Id:vrchatplus-1-gift-bundle-onemonth active:True desc:VRC+ Single Month Gift Bundle (1)'), null)
})

test('the "has gifted you" screen banner is labelled but not alerted twice (the log covers it)', async () => {
  assert.deepEqual(gifts.describe(gifts.parseGiftScreenText('Salsa Shark has gifted you 1 months of VRC+!')), { name: 'Salsa Shark gifted you', detail: '1 month of VRC+' })
  const alerts = []; let overlay = null
  const words = 'Salsa Shark has gifted you 1 months of VRC+!'.split(' ')
  const line = { text: words.join(' '), confidence: 90, bbox: { x0: 850, y0: 65, x1: 1120, y1: 120 }, words: words.map((w, i) => ({ text: w, confidence: 90, bbox: { x0: 850 + i * 30, y0: 65, x1: 875 + i * 30, y1: 120 } })) }
  const c = new OcrTranslateController({ recognize: async () => ({ lines: [line] }), translate: async () => '', onOverlay: p => { overlay = p }, onGift: g => alerts.push(g) })
  c.configure({ textStyle: 'light' })
  await c.recognizeCanvas({ width: 1920, height: 1080, toDataURL: () => '' }, { vw: 1920, vh: 1080, sx: 0, sy: 0 })
  assert.equal(alerts.length, 0)
  assert.match(overlay.labels[0].text, /^🎁 Salsa Shark gifted you - 1 month of VRC\+$/)
})

test('a row with the Hype Train counter and a gift banner is split into separate elements', async () => {
  // Shapes taken from a real screenshot: counter at the top-left, banner in the middle, same row.
  const w = (text, x0, x1) => ({ text, confidence: 90, bbox: { x0, y0: 70, x1, y1: 100 } })
  const row = [w('VRC+', 140, 200), w('gifts', 205, 275), w('Salsa', 855, 925), w('Shark', 932, 1010), w('has', 1017, 1060), w('gifted', 1067, 1118)]
  const line2 = [w('you', 851, 895), w('1', 902, 915), w('months', 922, 1010), w('of', 1017, 1040), w('VRC+!', 1047, 1120)].map(x => ({ ...x, bbox: { ...x.bbox, y0: 102, y1: 130 } }))
  const lines = [
    { text: row.map(x => x.text).join(' '), confidence: 90, bbox: { x0: 140, y0: 70, x1: 1118, y1: 100 }, words: row },
    { text: line2.map(x => x.text).join(' '), confidence: 90, bbox: { x0: 851, y0: 102, x1: 1120, y1: 130 }, words: line2 },
    { text: 'Lo) Salsa Shark gifted VRC+', confidence: 88, bbox: { x0: 782, y0: 168, x1: 1078, y1: 192 }, words: [w('Lo)', 782, 815), w('Salsa', 823, 890), w('Shark', 897, 965), w('gifted', 972, 1030), w('VRC+', 1037, 1078)].map(x => ({ ...x, bbox: { ...x.bbox, y0: 168, y1: 192 } })) }
  ]
  let overlay = null; const alerts = []
  const c = new OcrTranslateController({ recognize: async () => ({ lines }), translate: async () => '', onOverlay: p => { overlay = p }, onGift: g => alerts.push(g) })
  c.configure({ textStyle: 'light' })
  await c.recognizeCanvas({ width: 1920, height: 1080, toDataURL: () => '' }, { vw: 1920, vh: 1080, sx: 0, sy: 0 })
  assert.deepEqual(overlay.labels.map(l => l.text), ['🎁 Salsa Shark gifted you - 1 month of VRC+', '🎁 Salsa Shark - Gifted VRC+ (1 gift)'])
  assert.equal(overlay.labels[0].x0, 851, 'banner label not stretched over the counter')
  assert.deepEqual(alerts.map(a => a.name), ['Salsa Shark'], 'only the drop alerts; the gift to you comes from the log')
})

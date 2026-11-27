'use strict'

// modules/vrchat/world/giftEvents.js
// VRC+ gift (gift drop / Hype Train) detection, from VRChat's output log and
// from on-screen text read by OCR.
//
// Honest status: no published log format exists for gift events - VRCX's log
// parser has no gift handling, and the test logs (2026-11-26/27) contained no
// real gift, only API calls about your own purchases and a promo notification.
// So this matches gift-related lines broadly (minus known noise), pulls out
// "who gifted whom" when the line says it, and records each new kind of line
// to a samples file so the format can be pinned down after the first real gift.

// Log lines that mention gifts but aren't gift events.
const NOISE = [
  /\[API\]/, // API requests: your own purchases, subscriptions?bulkGifts, gift event world lists
  /winter_gift_event|bulkGifts|bulk\/gift/i,
  /AVProVideo|NewsModal|VP NewsModal/i,
  /Send Gifts, Earn Rewards/i, // promo notification
  /Get VRChat Subscription Details/i, // internal subscription check after receiving a gift
  /Remove notification from|AnswerNotification for notification/i
]

const clean = v => String(v || '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

// Who gifted whom, from a sentence. Returns { from, to, amount } (fields optional).
function parseGiftText (text) {
  const s = clean(text)
  let m
  // Gift to you (seen live 2026-11-27): "Salsa Shark has gifted you 1 months of VRC+!"
  if ((m = s.match(/^(.+?)\s+(?:has\s+)?gifted\s+you\s+(\d+)?\s*months?\s+of\s+VRC\s*\+/i))) return { from: clean(m[1]), to: 'you', months: m[2] ? Number(m[2]) : 1 }
  // VRChat's gift-drop banner (seen live 2026-11-27): "Sent From Space gifted VRC+ 🎁 1"
  // - a gift drop into the instance, the number is how many gifts.
  if ((m = s.match(/^(.+?)\s+gifted\s+VRC\s*\+\s*\W*\s*(\d+)?\s*\W*$/i))) return { from: clean(m[1]), amount: m[2] ? Number(m[2]) : 1, drop: true }
  // A recipient starting with "(" is KitsuNexus' own HUD card ("Gifted VRC+ (1 gift)")
  // being read back - never a name.
  if ((m = s.match(/(?:^|\]\s*)([^\]]+?) (?:has )?gifted (?:VRC\+ )?(?:to )?(.+?)(?: (?:VRC\+|a VRC\+ (?:subscription|gift)))?[.!]?$/i)) && !/^\(/.test(m[2].trim())) return { from: clean(m[1]), to: clean(m[2]) }
  if ((m = s.match(/(.+?) (?:received|got) (?:a )?(?:VRC\+ )?gift(?:ed VRC\+)? from (.+?)[.!]?$/i))) return { from: clean(m[2]), to: clean(m[1]) }
  if ((m = s.match(/(.+?) (?:dropped|is dropping|started) (?:a )?(\d+)?\s*(?:VRC\+ )?gift(?: drop)?s?/i))) return { from: clean(m[1]), amount: m[2] ? Number(m[2]) : undefined }
  return {}
}

// A VRChat log line -> gift event or null.
//
// The one gift-related event VRChat does log (seen in real logs, 2026-11-26):
// a Hype Train notification when the instance's train completes and you get
// the rewards, e.g.
//   Received Notification: <Notification from username:, sender user id: to usr_… of type: hypetrain,
//   id: not_…, created at: …, details: {{}}, type:hypetrain, m seen:False,
//   message: "Claim your Frosty Ski Goggles + All Aboard Sticker +  from your inventory.">
// Who gifted is not in the log. ("[API] Requesting Get hypetrain/<instance>"
// is just VRChat polling the train - on every world join - so it's ignored.)
// VRChat's "Received Notification: <Notification from username:X, sender user
// id:usr_…, to usr_… of type: T, …, details: {{…}}, type:T, m seen:…,
// message: "…">" line -> its fields.
function parseNotificationLine (s) {
  const m = s.match(/Received Notification: <Notification from username:(.*?), sender user id:\s*(\S*?)\s+to\s+\S*\s+of type: ([a-zA-Z_]+),/)
  if (!m) return null
  return {
    from: clean(m[1]),
    fromId: m[2] && /^usr_/.test(m[2]) ? m[2] : '',
    type: m[3],
    details: (s.match(/details: \{\{(.*?)\}\}/) || [])[1] || '',
    message: (s.match(/message: "([^"]*)"/) || [])[1] || ''
  }
}

// Real lines (2026-11-27), all logged when YOU are the recipient:
//   type: vrcplus, details: {{VRCPlusGift=True}}, message: "Salsa Shark has gifted you 1 months of VRC+!"
//   type: badge,   message: "You've received a new badge: Supporter - Supports VRChat through VRC+"
//   type: hypetrain, message: "Claim your Frosty Ski Goggles + All Aboard Sticker +  from your inventory."
// Gifts that other people receive (a gift drop) are only shown on screen.
function parseGiftLogLine (line) {
  const s = String(line || '')
  const n = /Received Notification:/.test(s) ? parseNotificationLine(s) : null
  if (n && n.type === 'vrcplus' && (/VRCPlusGift=True/i.test(n.details) || /gifted you/i.test(n.message))) {
    const months = Number((n.message.match(/(\d+)\s+months?/i) || [])[1]) || 0
    return { kind: 'received', from: n.from || clean(n.message.replace(/\s+has gifted you.*$/i, '')), fromId: n.fromId, to: 'you', months, message: clean(n.message), raw: '' }
  }
  if (n && n.type === 'badge') {
    return { kind: 'badge', message: clean(n.message.replace(/^You've received a new badge:\s*/i, '')), raw: '' }
  }
  if (!/gift|hype ?train/i.test(s)) return null
  if (/Received Notification:.*of type: hypetrain/i.test(s)) {
    const msg = (s.match(/message: "([^"]*)"/) || [])[1] || ''
    return { kind: 'hypetrain', message: clean(msg.replace(/\s*\+\s*(?=from your inventory)/i, ' ')), raw: '' }
  }
  if (NOISE.some(re => re.test(s))) return null
  const body = s.replace(/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}\s+\w+\s+-\s+/, '').trim()
  return { raw: body.slice(0, 300), ...parseGiftText(body.replace(/^\[[^\]]+\]\s*/, '')) }
}

// On-screen text (OCR) -> gift event or null. Needs gift wording, so ordinary
// chat mentioning "gift" in passing is less likely to trigger it.
//
// Only fires when a gifter's name is found: VRChat's Hype Train HUD ("2/15
// VRC+ gifts", "Lvl 1: 2 gifts of 5", "Send VRC+ gifts to contribute") changes
// with every gift and would otherwise spam alerts.
function parseGiftScreenText (text) {
  const s = clean(text)
  if (!/\bgift(?:ed|s| drop)?\b|VRC\s*\+/i.test(s)) return null
  const g = parseGiftText(s)
  return g.from ? { raw: s, ...g } : null
}

function describe (g) {
  if (g.kind === 'hypetrain') return { name: 'Hype Train', detail: g.message || 'Hype Train rewards unlocked' }
  if (g.kind === 'received') return { name: `${g.from || 'Someone'} gifted you`, detail: g.months ? `${g.months} month${g.months === 1 ? '' : 's'} of VRC+` : 'VRC+' }
  if (g.kind === 'badge') return { name: 'New badge', detail: g.message || 'You received a new badge' }
  if (g.to === 'you') return { name: `${g.from} gifted you`, detail: g.months ? `${g.months} month${g.months === 1 ? '' : 's'} of VRC+` : 'VRC+' }
  if (g.from && g.to) return { name: `${g.from} → ${g.to}`, detail: 'Gifted VRC+' }
  if (g.from && g.amount) return { name: g.from, detail: g.amount === 1 ? 'Gifted VRC+ (1 gift)' : `Gifted VRC+ (${g.amount} gifts)` }
  if (g.from) return { name: g.from, detail: 'VRC+ gift' }
  return { name: 'VRC+ gift', detail: g.raw }
}

module.exports = { parseGiftLogLine, parseGiftScreenText, parseGiftText, describe, NOISE }

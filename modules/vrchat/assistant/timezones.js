'use strict'

// Resolves a spoken place/timezone name to a real IANA timezone. The AI
// provider is usually good enough at this on its own (it's asked to return
// a proper IANA name directly - see assistantBrain.js), but smaller/local
// models (e.g. a small Ollama model) aren't always reliable at it, so this
// is a deterministic fallback covering the regions actually asked for:
// USA, Canada, the EU, and Asia. Not exhaustive - just the common named
// zones/cities within those regions.

const ALIASES = {
  // --- USA ---
  eastern: 'America/New_York',
  'eastern time': 'America/New_York',
  et: 'America/New_York',
  edt: 'America/New_York',
  est: 'America/New_York',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  boston: 'America/New_York',
  miami: 'America/New_York',
  atlanta: 'America/New_York',
  central: 'America/Chicago',
  'central time': 'America/Chicago',
  ct: 'America/Chicago',
  cdt: 'America/Chicago',
  cst: 'America/Chicago',
  chicago: 'America/Chicago',
  texas: 'America/Chicago',
  dallas: 'America/Chicago',
  houston: 'America/Chicago',
  mountain: 'America/Denver',
  'mountain time': 'America/Denver',
  mt: 'America/Denver',
  mdt: 'America/Denver',
  mst: 'America/Denver',
  denver: 'America/Denver',
  colorado: 'America/Denver',
  arizona: 'America/Phoenix',
  phoenix: 'America/Phoenix',
  pacific: 'America/Los_Angeles',
  'pacific time': 'America/Los_Angeles',
  pt: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  california: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  alaska: 'America/Anchorage',
  hawaii: 'Pacific/Honolulu',
  usa: 'America/New_York',
  'united states': 'America/New_York',
  america: 'America/New_York',

  // --- Canada ---
  canada: 'America/Toronto',
  toronto: 'America/Toronto',
  ontario: 'America/Toronto',
  montreal: 'America/Toronto',
  quebec: 'America/Toronto',
  ottawa: 'America/Toronto',
  vancouver: 'America/Vancouver',
  'british columbia': 'America/Vancouver',
  calgary: 'America/Edmonton',
  edmonton: 'America/Edmonton',
  alberta: 'America/Edmonton',
  winnipeg: 'America/Winnipeg',
  manitoba: 'America/Winnipeg',
  halifax: 'America/Halifax',
  'nova scotia': 'America/Halifax',
  newfoundland: 'America/St_Johns',
  'st johns': 'America/St_Johns',
  bc: 'America/Vancouver',
  victoria: 'America/Vancouver',
  saskatchewan: 'America/Regina',
  regina: 'America/Regina',
  saskatoon: 'America/Regina',
  yukon: 'America/Whitehorse',
  whitehorse: 'America/Whitehorse',
  yellowknife: 'America/Edmonton',
  'northwest territories': 'America/Edmonton',
  nwt: 'America/Edmonton',
  inuvik: 'America/Inuvik',
  'new brunswick': 'America/Moncton',
  'prince edward island': 'America/Halifax',
  pei: 'America/Halifax',

  // --- Caribbean ---
  cuba: 'America/Havana',
  havana: 'America/Havana',

  // --- EU / Europe ---
  eu: 'Europe/Paris',
  europe: 'Europe/Paris',
  cet: 'Europe/Paris',
  'central european time': 'Europe/Paris',
  uk: 'Europe/London',
  'united kingdom': 'Europe/London',
  britain: 'Europe/London',
  england: 'Europe/London',
  london: 'Europe/London',
  gmt: 'Europe/London',
  bst: 'Europe/London',
  ireland: 'Europe/Dublin',
  dublin: 'Europe/Dublin',
  france: 'Europe/Paris',
  paris: 'Europe/Paris',
  germany: 'Europe/Berlin',
  berlin: 'Europe/Berlin',
  spain: 'Europe/Madrid',
  madrid: 'Europe/Madrid',
  italy: 'Europe/Rome',
  rome: 'Europe/Rome',
  netherlands: 'Europe/Amsterdam',
  amsterdam: 'Europe/Amsterdam',
  belgium: 'Europe/Brussels',
  brussels: 'Europe/Brussels',
  portugal: 'Europe/Lisbon',
  lisbon: 'Europe/Lisbon',
  poland: 'Europe/Warsaw',
  warsaw: 'Europe/Warsaw',
  sweden: 'Europe/Stockholm',
  stockholm: 'Europe/Stockholm',
  norway: 'Europe/Oslo',
  oslo: 'Europe/Oslo',
  denmark: 'Europe/Copenhagen',
  copenhagen: 'Europe/Copenhagen',
  eet: 'Europe/Athens',
  'eastern european time': 'Europe/Athens',
  greece: 'Europe/Athens',
  athens: 'Europe/Athens',
  finland: 'Europe/Helsinki',
  helsinki: 'Europe/Helsinki',
  romania: 'Europe/Bucharest',
  bucharest: 'Europe/Bucharest',
  moscow: 'Europe/Moscow',
  russia: 'Europe/Moscow',

  // --- Asia ---
  japan: 'Asia/Tokyo',
  tokyo: 'Asia/Tokyo',
  jst: 'Asia/Tokyo',
  china: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  shanghai: 'Asia/Shanghai',
  india: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  korea: 'Asia/Seoul',
  'south korea': 'Asia/Seoul',
  seoul: 'Asia/Seoul',
  kst: 'Asia/Seoul',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  taiwan: 'Asia/Taipei',
  taipei: 'Asia/Taipei',
  dubai: 'Asia/Dubai',
  uae: 'Asia/Dubai',
  'united arab emirates': 'Asia/Dubai',
  thailand: 'Asia/Bangkok',
  bangkok: 'Asia/Bangkok',
  vietnam: 'Asia/Ho_Chi_Minh',
  hanoi: 'Asia/Ho_Chi_Minh',
  indonesia: 'Asia/Jakarta',
  jakarta: 'Asia/Jakarta',
  philippines: 'Asia/Manila',
  manila: 'Asia/Manila',
  malaysia: 'Asia/Kuala_Lumpur',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  pakistan: 'Asia/Karachi',
  karachi: 'Asia/Karachi',
  israel: 'Asia/Jerusalem',
  'tel aviv': 'Asia/Jerusalem',
  jerusalem: 'Asia/Jerusalem'
}

// A handful of names are too broad to guess a single zone for without
// asking - "Asia" alone spans Turkey to Japan, roughly a 9-hour range.
const AMBIGUOUS = new Set(['asia'])

function isValidIana (tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch (_) {
    return false
  }
}

// Returns { tz, ambiguous } - tz is null if nothing could be resolved,
// ambiguous is true if the name was recognized but too broad to pick a
// single zone for (caller should ask the user to be more specific).
function resolveTimezone (input) {
  const raw = String(input || '').trim()
  if (!raw) return { tz: null, ambiguous: false }
  if (isValidIana(raw)) return { tz: raw, ambiguous: false }

  const key = raw.toLowerCase().replace(/\btime\s*zone\b|\bzone\b|\btime\b/g, '').trim()
  if (AMBIGUOUS.has(key)) return { tz: null, ambiguous: true }
  if (ALIASES[key]) return { tz: ALIASES[key], ambiguous: false }
  return { tz: null, ambiguous: false }
}

module.exports = { resolveTimezone }

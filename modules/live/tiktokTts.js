// modules/live/tiktokTts.js
// TikTok TTS via community worker proxies (same ones TTS-Voice-Wizard uses).
// Text is passed as a proper JSON body so quotes/newlines can't break the
// request. Returns a Buffer of MP3 audio. Playback is done in the renderer
// with an <audio> element.
//
// These community proxies rotate/die often, so this tries a short list in
// order and falls back to the next on failure, instead of hardcoding one
// (the previous single gesserit.co endpoint going down was why this broke).
// Different proxies also return the base64 audio under different response
// field names (`data` vs `audio` vs `audioUrl`) - all three are checked.

const axios = require('axios')

// Checked 2026-11-27: the weilbyte service moved from tiktok-tts.weilnet.workers.dev
// (now a 307 redirect) to ottsy.weilbyte.dev, which works. The old
// printmechanical… worker now needs a TikTok session id (500) and gesserit.co is
// gone (404), so both were dropped. The old weilnet URL stays as a fallback.
const TTS_URLS = [
  'https://ottsy.weilbyte.dev/api/generation',
  'https://tiktok-tts.weilnet.workers.dev/api/generation'
]

// Every voice here was checked to return audio on 2026-11-27 (an unknown id is
// refused with "This voice is unavailable now").
const TIKTOK_VOICES = [
  { label: "English US - Female", apiName: "en_us_001" },
  { label: "English US - Female 2", apiName: "en_us_002" },
  { label: "English US - Male 1", apiName: "en_us_006" },
  { label: "English US - Male 2", apiName: "en_us_007" },
  { label: "English US - Male 3", apiName: "en_us_009" },
  { label: "English US - Male 4", apiName: "en_us_010" },
  { label: "English UK - Male 1", apiName: "en_uk_001" },
  { label: "English UK - Male 2", apiName: "en_uk_003" },
  { label: "English AU - Female", apiName: "en_au_001" },
  { label: "English AU - Male", apiName: "en_au_002" },
  { label: "Ghostface (Scream)", apiName: "en_us_ghostface" },
  { label: "Chewbacca", apiName: "en_us_chewbacca" },
  { label: "C-3PO", apiName: "en_us_c3po" },
  { label: "Stitch", apiName: "en_us_stitch" },
  { label: "Stormtrooper", apiName: "en_us_stormtrooper" },
  { label: "Rocket", apiName: "en_us_rocket" },
  { label: "Madame Leota", apiName: "en_female_madam_leota" },
  { label: "Ghost Host", apiName: "en_male_ghosthost" },
  { label: "Pirate", apiName: "en_male_pirate" },
  { label: "Mr. GoodGuy (Deadpool)", apiName: "en_male_deadpool" },
  { label: "Trickster (Grinch)", apiName: "en_male_grinch" },
  { label: "Magician", apiName: "en_male_wizard" },
  { label: "Author (Santa)", apiName: "en_male_santa_narration" },
  { label: "Grandma", apiName: "en_female_grandma" },
  { label: "Story Teller", apiName: "en_male_narration" },
  { label: "Wacky", apiName: "en_male_funny" },
  { label: "Peaceful", apiName: "en_female_emotional" },
  { label: "Serious", apiName: "en_male_cody" },
  { label: "Empathetic", apiName: "en_female_samc" },
  { label: "Game On", apiName: "en_male_jomboy" },
  { label: "Lord Cringe", apiName: "en_male_ukneighbor" },
  { label: "Mr. Meticulous", apiName: "en_male_ukbutler" },
  { label: "Debutante", apiName: "en_female_shenna" },
  { label: "Varsity", apiName: "en_female_pansino" },
  { label: "Marty", apiName: "en_male_trevor" },
  { label: "Bae", apiName: "en_female_betty" },
  { label: "Cupid", apiName: "en_male_cupid" },
  { label: "Beauty Guru", apiName: "en_female_richgirl" },
  { label: "Cupid (Christmas)", apiName: "en_male_m2_xhxs_m03_christmas" },
  { label: "Scream", apiName: "en_male_m2_xhxs_m03_silly" },
  { label: "Singing - Alto", apiName: "en_female_f08_salut_damour" },
  { label: "Singing - Tenor", apiName: "en_male_m03_lobby" },
  { label: "Singing - Sunshine Soon", apiName: "en_male_m03_sunshine_soon" },
  { label: "Singing - Warmy Breeze", apiName: "en_female_f08_warmy_breeze" },
  { label: "Singing - Glorious", apiName: "en_female_ht_f08_glorious" },
  { label: "Singing - It Goes Up", apiName: "en_male_sing_funny_it_goes_up" },
  { label: "Singing - Classical", apiName: "en_male_m03_classical" },
  { label: "Singing - Dramatic", apiName: "en_female_ht_f08_wonderful_world" },
  { label: "Singing - Twinkle", apiName: "en_female_f08_twinkle" },
  { label: "Singing - New Year", apiName: "en_female_ht_f08_newyear" },
  { label: "French - Male 1", apiName: "fr_001" },
  { label: "French - Male 2", apiName: "fr_002" },
  { label: "German - Female", apiName: "de_001" },
  { label: "German - Male", apiName: "de_002" },
  { label: "Spanish - Male", apiName: "es_002" },
  { label: "Spanish MX - Male", apiName: "es_mx_002" },
  { label: "Portuguese BR - Female 1", apiName: "br_001" },
  { label: "Portuguese BR - Female 2", apiName: "br_003" },
  { label: "Portuguese BR - Female 3", apiName: "br_004" },
  { label: "Portuguese BR - Male", apiName: "br_005" },
  { label: "Portuguese BR - Ivete Sangalo", apiName: "bp_female_ivete" },
  { label: "Portuguese BR - Ludmilla", apiName: "bp_female_ludmilla" },
  { label: "Portuguese - Lhays Macedo", apiName: "pt_female_lhays" },
  { label: "Portuguese - Laizza", apiName: "pt_female_laizza" },
  { label: "Indonesian - Female", apiName: "id_001" },
  { label: "Japanese - Female 1", apiName: "jp_001" },
  { label: "Japanese - Female 2", apiName: "jp_003" },
  { label: "Japanese - Female 3", apiName: "jp_005" },
  { label: "Japanese - Male", apiName: "jp_006" },
  { label: "Korean - Male 1", apiName: "kr_002" },
  { label: "Korean - Female", apiName: "kr_003" },
  { label: "Korean - Male 2", apiName: "kr_004" },
  { label: "Italian - Male", apiName: "it_male_m18" }
]

async function getTikTokTtsAudio (text, voice = 'en_us_001') {
  const clean = String(text || '').slice(0, 300)
  if (!clean.trim()) return null

  let lastErr = null
  for (const url of TTS_URLS) {
    try {
      // Sending an object lets axios JSON-encode it safely (no manual escaping).
      const res = await axios.post(
        url,
        { text: clean, voice },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
      )

      // Different proxies use different field names for the same thing.
      if (res.data && res.data.success === false) { lastErr = new Error(res.data.error || `TikTok TTS refused the request (${url})`); continue }
      let audio = res.data?.audioUrl ?? res.data?.data ?? res.data?.audio
      if (!audio) { lastErr = new Error(`No audio field in response from ${url}`); continue }

      const commaIndex = String(audio).indexOf(',')
      if (commaIndex >= 0) audio = String(audio).slice(commaIndex + 1)

      return Buffer.from(audio, 'base64')
    } catch (err) {
      lastErr = err
    }
  }

  console.error('TikTok TTS error (all proxies failed):', lastErr?.response?.status || lastErr?.message)
  return null
}

module.exports = {
  getTikTokTtsAudio,
  TIKTOK_VOICES
}

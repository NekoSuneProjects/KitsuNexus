'use strict'

// modules/ai/langDetect.js
// Small offline language guesser, so auto-translate (OCR, speech-to-text,
// overlay) can tell "this is already English" or "this is Spanish" without a
// network call. Free web translators rate-limit quickly (Google's free
// endpoint answered 429 after a short burst while testing), so this saves
// requests and gives MyMemory a source language.
//
// Non-Latin scripts are identified by their Unicode ranges; Latin-script
// languages by counting very common words. Returns { lang, confidence } where
// lang is an ISO 639-1 code ('' when unsure).

const SCRIPTS = [
  ['ja', /[぀-ヿ]/g], // hiragana / katakana -> Japanese (checked before Han)
  ['ko', /[가-힯ᄀ-ᇿ]/g],
  ['zh', /[一-鿿]/g],
  ['ru', /[Ѐ-ӿ]/g], // Cyrillic (Russian / Ukrainian / ...: refined below)
  ['ar', /[؀-ۿ]/g],
  ['he', /[֐-׿]/g],
  ['th', /[฀-๿]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['el', /[Ͱ-Ͽ]/g]
]

const WORDS = {
  en: 'the and you are is to of it that this for with have was not what my your i me we they he she do can will just so be at on in no yes hello hi thanks please',
  es: 'el la los las de que y en un una es por para con no se lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso hola gracias qué cómo estás bien',
  fr: 'le la les de des et en un une est que qui pas pour dans ce il elle sur avec ne se plus par je tu nous vous mais ou son sa au aux bonjour merci oui non très bien',
  de: 'der die das und ist nicht ich du er sie es wir ihr ein eine zu mit auf für von den dem im auch sich wie was wenn aber oder hallo danke ja nein bitte gut sehr',
  it: 'il lo la gli le di che e è un una per non con sono si mi ti ci ma come anche più ho hai ciao grazie sì bene molto questo quello',
  pt: 'o a os as de que e do da em um uma é não com para por se na no mais mas como eu você ele ela isso olá obrigado sim muito bem também',
  nl: 'de het een en van ik je is dat niet op te met voor zijn er maar wat ook als hoe hallo dank ja nee goed heel',
  pl: 'i w nie na to jest się z że do co jak ale tak czy jestem ty on ona my wy oni cześć dzięki dziękuję dobrze bardzo'
}
const WORD_SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(/\s+/))]))
// Letters that only (or mostly) appear in one language.
const HINTS = [['es', /[ñ¿¡]/], ['de', /ß/], ['pl', /[ąęłńśźż]/], ['pt', /[ãõ]/], ['fr', /[œ]|\b(c'est|j'ai|qu'il)\b/], ['nl', /\bij\b/]]

function detectLanguageLocal (text) {
  const s = String(text || '')
  const letters = (s.match(/\p{L}/gu) || []).length
  if (!letters) return { lang: '', confidence: 0 }

  for (const [lang, re] of SCRIPTS) {
    const n = (s.match(re) || []).length
    if (n / letters >= 0.3) {
      if (lang === 'ru' && /[іїєґ]/i.test(s)) return { lang: 'uk', confidence: 0.9 }
      return { lang, confidence: Math.min(1, n / letters + 0.2) }
    }
  }

  const words = s.toLowerCase().normalize('NFC').match(/[\p{L}']+/gu) || []
  if (!words.length) return { lang: '', confidence: 0 }
  const scores = {}
  for (const [lang, set] of Object.entries(WORD_SETS)) scores[lang] = words.filter(w => set.has(w)).length
  for (const [lang, re] of HINTS) if (re.test(s.toLowerCase())) scores[lang] = (scores[lang] || 0) + 2
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  const [best, bestScore] = ranked[0]
  const second = ranked[1] ? ranked[1][1] : 0
  if (bestScore === 0) return { lang: '', confidence: 0 }
  // Confident when the best language clearly beats the runner-up.
  const confidence = Math.min(1, (bestScore - second + 1) / (words.length / 2 + 1))
  return { lang: bestScore > second ? best : '', confidence: bestScore > second ? confidence : 0 }
}

module.exports = { detectLanguageLocal }

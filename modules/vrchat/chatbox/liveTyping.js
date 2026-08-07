// modules/vrchat/chatbox/liveTyping.js
// "Live Typing" chatbox mode - ported from the local reference app
// vrchat-chatbox-osc (src/main.js): as the user types, the raw text is just
// stored; a throttled tick computes what VRChat will actually display
// (trimmed to the 144-char cap, with a leading "…" once the text runs over
// so the user can see they're past the limit and keep typing), optionally
// translates that trimmed text, and sends it - reusing the existing
// ChatboxComposer hold/pin mechanism instead of a bespoke send path.

const { MAX_CHATBOX } = require('./chatboxComposer')

const DEFAULT_INTERVAL_MS = 3000
// Debounce delay: wait this long after the last keystroke before sending
// the first tick.  This avoids hammering the translation API while the
// user is still actively typing.
const DEBOUNCE_MS = 800

class LiveTypingSender {
  constructor ({ composer, intervalMs, translate }) {
    this.composer = composer
    this.intervalMs = Number.isFinite(intervalMs) ? intervalMs : DEFAULT_INTERVAL_MS
    this.translate = typeof translate === 'function' ? translate : null
    this.latestText = ''
    this.lastSent = null
    this.timer = null
    this.debounceTimer = null
    this.onPreview = null // (trimmedText) => void, for the UI preview line
  }

  // Trim to what VRChat will display: "…" + tail once over the 144 cap,
  // exactly like the reference app's algorithm.
  static trim (text) {
    if (text.length <= MAX_CHATBOX) return text
    return '…' + text.slice(text.length - (MAX_CHATBOX - 1))
  }

  setText (raw) {
    this.latestText = String(raw || '')
    if (typeof this.onPreview === 'function') this.onPreview(LiveTypingSender.trim(this.latestText))

    // Debounce: reset the idle timer on every keystroke so we don't fire
    // translation requests while the user is still typing.
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      // First tick fires immediately after the debounce settles...
      if (!this.timer) {
        this.tick()
        this.timer = setInterval(() => this.tick(), this.intervalMs)
      }
    }, DEBOUNCE_MS)
  }

  async tick () {
    const trimmed = LiveTypingSender.trim(this.latestText)

    if (trimmed.trim() === '') {
      this.stop()
      return
    }

    if (trimmed === this.lastSent) return
    this.lastSent = trimmed

    let out = trimmed
    if (this.translate) {
      try { out = await this.translate(trimmed) } catch (_) { out = trimmed }
    }

    this.composer.sendNow(out)
  }

  stop () {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
    this.lastSent = null
    this.composer.clearHold()
  }
}

module.exports = { LiveTypingSender, DEFAULT_INTERVAL_MS }

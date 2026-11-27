'use strict'
// Draws translation labels just above the text they translate (overlay window
// coordinates from main/translateOverlay.js). A label disappears when it isn't
// refreshed within its ttl - i.e. when the bubble is gone from the screen.
const labels = new Map() // key -> { el, expires }

// Keyed by text, so a bubble that drifts as the avatar moves slides its label along.
function keyOf (l) { return l.text }

function place (el, l) {
  const cx = (l.x0 + l.x1) / 2
  // The box is the text itself; the chatbox bubble's padding extends about
  // half a line further, so clear that too.
  const pad = Math.max(8, (l.y1 - l.y0) * 0.6)
  const above = l.y0 - pad
  // Not enough room above (bubble at the top of the screen): put it below.
  if (above < 60) { el.classList.add('below'); el.style.top = `${l.y1 + pad}px` } else { el.classList.remove('below'); el.style.top = `${above}px` }
  el.style.left = `${Math.max(40, Math.min(window.innerWidth - 40, cx))}px`
}

window.translateOverlay.onLabels(({ labels: list, ttlMs }) => {
  const now = Date.now()
  const seen = new Set()
  for (const l of list || []) {
    const k = keyOf(l)
    seen.add(k)
    let entry = labels.get(k)
    if (!entry) {
      const el = document.createElement('div')
      el.className = 'tl'
      const tag = document.createElement('small'); tag.textContent = 'TRANSLATED'
      const body = document.createElement('span'); body.textContent = l.text
      el.append(tag, body)
      document.body.appendChild(el)
      entry = { el }
      labels.set(k, entry)
    }
    entry.el.classList.remove('fade')
    entry.expires = now + (ttlMs || 5000)
    place(entry.el, l)
  }
  if (!list || !list.length) for (const e of labels.values()) e.expires = 0
})

setInterval(() => {
  const now = Date.now()
  for (const [k, e] of labels) {
    if (now > e.expires) {
      e.el.classList.add('fade')
      if (now > e.expires + 400) { e.el.remove(); labels.delete(k) }
    }
  }
}, 200)

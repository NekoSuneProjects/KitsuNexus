'use strict'

// Merge a saved sidebar order with the app's current buttons. Buttons added in
// a later version aren't in an older saved order; they used to sort to the
// very end (bottom of "General"). Category labels stay fixed while buttons
// fill the slots in order, so each missing button also shifted every later one
// into the wrong category (e.g. Terrors left "Games"). Now a new button goes
// right after the button that precedes it by default, keeping it - and
// everything after it - in its category. Buttons that no longer exist are dropped.
function mergeSidebarOrder (saved, defaults) {
  const merged = (saved || []).filter(t => defaults.includes(t))
  defaults.forEach((tab, i) => {
    if (merged.includes(tab)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) { const k = merged.indexOf(defaults[j]); if (k >= 0) { at = k + 1; break } }
    merged.splice(at, 0, tab)
  })
  return merged
}

module.exports = { mergeSidebarOrder }

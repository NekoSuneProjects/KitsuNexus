// modules/vrchat/tracking/oneEuro.js
// One Euro filter (Casiez et al.) — the jitter filter FoxyFace applies to every
// blendshape. Low cutoff = smoother when still, beta = less lag when moving.

function smoothingFactor (dt, cutoff) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1) }

class OneEuro {
  constructor ({ minCutoff = 1, beta = 0.007, dCutoff = 1 } = {}) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = null; this.dx = 0; this.t = null }
  filter (value, tSeconds) {
    if (this.x === null || this.t === null || tSeconds <= this.t) { this.x = value; this.t = tSeconds; return value }
    const dt = tSeconds - this.t
    const a = smoothingFactor(dt, this.dCutoff)
    const dx = (value - this.x) / dt
    this.dx = a * dx + (1 - a) * this.dx
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    const b = smoothingFactor(dt, cutoff)
    this.x = b * value + (1 - b) * this.x
    this.t = tSeconds
    return this.x
  }
}

// A bank of filters keyed by name.
class OneEuroBank {
  constructor (opts) { this.opts = opts; this.filters = new Map() }
  setOptions (opts) { this.opts = opts; this.filters.clear() }
  apply (values, tSeconds) {
    const out = {}
    for (const [k, v] of Object.entries(values)) {
      if (!Number.isFinite(v)) continue
      let f = this.filters.get(k)
      if (!f) { f = new OneEuro(this.opts); this.filters.set(k, f) }
      out[k] = f.filter(v, tSeconds)
    }
    return out
  }
  reset () { this.filters.clear() }
}

module.exports = { OneEuro, OneEuroBank }

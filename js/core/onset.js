// Click detector for table tennis sounds (paddle hits and table bounces).
//
// These sounds are short, sharp transients with most of their energy above
// ~2 kHz, while room noise and robot motor hum sit lower and change slowly.
// So the signal is high-passed, a fast peak envelope is compared with a slow
// running average of the background, and a click is reported when the
// envelope jumps well above it. Plain sample-by-sample code, so the same
// class runs in the AudioWorklet (js/audio/onset-worklet.js) and in tests.

/** Sensitivity 1-10 -> how far above the background a click must be. */
export function sensitivityToFactor(s) {
  return 3 * 10 ** ((10 - s) / 9); // 1 -> 30x, 5 -> ~11x, 10 -> 3x
}

/** Sensitivity 1-10 -> minimum click level (high-passed, full scale = 1). */
export function sensitivityToFloor(s) {
  return 10 ** -(1 + s * 0.35); // 1 -> -27 dBFS, 5 -> -55 dBFS, 10 -> -90 dBFS
}

export class OnsetDetector {
  /** opts: { sensitivity 1-10, minGapMs, hpHz } */
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.frame = 0;           // index of the next sample (set from the audio clock in the worklet)
    this.bg = 0;              // running mean of |high-passed signal|
    this.env = 0;             // fast peak envelope
    this.lastOnset = -Infinity;
    this.win = null;          // click being measured
    this.levelPeak = 0;       // loudest high-passed sample since takeLevel()
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.fastDecay = Math.exp(-1 / (0.003 * sampleRate));
    this.bgRate = 1 / (0.4 * sampleRate);
    this.warmRate = 1 / (0.05 * sampleRate);
    this.warm = Math.round(0.3 * sampleRate); // learn the background before reporting
    this.winLen = Math.round(0.02 * sampleRate);
    this.floorOverride = null;
    this.setOptions({ sensitivity: 5, minGapMs: 80, hpHz: 2000, minBright: 0.1, ...opts });
  }

  setOptions(o) {
    if (o.sensitivity != null) {
      this.sensitivity = o.sensitivity;
      this.factor = sensitivityToFactor(o.sensitivity);
      this.sensFloor = sensitivityToFloor(o.sensitivity);
    }
    // A calibrated minimum level (dBFS) replaces the sensitivity's; null clears it.
    if (o.floorDb !== undefined) this.floorOverride = o.floorDb == null ? null : 10 ** (o.floorDb / 20);
    this.floor = this.floorOverride ?? this.sensFloor;
    if (o.minBright != null) this.minBright = o.minBright;
    if (o.minGapMs != null) this.minGap = Math.round(o.minGapMs / 1000 * this.sr);
    if (o.hpHz != null) {
      // RBJ biquad high-pass, Q = 0.707.
      const w = 2 * Math.PI * Math.min(o.hpHz, this.sr * 0.45) / this.sr;
      const cos = Math.cos(w), alpha = Math.sin(w) / (2 * Math.SQRT1_2);
      const a0 = 1 + alpha;
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
      this.a1 = -2 * cos / a0;
      this.a2 = (1 - alpha) / a0;
    }
  }

  /** Level a click must exceed right now. */
  threshold() {
    return Math.max(this.floor, this.factor * this.bg);
  }

  /** Loudest high-passed sample since the last call. */
  takeLevel() {
    const p = this.levelPeak;
    this.levelPeak = 0;
    return p;
  }

  /**
   * Feeds samples; returns the clicks that finished measuring in this block:
   * { frame (where the click starts), peak (full band), peakHp, bg, bright, dull }.
   * `bright` = high-passed peak / full-band peak. A low thump with a sudden
   * start (footstep, robot clunk) leaks a little through the filter but stays
   * dull (bright < minBright); ball and paddle clicks are bright.
   */
  process(x) {
    const out = [];
    for (let i = 0; i < x.length; i++, this.frame++) {
      const s = x[i];
      const y = this.b0 * s + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = s;
      this.y2 = this.y1; this.y1 = y;
      const a = Math.abs(y);
      this.env = Math.max(a, this.env * this.fastDecay);
      if (a > this.levelPeak) this.levelPeak = a;

      if (this.win) {
        const w = this.win;
        w.peak = Math.max(w.peak, Math.abs(s));
        w.peakHp = Math.max(w.peakHp, a);
        if (--w.left <= 0) {
          const bright = w.peakHp / Math.max(w.peak, 1e-9);
          out.push({ frame: w.frame, peak: w.peak, peakHp: w.peakHp, bg: w.bg, bright, dull: bright < this.minBright });
          this.win = null;
        }
        continue; // the click itself must not raise the background
      }
      if (this.warm > 0) {
        this.warm--;
        this.bg += (a - this.bg) * this.warmRate;
        continue;
      }
      const since = this.frame - this.lastOnset;
      if (since >= this.minGap && this.env > this.threshold()) {
        this.lastOnset = this.frame;
        this.win = { frame: this.frame, peak: Math.abs(s), peakHp: a, bg: this.bg, left: this.winLen };
        continue;
      }
      // Skip the ringing right after a click too.
      if (since > this.minGap) this.bg += (a - this.bg) * this.bgRate;
    }
    return out;
  }
}

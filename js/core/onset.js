// Sound detector for table tennis sounds (paddle hits and bounces).
//
// These sounds are short, sharp transients with most of their energy above
// ~2 kHz, while room noise and robot motor hum sit lower and change slowly.
// So the signal is high-passed, a fast peak envelope is compared with a slow
// running average of the background, and a candidate is reported when the
// envelope jumps well above it. Each candidate comes with the features the
// user tunes on (core/serve-detect.js `classify`): loudness, brightness and
// how suddenly it rose. Plain sample-by-sample code, so the same class runs
// in the AudioWorklet (js/audio/onset-worklet.js) and in tests.
//
// Measured on a phone recording of hand bounces and speech (2026-11-19):
// a bounce jumps 16-36 dB above the 20 ms before it; its own fading tail and
// ongoing speech don't (-4 to +13 dB). Tails are dropped here; the rest is up
// to the user's "sudden rise" knob. (Speech starting from total silence can
// rise sharply too; the peak's timing doesn't help, as a wooden table rings
// and bounces peak 1-17 ms in.)

/** Sensitivity 1-10 -> how far above the background a sound must be. */
export function sensitivityToFactor(s) {
  return 3 * 10 ** ((10 - s) / 9); // 1 -> 30x, 5 -> ~11x, 10 -> 3x
}

/** Sensitivity 1-10 -> minimum candidate level (high-passed, full scale = 1). */
export function sensitivityToFloor(s) {
  return 10 ** -(1 + s * 0.35); // 1 -> -27 dBFS, 5 -> -55 dBFS, 10 -> -90 dBFS
}

/** A candidate that rises less than this above the 5-25 ms before it is a fading tail. */
export const TAIL_RISE_DB = 3;

export class OnsetDetector {
  /** opts: { sensitivity 1-10, minGapMs, hpHz } */
  constructor(sampleRate, opts = {}) {
    this.sr = sampleRate;
    this.frame = 0;           // index of the next sample (set from the audio clock in the worklet)
    this.bg = 0;              // running mean of |high-passed signal|
    this.env = 0;             // fast peak envelope
    this.lastOnset = -Infinity;
    this.win = null;          // candidate being measured
    this.levelPeak = 0;       // loudest high-passed sample since takeLevel()
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.fastDecay = Math.exp(-1 / (0.003 * sampleRate));
    this.bgRate = 1 / (0.4 * sampleRate);
    this.warmRate = 1 / (0.05 * sampleRate);
    this.warm = Math.round(0.3 * sampleRate); // learn the background before reporting
    this.winLen = Math.round(0.02 * sampleRate);
    // Recent history in 1 ms blocks (loudest sample per block), for the rise.
    this.blkLen = Math.max(1, Math.round(sampleRate / 1000));
    this.ring = new Float32Array(32);
    this.ringPos = 0;
    this.blkMax = 0;
    this.blkCount = 0;
    this.setOptions({ sensitivity: 5, minGapMs: 50, hpHz: 2000, ...opts });
  }

  setOptions(o) {
    if (o.sensitivity != null) {
      this.sensitivity = o.sensitivity;
      this.factor = sensitivityToFactor(o.sensitivity);
      this.floor = sensitivityToFloor(o.sensitivity);
    }
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

  /** Level a candidate must exceed right now. */
  threshold() {
    return Math.max(this.floor, this.factor * this.bg);
  }

  /** Loudest high-passed sample since the last call. */
  takeLevel() {
    const p = this.levelPeak;
    this.levelPeak = 0;
    return p;
  }

  // Loudest sample 5-25 ms before now. Not closer: at low sensitivity the
  // candidate starts a few ms into the attack, which must not count as "before".
  #before() {
    let m = 0;
    for (let j = 5; j <= 25; j++) m = Math.max(m, this.ring[(this.ringPos - j + 64) & 31]);
    return m;
  }

  /**
   * Feeds samples; returns the candidates that finished measuring in this block:
   * { frame (where it starts), peak (full band), peakHp, bg, bright, rise }.
   * bright = high-passed peak / full-band peak: ball and paddle sounds are
   * bright, a low thump that only leaks through the filter is dull.
   * rise = dB from the 5-25 ms before the sound to its peak.
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
      if (a > this.blkMax) this.blkMax = a;
      if (++this.blkCount >= this.blkLen) {
        this.ring[this.ringPos] = this.blkMax;
        this.ringPos = (this.ringPos + 1) & 31;
        this.blkMax = 0;
        this.blkCount = 0;
      }

      if (this.win) {
        const w = this.win;
        w.peak = Math.max(w.peak, Math.abs(s));
        w.peakHp = Math.max(w.peakHp, a);
        if (--w.left <= 0) {
          this.win = null;
          const rise = 20 * Math.log10(w.peakHp / Math.max(w.before, 1e-7));
          if (rise < TAIL_RISE_DB) {
            // The fading tail of an earlier sound: not a sound of its own, and
            // it must not block a real one that follows.
            this.lastOnset = w.prevOnset;
            continue;
          }
          out.push({ frame: w.frame, peak: w.peak, peakHp: w.peakHp, bg: w.bg, bright: w.peakHp / Math.max(w.peak, 1e-9), rise });
        }
        continue; // a sound must not raise the background
      }
      if (this.warm > 0) {
        this.warm--;
        this.bg += (a - this.bg) * this.warmRate;
        continue;
      }
      const since = this.frame - this.lastOnset;
      if (since >= this.minGap && this.env > this.threshold()) {
        this.win = { frame: this.frame, peak: Math.abs(s), peakHp: a, bg: this.bg, left: this.winLen, before: this.#before(), prevOnset: this.lastOnset };
        this.lastOnset = this.frame;
        continue;
      }
      // Skip the ringing right after a sound too.
      if (since > this.minGap) this.bg += (a - this.bg) * this.bgRate;
    }
    return out;
  }
}

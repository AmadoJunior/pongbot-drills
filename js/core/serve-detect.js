// Picks the far-side bounce of a serve out of a stream of clicks.
//
// With the phone on the server's side, a serve is a quick run of sounds:
// paddle hit, bounce on the server's side, bounce on the far side. A run
// starts after a quiet spell; the far bounce is the `triggerOn`-th sound of
// the run (3 by default, 2 when the paddle hit is too soft to register).
// After a trigger, sounds are ignored for `cooldownMs` (the rest of the rally).

const dB = v => 20 * Math.log10(Math.max(v, 1e-5));
const median = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/**
 * Calibration from balls the robot fires at the server's side.
 * shots: performance times (ms) the robot reported each ball; sounds: mic
 * clicks { perf, peakHp, bright, dull }. Per ball, the loudest bright sound
 * is the bounce next to the phone, and a bright sound before it is the
 * launch at the far end (about as far away as a serve's far bounce).
 * Returns null without at least 2 bounces, else the measurements and the
 * suggested detector settings { floorDb, minBright }.
 */
export function analyzeCalibration(shots, sounds) {
  const per = shots.map((t, i) => {
    const end = Math.min(shots[i + 1] ?? Infinity, t + 1500) - 1;
    const bright = sounds.filter(s => !s.dull && s.perf >= t - 300 && s.perf <= end);
    if (!bright.length) return { shot: t, bounce: null, launch: null };
    const bounce = bright.reduce((a, b) => (b.peakHp > a.peakHp ? b : a));
    const launch = bright.find(s => s.perf < bounce.perf) ?? null;
    return { shot: t, bounce, launch };
  });
  const bounces = per.filter(p => p.bounce).map(p => p.bounce);
  if (bounces.length < 2) return null;
  const launches = per.filter(p => p.launch).map(p => p.launch);
  const bounceDb = median(bounces.map(b => dB(b.peakHp)));
  const launchDb = launches.length ? median(launches.map(l => dB(l.peakHp))) : null;
  const minBounceBright = Math.min(...bounces.map(b => b.bright));
  // A serve's far bounce is ~2 m further from the phone than the robot's
  // ball: roughly 15 dB quieter. Leave 6 dB of margin below that, and go
  // lower still if the far-end launch was quieter.
  let floorDb = bounceDb - 21;
  if (launchDb != null) floorDb = Math.min(floorDb, launchDb - 6);
  return {
    balls: shots.length,
    heard: bounces.length,
    bounceDb: Math.round(bounceDb),
    launchDb: launchDb == null ? null : Math.round(launchDb),
    bounceBright: +minBounceBright.toFixed(2),
    shotToBounceMs: Math.round(median(per.filter(p => p.bounce).map(p => p.bounce.perf - p.shot))),
    floorDb: Math.round(Math.max(-80, floorDb)),
    // Half the dullest bounce, capped: far sounds can be a bit duller than one next to the phone.
    minBright: +Math.min(0.3, Math.max(0.05, minBounceBright * 0.5)).toFixed(2),
  };
}

export class ServeDetector {
  constructor(opts = {}) {
    this.triggerOn = 3;
    this.maxGapMs = 900;
    this.cooldownMs = 1500;
    this.setOptions(opts);
    this.reset();
  }

  setOptions({ triggerOn, maxGapMs, cooldownMs } = {}) {
    if (triggerOn != null) this.triggerOn = triggerOn;
    if (maxGapMs != null) this.maxGapMs = maxGapMs;
    if (cooldownMs != null) this.cooldownMs = cooldownMs;
  }

  reset() {
    this.run = [];
    this.quietUntil = -Infinity;
  }

  /** Sounds so far in the current run (0 once it has gone quiet for maxGapMs). */
  count(now) {
    return this.run.length && now - this.run.at(-1) <= this.maxGapMs ? this.run.length : 0;
  }

  /** A click at time t (ms). Returns { n: its number in the run, trigger, ignored }. */
  push(t) {
    if (t < this.quietUntil) return { n: 0, trigger: false, ignored: true };
    if (!this.count(t)) this.run = [];
    this.run.push(t);
    const n = this.run.length;
    if (n >= this.triggerOn) {
      this.run = [];
      this.quietUntil = t + this.cooldownMs;
      return { n, trigger: true, ignored: false };
    }
    return { n, trigger: false, ignored: false };
  }
}

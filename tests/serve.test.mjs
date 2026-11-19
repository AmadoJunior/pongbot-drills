import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector } from '../js/core/onset.js';
import { ServeDetector, analyzeCalibration, classify } from '../js/core/serve-detect.js';

const SR = 48000;

// Seeded noise, so the test is repeatable.
function noise(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
}

/** Room noise plus sounds: { at (s), amp, hz, decay (s) }. */
function signal(seconds, sounds, noiseAmp = 0.002) {
  const x = new Float32Array(Math.round(seconds * SR));
  const rnd = noise();
  for (let i = 0; i < x.length; i++) x[i] = rnd() * noiseAmp;
  for (const { at, amp, hz, decay } of sounds) {
    const start = Math.round(at * SR);
    for (let i = 0; i < decay * 8 * SR && start + i < x.length; i++) {
      const t = i / SR;
      x[start + i] += amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * hz * t);
    }
  }
  return x;
}

function detect(x, opts) {
  const det = new OnsetDetector(SR, opts);
  const out = [];
  for (let i = 0; i < x.length; i += 128) out.push(...det.process(x.subarray(i, i + 128)));
  return out.map(e => ({ ...e, t: e.frame / SR }));
}

const click = (at, amp) => ({ at, amp, hz: 4500, decay: 0.003 });

test('finds each click of a serve, including the quiet far bounce, to the millisecond', () => {
  const at = [0.5, 0.72, 1.15];
  const x = signal(2, [click(at[0], 0.2), click(at[1], 0.5), click(at[2], 0.03)]);
  const found = detect(x);
  assert.equal(found.length, 3, JSON.stringify(found.map(f => f.t)));
  found.forEach((f, i) => assert.ok(Math.abs(f.t - at[i]) < 0.002, `click ${i} at ${f.t}`));
  assert.ok(found[1].peakHp > found[2].peakHp * 5, 'the near bounce is louder than the far one');
});

test('a loud low thump (footstep, robot clunk) is dull, and room noise gives nothing', () => {
  const x = signal(2, [{ at: 0.8, amp: 0.4, hz: 120, decay: 0.05 }]);
  assert.ok(detect(x).every(f => classify(f) === 'dull'), JSON.stringify(detect(x)));
  assert.equal(detect(signal(2, [])).length, 0);
  const [c] = detect(signal(2, [click(0.5, 0.05)]));
  assert.equal(classify(c), null, 'a click counts');
  assert.ok(c.rise > 20, `a click rises sharply (${c.rise})`);
});

test('a bounce with a long fading tail counts once (it used to re-trigger every 80 ms)', () => {
  const x = signal(2, [{ at: 0.5, amp: 0.8, hz: 4000, decay: 0.06 }]);
  const found = detect(x, { sensitivity: 7 });
  assert.equal(found.length, 1, JSON.stringify(found.map(f => [f.t, f.rise])));
});

test('ongoing speech (syllables swelling out of each other) does not count', () => {
  const x = signal(3, []);
  // Syllables every ~180 ms that never fall back to silence, each swelling
  // over 40 ms, after a quiet lead-in the detector learns the room from.
  const start = Math.round(0.6 * SR);
  for (let i = 0; i < 2 * SR; i++) {
    const t = i / SR, ph = (t % 0.18) / 0.18;
    const amp = t < 0.3 ? 0.03 * t / 0.3 : 0.03 + 0.05 * Math.sin(Math.PI * ph) ** 2;
    x[start + i] += amp * Math.sin(2 * Math.PI * 2800 * t) * (1 + 0.3 * Math.sin(2 * Math.PI * 7 * t));
  }
  const found = detect(x, { sensitivity: 7 });
  assert.ok(found.every(f => classify(f) !== null), JSON.stringify(found.map(f => [f.t.toFixed(3), f.rise.toFixed(1)])));
});

test('the knobs decide: loudness, brightness and rise', () => {
  const s = { peakHp: 10 ** (-30 / 20), bright: 0.4, rise: 20 };
  assert.equal(classify(s, { minLevelDb: -35, minBright: 0.3, minRiseDb: 12 }), null);
  assert.equal(classify(s, { minLevelDb: -25, minBright: 0.3, minRiseDb: 12 }), 'quiet');
  assert.equal(classify(s, { minLevelDb: -35, minBright: 0.5, minRiseDb: 12 }), 'dull');
  assert.equal(classify(s, { minLevelDb: -35, minBright: 0.3, minRiseDb: 25 }), 'soft');
});

test('two clicks 5 ms apart count once, and lower sensitivity drops quiet clicks', () => {
  const x = signal(2, [click(0.5, 0.3), click(0.505, 0.3), click(1.2, 0.01)]);
  assert.equal(detect(x).length, 2);
  assert.equal(detect(x, { sensitivity: 1 }).length, 1);
});

test('calibration: loudest sharp, bright sound per ball is the bounce, an earlier one the far-end launch', () => {
  const lvl = d => 10 ** (d / 20);
  const shots = [1000, 3000, 5000];
  const sounds = shots.flatMap(t => [
    { perf: t + 20, peakHp: lvl(-40), bright: 0.6, rise: 20 },   // launch at the far end
    { perf: t + 450, peakHp: lvl(-12), bright: 0.8, rise: 30 },  // bounce next to the phone
    { perf: t + 700, peakHp: lvl(-5), bright: 0.04, rise: 30 },  // ball hits the floor: dull, skipped
    { perf: t + 900, peakHp: lvl(-3), bright: 0.5, rise: 2 },    // not sharp: skipped
  ]);
  sounds[5].bright = 0.5; // one bounce a bit duller
  const r = analyzeCalibration(shots, sounds);
  assert.equal(r.heard, 3);
  assert.equal(r.bounceDb, -12);
  assert.equal(r.launchDb, -40);
  assert.equal(r.shotToBounceMs, 450);
  assert.equal(r.bounceBright, 0.5);
  assert.equal(r.minBright, 0.25);
  // Far bounce estimate is bounce - 21 = -33 dB, but the launch was quieter: -40 - 6.
  assert.equal(r.minLevelDb, -46);
  assert.equal(analyzeCalibration(shots, sounds.slice(0, 2)), null, 'needs at least 2 bounces');
});

test('serve detector lights up on the 3rd sound of a quick run', () => {
  const s = new ServeDetector({ triggerOn: 3, maxGapMs: 900, cooldownMs: 1500 });
  assert.deepEqual(s.push(0), { n: 1, trigger: false, ignored: false });
  assert.equal(s.push(250).n, 2);
  assert.deepEqual(s.push(700), { n: 3, trigger: true, ignored: false });
  // The rally right after is ignored, then a new serve counts from 1.
  assert.equal(s.push(1500).ignored, true);
  assert.equal(s.push(3000).n, 1);
});

test('a long pause starts a new serve', () => {
  const s = new ServeDetector({ triggerOn: 3, maxGapMs: 900 });
  s.push(0);
  s.push(300);
  assert.equal(s.count(1000), 2);
  assert.equal(s.count(1300), 0);
  assert.equal(s.push(1300).n, 1);
  s.setOptions({ triggerOn: 2 });
  assert.equal(s.push(1600).trigger, true);
});

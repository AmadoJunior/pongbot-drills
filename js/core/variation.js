// Per-shot random variation: each varied field gets base + a uniform random
// offset in [-range, +range], snapped to the field's step and kept within
// the field's limits. Spin is then capped by what the wheels allow at the
// rolled speed.
import { FIELDS } from './physics.js';
import { deviceOf, maxSpinFor } from './devices.js';

export const VARIABLE_FIELDS = ['speed', 'spin', 'height', 'drop', 'rail', 'freq'];

// Largest ± range offered in the editor, per field.
export const VARY_MAX = { speed: 3, spin: 3, height: 30, drop: 10, rail: 10, freq: 50 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function hasVariation(ball) {
  return VARIABLE_FIELDS.some(f => (ball.vary?.[f] ?? 0) > 0);
}

/** Random value in base ± range on the field's step grid (uniform over grid points). */
export function rollField(field, base, range, rng = Math.random, fields = FIELDS) {
  const { min, max, step } = fields[field];
  const lo = clamp(base - range, min, max);
  const hi = clamp(base + range, min, max);
  const steps = Math.floor((hi - lo) / step + 1e-9);
  const v = lo + Math.floor(rng() * (steps + 1)) * step;
  return Math.round(v / step) * step;
}

/** One concrete shot from a ball definition. */
export function rollBall(ball, rng = Math.random, device = 'nova') {
  const dev = deviceOf(device);
  const shot = { ...ball };
  for (const f of dev.variable) {
    const range = ball.vary?.[f] ?? 0;
    if (range > 0) shot[f] = rollField(f, ball[f] ?? 0, range, rng, dev.fields);
  }
  shot.spin = Math.min(shot.spin, maxSpinFor(dev.id, shot.speed));
  delete shot.vary;
  return shot;
}

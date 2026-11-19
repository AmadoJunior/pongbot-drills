// Turns a drill into robot uploads.
//
// Drills without variation are uploaded once and the robot loops them itself
// (same as the official app). Drills with variation are split into shots:
// every repetition of a varied ball becomes its own entry with freshly rolled
// values, and as many whole cycles as fit are packed into one upload
// (max 20 balls), so the pause between uploads happens as rarely as possible.
//
// Uploads only ever hold whole cycles, so the pause between uploads falls
// between two cycles, never in the middle of one. When one cycle would need
// more than 20 entries, varied balls get fewer separately rolled values
// (see rollSlots) and some values are served twice or more in a row.
import { hasVariation, rollBall } from './variation.js';

export const MAX_BALLS = 20;

export function drillHasVariation(drill) {
  return drill.balls.some(hasVariation);
}

function shuffled(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * How many separately rolled entries each ball gets in one cycle: one per
 * repetition for varied balls, one for fixed balls. If that is more than
 * MAX_BALLS, slots are taken one at a time from the varied ball that has the
 * most, so the cycle fits in one upload. The result depends only on the drill,
 * so every cycle has the same length (Nova 0x84 needs that).
 */
export function rollSlots(drill) {
  const slots = drill.balls.map(b => (hasVariation(b) ? Math.max(1, b.reps) : 1));
  let total = slots.reduce((a, n) => a + n, 0);
  while (total > MAX_BALLS) {
    let j = -1;
    slots.forEach((n, i) => { if (n > 1 && (j < 0 || n > slots[j])) j = i; });
    if (j < 0) break; // more balls than MAX_BALLS: nextBatch splits the cycle
    slots[j]--;
    total--;
  }
  return slots;
}

/**
 * Entries for one cycle: { ballIndex, shot, reps }. Varied balls get one
 * entry per roll slot, their repetitions spread evenly over them (one per
 * repetition when the cycle fits); fixed balls keep their repetition count.
 */
export function buildCycle(drill, rng = Math.random) {
  let order = drill.balls.map((_, i) => i);
  if (drill.sequence === 'random') order = shuffled(order, rng);
  const slots = rollSlots(drill);
  const entries = [];
  for (const i of order) {
    const ball = drill.balls[i];
    if (hasVariation(ball)) {
      const k = slots[i];
      for (let s = 0; s < k; s++) {
        const reps = Math.floor(ball.reps / k) + (s < ball.reps % k ? 1 : 0);
        entries.push({ ballIndex: i, shot: rollBall({ ...ball, reps: 1 }, rng, drill.device), reps });
      }
    } else {
      entries.push({ ballIndex: i, shot: rollBall(ball, rng, drill.device), reps: ball.reps });
    }
  }
  return entries;
}

/**
 * Next upload for a varied drill. `cyclesLeft` is Infinity in time mode.
 * Returns { entries, cycles } where `cycles` counts whole cycles included
 * (0 when one cycle is too long and is split across uploads; `rest` then
 * holds the remaining entries of that cycle).
 */
export function nextBatch(drill, cyclesLeft, rng = Math.random, pending = null) {
  if (pending?.length) {
    const entries = pending.slice(0, MAX_BALLS);
    const rest = pending.slice(MAX_BALLS);
    return { entries, cycles: rest.length ? 0 : 1, rest };
  }
  const entries = [];
  let cycles = 0;
  while (cycles < cyclesLeft) {
    const cycle = buildCycle(drill, rng);
    if (entries.length + cycle.length <= MAX_BALLS) {
      entries.push(...cycle);
      cycles++;
      continue;
    }
    if (cycles === 0) {
      // Only reachable with more than MAX_BALLS balls (rollSlots fits any
      // smaller cycle), e.g. an imported drill: send it in pieces.
      return { entries: cycle.slice(0, MAX_BALLS), cycles: 0, rest: cycle.slice(MAX_BALLS) };
    }
    break;
  }
  return { entries, cycles, rest: [] };
}

// Turns a drill into robot uploads.
//
// Drills without variation are uploaded once and the robot loops them itself
// (same as the official app). Drills with variation are split into shots:
// every repetition of a varied ball becomes its own entry with freshly rolled
// values, and as many whole cycles as fit are packed into one upload
// (max 20 balls), so the pause between uploads happens as rarely as possible.
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
 * Entries for one cycle: { ballIndex, shot, reps }. Varied balls are expanded
 * to one entry per repetition; fixed balls keep their repetition count.
 */
export function buildCycle(drill, rng = Math.random) {
  let order = drill.balls.map((_, i) => i);
  if (drill.sequence === 'random') order = shuffled(order, rng);
  const entries = [];
  for (const i of order) {
    const ball = drill.balls[i];
    if (hasVariation(ball)) {
      for (let r = 0; r < ball.reps; r++) entries.push({ ballIndex: i, shot: rollBall({ ...ball, reps: 1 }, rng, drill.device), reps: 1 });
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
      // A single cycle longer than one upload: send it in pieces.
      return { entries: cycle.slice(0, MAX_BALLS), cycles: 0, rest: cycle.slice(MAX_BALLS) };
    }
    break;
  }
  return { entries, cycles, rest: [] };
}

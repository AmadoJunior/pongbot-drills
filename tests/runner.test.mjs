import test from 'node:test';
import assert from 'node:assert/strict';
import { Runner } from '../js/runner.js';
import { newDrill, newBall } from '../js/core/drills.js';
import { STATE, assertSendable } from '../js/core/protocol.js';

// Minimal browser storage stand-in (the runner saves timing logs).
const store = new Map();
globalThis.localStorage ??= { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

class FakeRobot extends EventTarget {
  constructor(model) { super(); this.model = model; this.sent = []; }
  send(bytes) { assertSendable(this.model, bytes); this.sent.push([...bytes]); }
  emit(msg) { this.dispatchEvent(new CustomEvent('message', { detail: msg })); }
  shot(ball = 1) { this.emit({ type: 'progress', group: 1, ball, time: 0 }); }
}

const ops = robot => robot.sent.map(p => p[0]);
const ballCount = (p, size) => (p[0] === 0x81 ? (p.length - 7) / size : (p.length - 3) / size);

function variedDrill(device, groups) {
  const d = newDrill(device === 'halo' ? 1 : 10, 2, device);
  d.balls = [newBall(10, 0, device), { ...newBall(10, 0, device), vary: { speed: 1, spin: 0, height: 0, drop: 0, rail: 0, freq: 0 } }];
  d.groups = groups;
  d.mode = 'groups';
  return d;
}

test('Nova: varied drill runs endless and swaps batches with 0x84, never restarting', () => {
  const robot = new FakeRobot('nova');
  const runner = new Runner(robot);
  let finished = null;
  runner.addEventListener('finish', e => { finished = e.detail.reason; });
  runner.start(variedDrill('nova', 25), 'drill');
  // 2 balls per combo -> 10 combos (20 balls) per batch.
  assert.deepEqual(robot.sent[0].slice(0, 7), [0x81, ...robot.sent[0].slice(1, 3), 3, 0, 0, 0], 'endless mode, count 0, no shuffle');
  assert.equal(ballCount(robot.sent[0], 24), 20);
  for (let i = 0; i < 19; i++) robot.shot();
  assert.deepEqual(ops(robot), [0x81], 'nothing sent mid-batch');
  robot.shot(); // last shot of the batch
  assert.deepEqual(ops(robot), [0x81, 0x84]);
  assert.equal(ballCount(robot.sent[1], 24), 20, '0x84 keeps the ball count');
  for (let i = 0; i < 30; i++) robot.shot(); // 25 combos = 50 shots in total
  assert.deepEqual(ops(robot), [0x81, 0x84, 0x84, 0x80], 'stops after the last combo');
  assert.deepEqual(robot.sent.at(-1), [0x80, 1, 0, 1]);
  assert.equal(finished, 'done');
});

test('Nova: varied repetitions count as separate shots for combo progress', () => {
  const robot = new FakeRobot('nova');
  const runner = new Runner(robot);
  const d = variedDrill('nova', 3);
  d.balls[1].reps = 4; // varied ball x4 -> 4 entries; combo = 5 entries
  runner.start(d, 'drill');
  assert.equal(ballCount(robot.sent[0], 24), 20, '4 combos of 5 entries');
  for (let i = 0; i < 14; i++) robot.shot();
  assert.equal(runner.session.cyclesDone, 2);
  robot.shot();
  assert.equal(runner.session, null, 'finished after 3 combos (15 shots)');
});

test('Halo: never sends 0x84; batches restart with 0x81 after complete', () => {
  const robot = new FakeRobot('halo');
  const runner = new Runner(robot);
  runner.start(variedDrill('halo', 25), 'drill');
  assert.deepEqual(ops(robot), [0x81]);
  assert.equal(robot.sent[0][3], 1, 'groups mode, as before');
  for (let i = 0; i < 20; i++) robot.shot();
  assert.deepEqual(ops(robot), [0x81], 'waits for complete');
  robot.emit({ type: 'status', state: STATE.complete, code: 1 });
  assert.deepEqual(ops(robot), [0x81, 0x81]);
  runner.stop();
});

test('0x84 is refused for the Halo and OTA commands for both robots', () => {
  assert.throws(() => assertSendable('halo', [0x84, 1, 0]), /deletes stored drills/);
  assert.doesNotThrow(() => assertSendable('nova', [0x84, 1, 0]));
  for (const m of ['nova', 'halo']) assert.throws(() => assertSendable(m, [0xc2]), /OTA/);
});

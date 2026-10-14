import test from 'node:test';
import assert from 'node:assert/strict';
import { toRobot, maxSpin, wheelRpm, simulate, ROBOT_POSITIONS, headForType } from '../js/core/physics.js';
import { rollField, rollBall, hasVariation } from '../js/core/variation.js';
import { buildCycle, nextBatch, MAX_BALLS } from '../js/core/scheduler.js';
import { drillPacket, packBall, parseNotification, authResponse, MODE } from '../js/core/protocol.js';
import { importText, newDrill, newBall } from '../js/core/drills.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ball = (o = {}) => ({ ...newBall(10, 0), ...o, vary: { speed: 0, spin: 0, height: 0, drop: 0, ...o.vary } });

test('wheel speeds match olanga formula (970 + 630.5*speed, 342*spin)', () => {
  const r = toRobot(ball({ speed: 5, spin: 5, rot: 0 }));
  assert.ok(Math.abs(r.up - (970 + 630.5 * 5 + 342 * 5)) <= 2);
  assert.ok(Math.abs(r.down - (970 + 630.5 * 5 - 342 * 5)) <= 2);
  const back = toRobot(ball({ speed: 5, spin: 5, rot: 5 }));
  assert.equal(back.up, r.down);
  assert.equal(back.down, r.up);
});

test('height/drop/freq scaling', () => {
  const r = toRobot(ball({ height: -50, drop: 10, freq: 100 }));
  assert.equal(r.height, -20);
  assert.equal(r.drop, 22);
  assert.equal(r.freq, 1.5);
});

test('official spin limits', () => {
  assert.equal(maxSpin(0), 2.5);
  assert.equal(maxSpin(4), 10);
  assert.equal(maxSpin(5), 9.5);
  assert.equal(maxSpin(10), 0.5);
  assert.equal(wheelRpm(10, 1, 0).ok, false);
});

test('official default balls land centre-deep from every position', () => {
  for (const [pos, d] of Object.entries(ROBOT_POSITIONS)) {
    const r = simulate(ball({ height: d.height, speed: d.speed }), Number(pos));
    assert.equal(r.code, 8, `position ${pos}`);
  }
});

test('drop point moves the landing sideways', () => {
  const left = simulate(ball({ height: 50, speed: 3, drop: -6 }), 10).landing[0];
  const right = simulate(ball({ height: 50, speed: 3, drop: 6 }), 10).landing[0];
  assert.ok(left > 0.2 && right < -0.2, `${left} ${right}`);
});

test('head positions pair rotation types', () => {
  assert.deepEqual(headForType(6).types, [2, 6]);
  assert.deepEqual(headForType(4).types, [1, 4]);
});

test('rollField stays on grid and inside range', () => {
  for (let i = 0; i < 500; i++) {
    const v = rollField('speed', 5, 1);
    assert.ok(v >= 4 && v <= 6 && (v * 2) % 1 === 0, String(v));
  }
  assert.equal(rollField('speed', 5, 1, () => 0), 4);
  assert.equal(rollField('speed', 5, 1, () => 0.999), 6);
  assert.equal(rollField('drop', 9, 3, () => 0.999), 10);
  assert.equal(rollField('height', -48, 5, () => 0), -50);
});

test('rollBall caps spin at the rolled speed', () => {
  const s = rollBall(ball({ speed: 9.5, spin: 1, vary: { speed: 0.5 } }), () => 0.999);
  assert.equal(s.speed, 10);
  assert.equal(s.spin, 0.5);
  assert.equal(s.vary, undefined);
});

test('buildCycle keeps order and expands varied repetitions', () => {
  const d = newDrill();
  d.balls = [ball({ reps: 2 }), ball({ reps: 3, vary: { speed: 1 } }), ball()];
  const c = buildCycle(d, seq(0.1, 0.9, 0.5));
  assert.deepEqual(c.map(e => e.ballIndex), [0, 1, 1, 1, 2]);
  assert.deepEqual(c.map(e => e.reps), [2, 1, 1, 1, 1]);
  assert.ok(hasVariation(d.balls[1]));
});

test('nextBatch packs whole cycles up to 20 balls', () => {
  const d = newDrill();
  d.balls = [ball(), ball({ vary: { spin: 1 } }), ball()];
  const b = nextBatch(d, Infinity);
  assert.equal(b.cycles, 6);
  assert.equal(b.entries.length, 18);
  assert.equal(nextBatch(d, 2).entries.length, 6);
});

test('nextBatch splits a cycle longer than one upload', () => {
  const d = newDrill();
  d.balls = [ball({ reps: 30, vary: { drop: 2 } })];
  const first = nextBatch(d, 5);
  assert.equal(first.entries.length, MAX_BALLS);
  assert.equal(first.cycles, 0);
  const second = nextBatch(d, 5, Math.random, first.rest);
  assert.equal(second.entries.length, 10);
  assert.equal(second.cycles, 1);
});

test('drill packet layout', () => {
  const p = drillPacket([packBall(ball()), packBall(ball())], MODE.groups, 7, true);
  assert.equal(p.length, 7 + 48);
  assert.deepEqual([...p.slice(0, 7)], [0x81, 52, 0, 1, 7, 0, 1]);
});

test('notification parsing', () => {
  assert.deepEqual(parseNotification(new Uint8Array([0, 2, 3, 0, 5, 1, 0])), { type: 'status', state: 5, code: 1 });
  assert.deepEqual(parseNotification(new Uint8Array([0, 5, 7, 0, 2, 0, 9, 0, 3, 0])), { type: 'progress', group: 2, time: 9, ball: 3 });
});

test('auth response format', () => {
  const r = authResponse('xxxxxxABCDEFGHIJKL1234');
  assert.deepEqual([...r.slice(0, 3)], [0x08, 0x20, 0]);
  assert.equal(r.length, 35);
});

test('olanga CSV import folds variants into ranges', () => {
  const csv = 'Set;Ball;Name;Speed;Spin;Type;Height;Drop;Freq;Reps\nA;1;D1;7.5;5;back;50;-5;10;1\nA;1;D1;7.5;5;back;50;5;10;1\nA;2;D1;6;3;top;40;0;20;2';
  const [d] = importText(csv);
  assert.equal(d.name, 'D1');
  assert.equal(d.balls.length, 2);
  assert.equal(d.balls[0].drop, 0);
  assert.equal(d.balls[0].vary.drop, 5);
  assert.equal(d.balls[0].rot, 5);
  assert.equal(d.balls[1].reps, 2);
});

test('official account dump import', () => {
  const dump = { rows: [{ groupName: 'Falkenberg', devicePosition: '8', groupJsonStr: JSON.stringify([{ pa: 20, pr: 0, ya: -6, us: 4, ds: 3, fr: 50, cs: 1 }]) }] };
  const [d] = importText(JSON.stringify(dump));
  assert.equal(d.name, 'Falkenberg');
  assert.equal(d.position, 8);
  assert.equal(d.balls[0].drop, -6);
  assert.equal(d.balls[0].speed, 4);
});

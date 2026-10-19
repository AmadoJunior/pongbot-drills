import test from 'node:test';
import assert from 'node:assert/strict';
import { haloToRobot, simulateHalo, HALO_POSITIONS } from '../js/core/halo.js';
import { crc16Modbus, haloFrame, haloUnframe, packBall, drillPacket, parseNotification } from '../js/core/protocol.js';
import { simulateBall, deviceFromName, maxSpinFor } from '../js/core/devices.js';
import { newDrill, newBall, importText, angleToRot, ROT_ANGLE } from '../js/core/drills.js';
import { buildCycle } from '../js/core/scheduler.js';
import { landsOnTable } from '../js/core/physics.js';

const ball = (o = {}) => ({ ...newBall(1, 0, 'halo'), ...o, vary: { speed: 0, spin: 0, height: 0, drop: 0, rail: 0, ...o.vary } });

test('CRC-16/MODBUS check value', () => {
  assert.equal(crc16Modbus(new TextEncoder().encode('123456789')), 0x4b37);
});

test('Halo frame layout and round trip', () => {
  const payload = new Uint8Array([0x80, 1, 0, 1]);
  const f = haloFrame(payload);
  assert.deepEqual([...f.slice(0, 4)], [0x41, 0x14, 6, 0]);
  assert.equal(f.length, payload.length + 6);
  const crc = crc16Modbus(f.slice(2, f.length - 2));
  assert.deepEqual([...f.slice(-2)], [crc & 0xff, crc >> 8]);
  assert.deepEqual([...haloUnframe(f)], [...payload]);
});

test('Halo ball record is 56 bytes with fields in official order', () => {
  const rec = packBall(ball({ speed: 5, spin: 5, angle: 0, height: 20, drop: 0, rail: 10, freq: 50, reps: 3 }), 3, 'halo', 2);
  assert.equal(rec.length, 56);
  const v = new DataView(rec.buffer);
  const r = haloToRobot(ball({ speed: 5, spin: 5, angle: 0, height: 20, rail: 10, freq: 50 }), 2);
  assert.equal(v.getInt32(0, true), r.up);
  assert.equal(v.getInt32(4, true), r.down);
  assert.ok(Math.abs(v.getFloat32(16, true) - 26) < 1e-4, 'yaw includes the position 2 offset');
  assert.ok(Math.abs(v.getFloat32(20, true) - 0.5) < 1e-6, 'freq is 0-1');
  assert.equal(v.getUint32(24, true), 3);
  assert.ok(Math.abs(v.getFloat32(28, true) - 0.8) < 1e-6, 'rail +10 = +0.8 m');
  assert.equal(v.getUint32(32, true), 0x1000000);
  assert.equal(drillPacket([rec, rec]).length, 7 + 112);
});

test('topspin and backspin swap the Halo wheel speeds', () => {
  const top = haloToRobot(ball({ speed: 5, spin: 5, angle: 0 }));
  const back = haloToRobot(ball({ speed: 5, spin: 5, angle: 180 }));
  // Not exact: the two wheels have slightly different constants (kw_up 0.0096, kw_down 0.0097).
  assert.ok(Math.abs(top.up - back.down) / Math.abs(top.up) < 0.01);
  assert.ok(Math.abs(top.down - back.up) / Math.abs(top.down) < 0.03);
  assert.ok(top.up < 0 && top.down < 0, 'Halo wheel speeds are negative');
});

test('Halo head roll comes from the spin angle', () => {
  assert.equal(haloToRobot(ball({ spin: 4, angle: 90 })).roll, -90);
  assert.equal(haloToRobot(ball({ spin: 4, angle: 315 })).roll, -45);
  assert.equal(haloToRobot(ball({ spin: 4, angle: 45 })).roll, -135);
  assert.equal(haloToRobot(ball({ spin: 4, angle: 10 })).roll, 0, 'beyond -157.5° the roll flips back to 0');
});

test('Halo default balls land from every position', () => {
  for (const p of Object.keys(HALO_POSITIONS)) {
    const b = newBall(Number(p), 0, 'halo');
    assert.ok(landsOnTable(simulateHalo(b, Number(p))), `position ${p}`);
  }
  const d = newDrill(2, 2, 'halo');
  assert.ok(landsOnTable(simulateBall(d.balls[0], d)));
});

test('Halo progress notification', () => {
  assert.deepEqual(parseNotification(new Uint8Array([0, 0x0b, 6, 0, 3, 0, 12, 0, 2, 0])), { type: 'progress', group: 3, time: 12, ball: 2 });
});

test('device detection and limits', () => {
  assert.equal(deviceFromName('HALO_O58241000003'), 'halo');
  assert.equal(deviceFromName('NOVA_O38123'), 'nova');
  assert.equal(maxSpinFor('halo', 10), 10);
  assert.equal(maxSpinFor('nova', 10), 0.5);
});

test('rail variation is rolled per shot on the Halo', () => {
  const d = newDrill(1, 2, 'halo');
  d.balls = [ball({ reps: 50, rail: 0, vary: { rail: 5 } })];
  const rails = new Set(buildCycle(d).map(e => e.shot.rail));
  assert.ok(rails.size > 3);
  for (const r of rails) assert.ok(r >= -5 && r <= 5);
});

test('Nova rotation type <-> compass angle', () => {
  for (let r = 0; r < 8; r++) assert.equal(angleToRot(ROT_ANGLE[r]), r);
  assert.equal(angleToRot(100), 7);
});

test('official import tags Halo drills and keeps angle/rail', () => {
  const dump = { rows: [
    { groupName: 'Banana', devicePosition: '1', productSeries: 'O58', model: 'halo',
      detail: [{ groupJsonStr: JSON.stringify({ point_param: [{ pa: 20, ra: 10, ya: 3, us: 4, ds: 5, fr: 40, cs: 2, sp: -4 }] }) }] },
    { groupName: 'FH Push', devicePosition: '8', productSeries: 'O38', angle: '0.0',
      detail: [{ groupJsonStr: JSON.stringify({ point_param: [{ pa: 30, pr: 5, ya: -3, us: 3, ds: 2, fr: 50, cs: 1 }] }) }] },
  ] };
  const [halo, nova] = importText(JSON.stringify(dump));
  assert.equal(halo.device, 'halo');
  assert.equal(halo.balls[0].angle, 90);
  assert.equal(halo.balls[0].spin, 5);
  assert.equal(halo.balls[0].rail, -4);
  assert.equal(nova.device, 'nova');
  assert.equal(nova.balls[0].rot, 5);
  assert.equal(nova.bodyAngle, null);
});

test('Halo cloud spin (signed ds + roll index ra) imports as spin and compass angle', () => {
  const row = balls => ({ groupName: 'x', devicePosition: '1', productSeries: 'O58',
    detail: [{ groupJsonStr: JSON.stringify({ point_param: balls }) }] });
  // Values from real drills: "Loop (BH), Drive(BH)" and "Banana".
  const pts = [{ ds: 4.5, ra: 0.1111111111111111 }, { ds: -3.5, ra: 0.4444444444444444 },
    { ds: -4, ra: 19.555555555555557 }, { ds: -5, ra: 0 }, { ds: 0, ra: 3 }]
    .map(p => ({ us: 4, pa: 20, ya: 0, fr: 50, cs: 1, sp: 0, ...p }));
  const [d] = importText(JSON.stringify({ rows: [row(pts)] }));
  assert.deepEqual(d.balls.map(b => [b.spin, b.angle]), [[4.5, 179], [3.5, 356], [4, 184], [5, 0], [0, 0]]);
  // Converting back gives the stored roll index again: roll = -9·ra.
  assert.equal(Math.round(haloToRobot(d.balls[0]).roll), -1);
  assert.equal(Math.round(haloToRobot(d.balls[1]).roll), -4);
});

test('frequency variation is rolled per shot on both robots, within 0-100', () => {
  for (const device of ['nova', 'halo']) {
    const d = newDrill(device === 'halo' ? 1 : 10, 2, device);
    d.balls = [{ ...newBall(1, 0, device), reps: 60, freq: 95, vary: { speed: 0, spin: 0, height: 0, drop: 0, rail: 0, freq: 10 } }];
    const freqs = buildCycle(d).map(e => e.shot.freq);
    assert.equal(freqs.length, 60, `${device}: each repetition becomes its own shot`);
    assert.ok(new Set(freqs).size > 5, device);
    for (const f of freqs) assert.ok(f >= 85 && f <= 100 && Number.isInteger(f), `${device}: ${f}`);
  }
});

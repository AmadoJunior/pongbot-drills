// Nova S Pro / Halo S Pro BLE protocol, as used by the official app
// (bleMTService.dart, BleMeAndHaloService.dart). Both robots share the GATT
// service and command set; the Halo wraps every packet in a CRC frame and
// uses a 56-byte ball record. See re/FINDINGS.md.
import { MD5 } from './md5.js';
import { toRobot } from './physics.js';
import { haloToRobot } from './halo.js';

export const SERVICE_ADV = 0xfeff;
export const SERVICE = '02f00000-0000-0000-0000-00000000fe00';
export const CHAR_WRITE = '02f00000-0000-0000-0000-00000000ff01';
export const CHAR_NOTIFY = '02f00000-0000-0000-0000-00000000ff02';
const SALT = 'Mjgx1jAwXDBaMFcxCz3JBgNVBAYT4kJF7Rkw';

export const MODE = { minutes: 0, groups: 1, endless: 3 };

export const CMD = {
  accessInfo: [0x07, 0, 0, 0],
  verified1: [0x01, 0, 0],
  verified2: [0x02, 0, 0],
  wake: [0x80, 1, 0, 0],
  stop: [0x80, 1, 0, 1],
  pause: [0x80, 1, 0, 2],
  resume: [0x80, 1, 0, 3],
  heartbeat: [0x83, 6, 0],
};

/** Auth reply to the robot's access-info notification (serial + challenge). */
export function authResponse(text) {
  const serial = text.slice(6, 18);
  const code = text.slice(18);
  let s = serial;
  for (let i = 0; i < serial.length; i++) s += SALT[serial.charCodeAt(i) % 36];
  const hash = new TextEncoder().encode(MD5(s + code));
  const out = new Uint8Array(3 + hash.length);
  out.set([0x08, 0x20, 0]);
  out.set(hash, 3);
  return out;
}

/** Ball record for the given robot: 24 bytes (Nova) or 56 bytes (Halo). */
export function packBall(shot, reps = shot.reps, device = 'nova', position = 1) {
  return device === 'halo' ? packHaloBall(shot, reps, position) : packNovaBall(shot, reps);
}

// Default LED colour used by the official app when a ball has none set.
const LED_DEFAULT = 0x1000000;

function packHaloBall(shot, reps, position) {
  const r = haloToRobot({ ...shot, reps }, position);
  const v = new DataView(new ArrayBuffer(56));
  v.setInt32(0, r.up, true);
  v.setInt32(4, r.down, true);
  v.setFloat32(8, r.roll, true);
  v.setFloat32(12, r.pitch, true);
  v.setFloat32(16, r.yaw, true);
  v.setFloat32(20, r.freq, true);
  v.setUint32(24, r.reps, true);
  v.setFloat32(28, r.rail, true);
  for (let i = 0; i < 4; i++) {
    const led = shot.leds?.[i];
    v.setUint32(32 + i * 6, led?.rgb ?? LED_DEFAULT, true);
    v.setUint16(36 + i * 6, led?.flicker ?? 0, true);
  }
  return new Uint8Array(v.buffer);
}

function packNovaBall(shot, reps) {
  const r = toRobot({ ...shot, reps });
  const v = new DataView(new ArrayBuffer(24));
  v.setUint32(0, r.up, true);
  v.setUint32(4, r.down, true);
  v.setFloat32(8, r.height, true);
  v.setFloat32(12, r.drop, true);
  v.setFloat32(16, r.freq, true);
  v.setUint32(20, r.reps, true);
  return new Uint8Array(v.buffer);
}

/** 0x81 new drill. `balls` are ball records of one size. */
export function drillPacket(balls, mode = MODE.groups, modeValue = 1, random = false) {
  const size = balls[0]?.length ?? 24;
  const out = new Uint8Array(7 + balls.length * size);
  const v = new DataView(out.buffer);
  v.setUint8(0, 0x81);
  v.setUint16(1, 4 + balls.length * size, true);
  v.setUint8(3, mode);
  v.setUint16(4, modeValue, true);
  v.setUint8(6, random ? 1 : 0);
  balls.forEach((b, i) => out.set(b, 7 + i * size));
  return out;
}

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF). */
export function crc16Modbus(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Halo frame: 41 14, length (payload + 2) LE, payload, CRC over length+payload LE. */
export function haloFrame(payload) {
  const body = new Uint8Array(2 + payload.length);
  new DataView(body.buffer).setUint16(0, payload.length + 2, true);
  body.set(payload, 2);
  const crc = crc16Modbus(body);
  const out = new Uint8Array(4 + payload.length);
  out.set([0x41, 0x14]);
  out.set(body, 2);
  return Uint8Array.from([...out, crc & 0xff, crc >> 8]);
}

/** Strips a Halo frame if present. */
export function haloUnframe(bytes) {
  return bytes[0] === 0x41 && bytes[1] === 0x14 && bytes.length >= 6 ? bytes.slice(4, bytes.length - 2) : bytes;
}

export const HALO_CHUNK = 252;

/** 0x84 replace the balls of the running drill (used by the official Combo Test). */
export function modifyPacket(balls) {
  const out = new Uint8Array(3 + balls.length * 24);
  const v = new DataView(out.buffer);
  v.setUint8(0, 0x84);
  v.setUint16(1, 1 + balls.length * 24, true);
  balls.forEach((b, i) => out.set(b, 3 + i * 24));
  return out;
}

export const STATE = { standby1: 2, standby2: 3, active: 4, complete: 5, paused: 6 };

/** Decode a (Halo-unframed) notification into { type, ... }. Progress uses 00 05 07 00 on the Nova, 00 0B 06 00 on the Halo. */
export function parseNotification(bytes) {
  const b = bytes;
  const is = (...p) => p.every((x, i) => b[i] === x);
  if (is(0, 2, 3, 0) && b.length >= 6) return { type: 'status', state: b[4], code: b[5] };
  if ((is(0, 5, 7, 0) || is(0, 0x0b, 6, 0)) && b.length >= 10) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'progress', group: v.getUint16(4, true), time: v.getUint16(6, true), ball: v.getUint16(8, true) };
  }
  if (is(0, 0x81, 0, 0)) return { type: 'drillAck', ok: true };
  if (is(1, 0x81, 0, 0)) return { type: 'drillAck', ok: false };
  if (is(0, 0x81, 3, 0)) return { type: 'drillAck', ok: true, level: b[4], code: b[5] };
  if (is(0, 0x80, 0, 0)) return { type: 'controlAck', ok: true };
  if (is(1, 0x80, 0, 0)) return { type: 'controlAck', ok: false };
  if (is(0, 0x83, 0, 0)) return { type: 'heartbeat' };
  if (is(0, 8, 0, 0)) return { type: 'verified', ok: true };
  if (is(1, 8, 0, 0)) return { type: 'verified', ok: false };
  return { type: 'unknown' };
}

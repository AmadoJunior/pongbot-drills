// Ball physics and parameter conversion, ported from the official app's
// libPongbotMT.so (getMtRobotParams, getMtRotateSpeedUIRange, getMtInitInfo,
// calMtBallTrajectory, callMtBallTrajectoryByRotationType).
// See re/FINDINGS.md for the decompiled sources and constants.

const V_SCALE = 0.05510981832927578;
const RPM_DIV = 0.00011363644539496664;
const WHEEL_R = 0.001031;
const PI = 3.14159265359;
const SPIN_SCALE = 60;
const DEG = 0.01745329252;
export const RPM_MAX = 7500;

// Rotation type code -> sign of the spin term and the head roll angle (deg).
// Codes 0-3 are the topspin family, 4-7 the backspin family.
const SPIN_SIGN = [-1, -1, -1, -1, 1, 1, 1, 1];
const HEAD_ROLL = [0, 45, -45, -90, 45, 0, -45, -90];

export const ROTATION_TYPES = [
  { code: 0, label: 'Top' },
  { code: 1, label: 'Top Right' },
  { code: 2, label: 'Top Left' },
  { code: 3, label: 'Left' },
  { code: 4, label: 'Under Left' },
  { code: 5, label: 'Under' },
  { code: 6, label: 'Under Right' },
  { code: 7, label: 'Right' },
];

// Manual head positions ("Combo Rotation Type"). Each position allows one
// topspin-family and one backspin-family rotation type. `angle` is how the
// official app rotates the head picture; `roll` is the physical head roll the
// trajectory model uses for that position.
export const HEAD_POSITIONS = [
  { key: 2, angle: 0, roll: 0, types: [0, 5] },
  { key: 6, angle: 90, roll: -45, types: [2, 6] },
  { key: 8, angle: -90, roll: 45, types: [1, 4] },
  { key: 4, angle: 180, roll: -90, types: [3, 7] },
];

export function headForType(code) {
  return HEAD_POSITIONS.find(h => h.types.includes(code)) ?? HEAD_POSITIONS[0];
}

// Robot positions on the table: [x, y, z, yaw of the robot body in deg] plus
// the official default ball for that position. 1-9 form a 3x3 grid,
// 10 = Standard, 11 = Near-Net.
export const ROBOT_POSITIONS = {
  1: { xyza: [-0.5085, -0.27, 0, -21.82], height: 20, speed: 2 },
  2: { xyza: [0, -0.30878, 0, 0], height: 20, speed: 2 },
  3: { xyza: [0.5085, -0.27, 0, 21.82], height: 20, speed: 2 },
  4: { xyza: [-0.5085, -0.71, 0, -16.56], height: 30, speed: 3 },
  5: { xyza: [0, -0.71, 0, 0], height: 20, speed: 3 },
  6: { xyza: [0.5085, -0.71, 0, 16.56], height: 30, speed: 3 },
  7: { xyza: [-0.5085, -1.15, 0, -13.31], height: 30, speed: 4 },
  8: { xyza: [0, -1.24138, 0, 0], height: 50, speed: 3 },
  9: { xyza: [0.5085, -1.15, 0, 13.31], height: 30, speed: 4 },
  10: { xyza: [0, -1.24138, 0, 0], height: 50, speed: 3 },
  11: { xyza: [0, -0.30878, 0, 0], height: 20, speed: 2 },
};

// Official editor field definitions (mt_dict_data.dart).
export const FIELDS = {
  height: { min: -50, max: 100, step: 1 },
  drop: { min: -10, max: 10, step: 1 },
  speed: { min: 0, max: 10, step: 0.5 },
  spin: { min: 0, max: 10, step: 0.5 },
  freq: { min: 0, max: 100, step: 10 },
  reps: { min: 1, max: 200, step: 1 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function wheelTerms(speed, spin, rot) {
  const v = ((clamp(speed, 0, 10) / 10) * 13 + 2) * V_SCALE;
  const w = (clamp(spin, 0, 10) / 10) * SPIN_SCALE * (SPIN_SIGN[rot] ?? -1);
  const ws = 2 * w * PI * WHEEL_R;
  return { up: (v - ws) / RPM_DIV, down: (v + ws) / RPM_DIV };
}

const inRpm = r => r >= 0 && r <= RPM_MAX;

/** Wheel speeds in rpm; `ok` is false when the official app would reject the ball. */
export function wheelRpm(speed, spin, rot) {
  const { up, down } = wheelTerms(speed, spin, rot);
  return { up, down, ok: inRpm(up) && inRpm(down) };
}

/** Largest spin allowed at this speed, on the 0.5 UI grid. */
export function maxSpin(speed) {
  for (let s = FIELDS.spin.max; s > 0; s -= FIELDS.spin.step) {
    if (wheelRpm(speed, s, 0).ok) return s;
  }
  return 0;
}

/** UI ball -> the six values packed into a 24-byte ball record. */
export function toRobot(ball) {
  const { up, down } = wheelTerms(ball.speed, ball.spin, ball.rot);
  return {
    up: Math.round(clamp(up, 0, RPM_MAX)),
    down: Math.round(clamp(down, 0, RPM_MAX)),
    height: ((clamp(ball.height, -50, 100) + 50) / 150) * 50 - 20,
    drop: ((clamp(ball.drop, -10, 10) + 10) / 20) * 44 - 22,
    freq: clamp(ball.freq, 0, 100) / 100 + 0.5,
    reps: clamp(Math.round(ball.reps), 0, 200),
  };
}

// Launch state from robot pose and wheel speeds (getMtInitInfo).
function initState(P, yawDeg, pitchDeg, rollDeg, up, down) {
  const W = 2 * (down - up) * 0.008771 * PI;
  const V = (up + down) * WHEEL_R;
  const sT = Math.sin(P[3] * DEG), cT = Math.cos(P[3] * DEG);
  const sY = Math.sin(yawDeg * DEG), cY = Math.cos(yawDeg * DEG);
  const sP = Math.sin(-pitchDeg * DEG), cP = Math.cos(-pitchDeg * DEG);
  const sYT = Math.sin((yawDeg + P[3]) * DEG), cYT = Math.cos((yawDeg + P[3]) * DEG);
  const sR = Math.sin(rollDeg * DEG), cR = Math.cos(rollDeg * DEG);
  const p = [
    P[0] - sT * 0.11738 - 0.065 * cY * sT - sY * 0.065 * cT - 0.0762 * cY * cP * sT - sY * cP * cT * 0.0762,
    cP * 0.0762 * cY * cT + 0.065 * cY * cT + cT * 0.11738 + P[1] - sY * 0.065 * sT - sY * cP * 0.0762 * sT,
    P[2] + 0.24 - sP * 0.0762,
  ];
  const v = [-(cP * sYT * V), cP * cYT * V, -(sP * V)];
  const a = cY * cR + sP * sY * sR;
  const b = sY * cR - cY * sP * sR;
  const w = [(cT * a - sT * b) * W, (cT * b + sT * a) * W, -(cP * sR * W)];
  return { p, v, w };
}

export const HALF_W = 0.7625, HALF_L = 1.37;

// Zone 1-9 on the player's half (1-3 short, 7-9 long), as in the official app.
function zoneOf(x, y) {
  const col = x > 0.254 ? 0 : x >= -0.254 ? 1 : 2;
  const row = y < 0.45 ? 0 : y < 0.92 ? 1 : 2;
  return row * 3 + col + 1;
}

/**
 * Flight and bounce loop shared by both robots (calMtBallTrajectory /
 * calBallTrajectory use the same model). Coordinates: origin at the net
 * centre, +y towards the player, z up, metres; robot half is y < 0.
 * Returns { code, points, bounce1, landing, netHeight }. code 1-9 is the
 * landing zone; 12 = net or missed the robot half, 14/15 = wide,
 * 17 = long, >= 201 = invalid.
 */
export function fly(init) {
  const dt = 0.001, c = 0.0015, k = 0.1196, g = -9.802;
  let [x, y, z] = init.p, [vx, vy, vz] = init.v;
  let w0 = init.w[0], w1 = init.w[1];
  const w2 = init.w[2] * c;
  let bounced = 0, bouncePending = false, crossedNet = false;
  const out = { code: 0, points: [], bounce1: null, landing: null, netHeight: null };
  const done = code => { out.code = code; return out; };

  for (let i = 0; ; i++) {
    const t = i * dt;
    out.points.push([t, x, y, z]);
    if (t > 3) return done(201);
    const sp = Math.hypot(vx, vy, vz);
    const vy1 = vy + ((w2 * vx - vy * sp * k) - w0 * c * vz) * dt;
    if (vy1 < 0) return done(202);
    const z1 = z + vz * dt;
    if (z1 > 1.5) return done(203);
    const x1 = x + vx * dt;
    if (x1 < -1) return done(15);
    if (x1 > 1) return done(14);
    const y1 = y + vy * dt;
    if (y1 > 1.8) return done(17);
    let vz1 = vz + ((w0 * c * vy + w1 * -c * vx) - vz * sp * k + g) * dt;

    if (vz1 < 0 && z1 < 0.02) {
      if (y1 < 0) {
        if (x1 < -HALF_W || x1 > HALF_W || y1 < -HALF_L) return done(12);
        if (bounced > 0) return done(12);
        out.bounce1 = [x, y];
        bouncePending = true;
      } else {
        if (y1 > HALF_L) return done(17);
        if (x1 < -HALF_W) return done(15);
        if (x1 > HALF_W) return done(14);
        out.landing = [x, y];
        return done(zoneOf(x, y));
      }
    }

    if (!crossedNet && y1 > 0) {
      if (z1 < 0.18) return done(12);
      crossedNet = true;
      out.netHeight = z1;
    }
    let vx1 = vx + (w1 * c * vz + (vx * sp * -k - w2 * vy)) * dt;
    let vyn = vy1;
    if (bouncePending) {
      const vxy = Math.hypot(vx1, vyn);
      const a = Math.abs(vz1) * 0.579 < vxy ? (Math.abs(vz1) * 0.2316) / vxy : 0.4;
      const nvy = vyn * (1 - a) - w0 * a * 0.02;
      const nvx = vx1 * (1 - a) + w1 * a * 0.02;
      const f = 1 - a * 1.5;
      w0 = vyn * ((a * -1.5) / 0.02) + w0 * f;
      w1 = vx1 * ((a * 1.5) / 0.02) + w1 * f;
      vz1 *= -0.93;
      if (vz1 < 0) return done(204);
      vx1 = nvx; vyn = nvy;
      bouncePending = false;
      bounced++;
    }
    x = x1; y = y1; z = z1;
    vx = vx1; vy = vyn; vz = vz1;
  }
}

/** Simulate one Nova ball (callMtBallTrajectoryByRotationType). bodyAngle overrides the position's robot yaw. */
export function simulate(ball, position = 10, bodyAngle = null) {
  const pos = ROBOT_POSITIONS[position] ?? ROBOT_POSITIONS[10];
  const P = [...pos.xyza];
  if (bodyAngle != null) P[3] = bodyAngle;
  const speed = clamp(ball.speed, 0, 10), spin = clamp(ball.spin, 0, 10);
  const rot = clamp(Math.round(ball.rot), 0, 7);
  const { up, down, ok } = wheelRpm(speed, spin, rot);
  if (!ok) return { code: 1000, points: [] };
  const pitch = ((clamp(ball.height, -50, 100) + 50) / 150) * 50 - 20;
  const yaw = ((clamp(ball.drop, -10, 10) + 10) / 20) * 44 - 22;
  return fly(initState(P, yaw, pitch, HEAD_ROLL[rot], up, down));
}

/** True when the simulated ball lands on the player's half. */
export const landsOnTable = r => r.code >= 1 && r.code <= 9;

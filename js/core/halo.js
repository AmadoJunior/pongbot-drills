// Halo S Pro parameter conversion and trajectory, ported from the official
// app's libball_trajectory.so (getCloudParams, getRobotParams, getUpDownSpeed,
// getVnormWnorm, getInitInfo, callBallTrajectory). The app never calls
// setControlParameters, so the library's built-in constants below apply.
// See re/FINDINGS.md.
import { fly } from './physics.js';

const KV = 0.0012, KW_UP = 0.0096, KW_DOWN = 0.0097;
const L1 = 0.0428, L2 = 0.128;
const PI = 3.14159265359, DEG = 0.01745329252;

// Robot positions (setRobotPosition): launch base [x, y, z] and the yaw
// offset added to every ball. 1 = behind the end line, 2/3 = beside the
// net on the player's left/right, aimed inwards.
export const HALO_POSITIONS = {
  1: { p: [0, -1.7242, 0.1972], yawOffset: 0 },
  2: { p: [0.82107, -0.6326, 0.1972], yawOffset: 26 },
  3: { p: [-0.82107, -0.6326, 0.1972], yawOffset: -26 },
};

export const HALO_FIELDS = {
  height: { min: -50, max: 100, step: 1 },
  drop: { min: -10, max: 10, step: 1 },
  speed: { min: 0, max: 10, step: 0.5 },
  spin: { min: 0, max: 10, step: 0.5 },
  freq: { min: 0, max: 100, step: 1 },
  reps: { min: 1, max: 200, step: 1 },
  rail: { min: -10, max: 10, step: 1 },
  angle: { min: 0, max: 359, step: 5 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Spin direction on the compass (0 = topspin, 90 = right, 180 = backspin,
// 270 = left) -> signed spin and head roll index 0-20 (getCloudParams).
function cloudParams(spin, angle) {
  let w = spin, a = angle;
  if (w === 0) { w = 0; a = 0; }
  else if (a === 0) w = -w;
  else {
    let d = 180;
    if (a <= 0 || a > 180) { w = -w; d = 360; }
    a -= d;
  }
  a = clamp(a, -180, 0);
  return { w: clamp(w, -100, 100), rollIndex: (a * 20) / -180 };
}

function upDownSpeed(V, W) {
  const kw = W >= 0 ? KW_DOWN : KW_UP;
  const fix = x => {
    x = clamp(x, -10000, 5000);
    return x > -15 && x < 15 ? (x <= 0 ? -15 : 15) : x;
  };
  return {
    up: fix(-(2 * PI * kw * V - KV * W) / (4 * PI * KV * kw)),
    down: fix(-(2 * PI * kw * V + KV * W) / (4 * PI * KV * kw)),
  };
}

function common(ball) {
  const { w, rollIndex } = cloudParams(clamp(ball.spin, 0, 10), ((Math.round(ball.angle ?? 0) % 360) + 360) % 360);
  return {
    V: (clamp(ball.speed, 0, 10) / 10) * 12 + 3,
    sw: ((clamp(w, -10, 10) + 10) / 20) * 200 - 100,
    roll: (clamp(rollIndex, 0, 20) / 20) * -180,
    pitch: ((clamp(ball.height, -50, 100) + 50) / 150) * 60 - 20,
    yaw: ((clamp(ball.drop, -10, 10) + 10) / 20) * 44 - 22,
  };
}

/** UI ball -> values for the 56-byte Halo ball record (getRobotParams). */
export function haloToRobot(ball, position = 1) {
  const c = common(ball);
  let { roll, sw } = c;
  if (roll < -135) {
    if (roll < -157.5) { roll = 0; sw = -sw; } else roll = -135;
  }
  const { up, down } = upDownSpeed(c.V, sw * 2 * PI);
  return {
    up: Math.trunc(up), down: Math.trunc(down), roll,
    pitch: c.pitch,
    yaw: c.yaw + (HALO_POSITIONS[position]?.yawOffset ?? 0),
    freq: clamp(ball.freq, 0, 100) / 100,
    reps: clamp(Math.round(ball.reps), 0, 200),
    rail: ((clamp(ball.rail ?? 0, -10, 10) + 10) / 20) * 1.6 - 0.8,
  };
}

/** Simulate one Halo ball (callBallTrajectory). Same flight model as the Nova. */
export function simulateHalo(ball, position = 1) {
  const pos = HALO_POSITIONS[position] ?? HALO_POSITIONS[1];
  const c = common(ball);
  const { up, down } = upDownSpeed(c.V, c.sw * 2 * PI);
  const V = KV * (-up - down);
  const W = -(down - up <= 0 ? KW_DOWN : KW_UP) * (down - up) * 2 * PI;
  const yaw = (c.yaw + pos.yawOffset) * DEG, pitch = c.pitch * DEG, roll = c.roll * DEG;
  const sY = Math.sin(yaw), cY = Math.cos(yaw), sP = Math.sin(pitch), cP = Math.cos(pitch);
  const sR = Math.sin(roll), cR = Math.cos(roll);
  const reach = L2 * cP - L1 * sP;
  const P = pos.p;
  return fly({
    p: [P[0] - sY * reach, P[1] + cY * reach, P[2] + L1 * cP + L2 * sP],
    v: [-cP * sY * V, cY * cP * V, sP * V],
    w: [(cY * cR - sY * sP * sR) * W, (cR * sY + cY * sP * sR) * W, -cP * sR * W],
  });
}

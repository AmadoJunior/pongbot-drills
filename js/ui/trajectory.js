// Ball prediction graphics: top view (player at the bottom, as seen from
// your side of the table) and side view, drawn from the ported official
// trajectory simulation. Varied balls show a cloud of sampled shots.
import { landsOnTable, ROBOT_POSITIONS } from '../core/physics.js';
import { HALO_POSITIONS } from '../core/halo.js';
import { simulateBall } from '../core/devices.js';
import { rollBall, hasVariation } from '../core/variation.js';

export const BALL_COLORS = ['#F4643C', '#4137C7', '#0DA1D4', '#11AA66', '#FFAC00', '#E0457B', '#8E5CF7', '#3D8BFD'];
export const ballColor = i => BALL_COLORS[i % BALL_COLORS.length];

// Percentage of varied shots that must land for the preview to show green.
export const GOOD_LAND_RATE = 80;

const HALF_W = 0.7625, HALF_L = 1.37, NET_H = 0.1525;

// Deterministic RNG so previews don't flicker between renders.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base trajectory plus sampled variations for one ball. `drill` gives device, position and body angle. */
export function traceBall(ball, drill, samples = 40) {
  const base = simulateBall(ball, drill);
  const out = { base, samples: [], landRate: landsOnTable(base) ? 1 : 0 };
  if (!hasVariation(ball)) return out;
  const rng = seeded(1234);
  let landed = 0;
  for (let i = 0; i < samples; i++) {
    const r = simulateBall(rollBall(ball, rng, drill.device), drill);
    if (landsOnTable(r)) landed++;
    out.samples.push(r);
  }
  out.landRate = landed / samples;
  return out;
}

export function describe(result) {
  const c = result.code;
  if (c >= 1 && c <= 9) return { ok: true, text: `Lands in zone ${c} (${['short', 'half-long', 'long'][Math.floor((c - 1) / 3)]})` };
  if (c === 12) return { ok: false, text: result.netHeight == null ? 'Does not clear the net' : 'Misses the table on the robot side' };
  if (c === 14 || c === 15) return { ok: false, text: 'Goes out wide' };
  if (c === 17) return { ok: false, text: 'Goes long' };
  if (c === 1000) return { ok: false, text: 'Spin too high for this speed' };
  return { ok: false, text: 'Not a valid trajectory' };
}

function setup(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

function strokePath(ctx, pts, map, color, width, alpha, dashed = false) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = ctx.lineCap = 'round';
  if (dashed) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [sx, sy] = map(p);
    if (i % 4 && i !== pts.length - 1) return;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
  ctx.restore();
}

function dot(ctx, x, y, r, color, filled = true, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (filled) { ctx.fillStyle = color; ctx.fill(); }
  ctx.strokeStyle = filled ? '#fff' : color;
  ctx.lineWidth = filled ? 1.2 : 1.6;
  ctx.stroke();
  ctx.restore();
}

/**
 * items: [{ trace, color, emphasis }] where emphasis 1 = selected, 0.35 = dimmed.
 * Returns the mapping so callers can place overlays.
 */
// Robot placement for drawing: [x, y, yawDeg] and whether it is a Halo.
function robotPose(drill) {
  if (drill.device === 'halo') {
    const h = HALO_POSITIONS[drill.position] ?? HALO_POSITIONS[1];
    return { x: h.p[0], y: h.p[1], yaw: h.yawOffset, halo: true };
  }
  const P = (ROBOT_POSITIONS[drill.position] ?? ROBOT_POSITIONS[10]).xyza;
  return { x: P[0], y: P[1], yaw: drill.bodyAngle ?? P[3], halo: false };
}

export function drawTopView(canvas, { drill, items = [], cssW = 150, showGrid = true }) {
  const X = 0.98, Y0 = drill.device === 'halo' ? -1.9 : -1.6, Y1 = 1.5;
  const scale = cssW / (2 * X);
  const cssH = Math.round((Y1 - Y0) * scale);
  const ctx = setup(canvas, cssW, cssH);
  const map = p => [(X - p[1]) * scale, (p[2] - Y0) * scale];
  const mapXY = (x, y) => [(X - x) * scale, (y - Y0) * scale];

  const [tx, ty] = mapXY(HALF_W, -HALF_L);
  const tw = 2 * HALF_W * scale, th = 2 * HALF_L * scale;
  ctx.fillStyle = '#1B1D21';
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(tx, ty, tw, th);
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(...mapXY(0, -HALF_L)); ctx.lineTo(...mapXY(0, HALF_L));
  ctx.stroke();
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath();
    for (const x of [0.254, -0.254]) { ctx.moveTo(...mapXY(x, 0)); ctx.lineTo(...mapXY(x, HALF_L)); }
    for (const y of [0.45, 0.92]) { ctx.moveTo(...mapXY(HALF_W, y)); ctx.lineTo(...mapXY(-HALF_W, y)); }
    ctx.stroke();
  }
  ctx.strokeStyle = '#E8E8E8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(...mapXY(HALF_W + 0.12, 0)); ctx.lineTo(...mapXY(-HALF_W - 0.12, 0));
  ctx.stroke();

  const pose = robotPose(drill);
  const [rx, ry] = mapXY(pose.x, pose.y);
  ctx.save();
  ctx.translate(rx, ry);
  ctx.rotate((-pose.yaw * Math.PI) / 180);
  if (pose.halo) {
    // Halo: free-standing robot, drawn as its black body with the orange head ring.
    const r = 0.11 * scale;
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-r, -r * 1.1, 2 * r, 2 * r, r * 0.35); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#F4643C';
    ctx.lineWidth = Math.max(2, r * 0.35);
    ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.55, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else {
    // Nova: ball hopper over the table edge, launch head on the table side.
    const rw = 0.2 * scale, rh = rw * 1.7;
    ctx.fillStyle = '#3a3f47';
    ctx.strokeStyle = '#6b7280';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(-rw / 2, -rh * 0.8, rw, rh * 0.55, rw * 0.12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.roundRect(-rw * 0.36, -rh * 0.25, rw * 0.72, rh * 0.25, rw * 0.1); ctx.fill();
    ctx.beginPath(); ctx.arc(0, rh * 0.08, rw * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();

  for (const it of items) {
    const a = it.emphasis ?? 1;
    for (const s of it.trace.samples.slice(0, 24)) {
      strokePath(ctx, s.points, map, it.color, 1, 0.18 * a);
      if (s.landing) dot(ctx, ...mapXY(...s.landing), 2, it.color, true, 0.6 * a);
    }
  }
  for (const it of items) {
    const a = it.emphasis ?? 1, b = it.trace.base;
    const ok = landsOnTable(b);
    strokePath(ctx, b.points, map, it.color, a >= 1 ? 2.4 : 1.6, Math.max(0.35, a), !ok);
    if (b.bounce1) dot(ctx, ...mapXY(...b.bounce1), 3, it.color, false, a);
    if (b.landing) dot(ctx, ...mapXY(...b.landing), a >= 1 ? 5 : 4, it.color, true, Math.max(0.5, a));
  }
  return { mapXY, cssH };
}

export function drawSideView(canvas, { drill, items = [], cssW = 200, cssH = 110 }) {
  const Y0 = drill.device === 'halo' ? -1.9 : -1.6, Y1 = 1.75;
  let zMax = 0;
  for (const it of items) for (const p of it.trace.base.points) zMax = Math.max(zMax, p[3] + 0.05);
  zMax = Math.min(Math.max(zMax, 0.3), 1.6);
  const pad = 10;
  // Heights are drawn at most 2x the horizontal scale. Filling the box instead
  // stretched them 3-4x and made every flat ball look like a loop.
  const MAX_Z_STRETCH = 2;
  const sx = (cssW - 2 * pad) / (Y1 - Y0), sz = Math.min(MAX_Z_STRETCH * sx, (cssH - 2 * pad) / zMax);
  const ctx = setup(canvas, cssW, cssH);
  const map = p => [pad + (p[2] - Y0) * sx, cssH - pad - p[3] * sz];
  const mapYZ = (y, z) => [pad + (y - Y0) * sx, cssH - pad - z * sz];

  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(...mapYZ(-HALF_L, 0)); ctx.lineTo(...mapYZ(HALF_L, 0)); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(...mapYZ(0, 0)); ctx.lineTo(...mapYZ(0, NET_H)); ctx.stroke();
  const pose = robotPose(drill);
  const [rx, ry] = mapYZ(pose.y, 0);
  const rh = (pose.halo ? 0.2 : 0.24) * sz;
  ctx.fillStyle = '#C9CDD4';
  if (pose.halo) {
    // Free-standing: body reaches down to the floor below the table edge.
    ctx.fillRect(rx - 7, ry - rh, 14, cssH - (ry - rh));
  } else {
    ctx.fillRect(rx - 6, ry - rh, 12, rh);
  }
  ctx.beginPath(); ctx.arc(rx + 4, ry - rh, 6, 0, Math.PI * 2); ctx.fill();

  for (const it of items) {
    const a = it.emphasis ?? 1;
    for (const s of it.trace.samples.slice(0, 24)) strokePath(ctx, s.points, map, it.color, 1, 0.18 * a);
  }
  for (const it of items) {
    const a = it.emphasis ?? 1, b = it.trace.base;
    strokePath(ctx, b.points, map, it.color, a >= 1 ? 2.4 : 1.6, Math.max(0.35, a), !landsOnTable(b));
    if (b.landing) dot(ctx, ...mapYZ(b.landing[1], 0), 3.5, it.color, true, Math.max(0.5, a));
    if (b.bounce1) dot(ctx, ...mapYZ(b.bounce1[1], 0), 3, it.color, false, a);
  }
}

// Drill data model, persistence and import/export.
//
// A drill mirrors an official custom drill: robot model, robot position,
// (Nova) manual head position and a list of balls. Ball fields use the
// official UI units (official JSON keys in brackets): height [pa],
// rot [pr] (Nova spin direction 0-7), angle [ra] (Halo spin direction in
// degrees), drop [ya], speed [us], spin [ds], freq [fr], reps [cs],
// rail [sp] (Halo). `vary` is new: a ± range per field, rolled every shot.
import { HEAD_POSITIONS, headForType } from './physics.js';
import { DEVICES, deviceOf } from './devices.js';

const STORAGE_KEY = 'novaplus.drills.v1';
export const MAX_TITLE = 35;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Nova rotation type <-> spin direction on the compass (0 = topspin, clockwise).
export const ROT_ANGLE = [0, 45, 315, 270, 225, 180, 135, 90];
const angDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
export const angleToRot = a => ROT_ANGLE.reduce((best, x, i) => (angDist(a, x) < angDist(a, ROT_ANGLE[best]) ? i : best), 0);

export function newBall(position = 10, rot = 0, device = 'nova') {
  const d = deviceOf(device).defaults(position);
  return {
    height: d.height, rot, angle: ROT_ANGLE[rot], drop: 0, speed: d.speed, spin: 0, freq: 50, reps: 1, rail: 0,
    vary: { speed: 0, spin: 0, height: 0, drop: 0, rail: 0 },
  };
}

export function newDrill(position = 10, head = 2, device = 'nova') {
  const types = (HEAD_POSITIONS.find(h => h.key === head) ?? HEAD_POSITIONS[0]).types;
  return {
    id: uid(), name: '', device, position, head, bodyAngle: null,
    balls: [newBall(position, types[0], device)],
    mode: 'groups', groups: 10, minutes: 5, sequence: 'sequential',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function normalizeBall(b, device = 'nova') {
  const F = deviceOf(device).fields;
  const num = (v, field, fallback = 0) => {
    const { min, max } = F[field];
    const n = Number(v ?? fallback);
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
  };
  const hasAngle = b.angle != null && Number.isFinite(Number(b.angle));
  const angle = hasAngle ? ((Math.round(Number(b.angle)) % 360) + 360) % 360 : null;
  const rot = b.rot == null && hasAngle ? angleToRot(angle) : Math.min(7, Math.max(0, Math.round(Number(b.rot) || 0)));
  const ball = {
    height: num(b.height, 'height'), rot, angle: angle ?? ROT_ANGLE[rot],
    drop: num(b.drop, 'drop'), speed: num(b.speed, 'speed'), spin: num(b.spin, 'spin'),
    freq: num(b.freq, 'freq', 50), reps: num(b.reps, 'reps', 1), rail: device === 'halo' ? num(b.rail, 'rail') : 0,
    vary: {},
  };
  for (const f of ['speed', 'spin', 'height', 'drop', 'rail']) ball.vary[f] = Math.max(0, Number(b.vary?.[f]) || 0);
  if (Array.isArray(b.leds)) ball.leds = b.leds;
  return ball;
}

export function normalizeDrill(d) {
  const device = DEVICES[d.device] ? d.device : 'nova';
  const dev = DEVICES[device];
  const balls = (d.balls ?? []).map(b => normalizeBall(b, device));
  const body = d.bodyAngle == null ? NaN : Number(d.bodyAngle);
  return {
    id: d.id ?? uid(), name: String(d.name ?? '').slice(0, MAX_TITLE), device,
    position: dev.positions.includes(Number(d.position)) ? Number(d.position) : dev.defaultPosition,
    bodyAngle: device === 'nova' && Number.isFinite(body) ? body : null,
    head: d.head ?? headForType(balls[0]?.rot ?? 0).key,
    balls, mode: d.mode === 'time' ? 'time' : 'groups',
    groups: Math.max(1, Number(d.groups) || 10), minutes: Math.max(1, Number(d.minutes) || 5),
    sequence: d.sequence === 'random' ? 'random' : 'sequential',
    createdAt: d.createdAt ?? Date.now(), updatedAt: d.updatedAt ?? Date.now(),
  };
}

export function loadDrills() {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? []).map(normalizeDrill);
  } catch {
    return [];
  }
}

export function saveDrills(drills) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drills));
}

export function exportJson(drills) {
  return JSON.stringify({ app: 'novaplus', version: 1, drills }, null, 1);
}

/** Import any supported format; returns a list of drills. */
export function importText(text) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return importJson(JSON.parse(t));
  return importOlangaCsv(t);
}

function importJson(data) {
  if (data.app === 'novaplus') return data.drills.map(d => normalizeDrill({ ...d, id: undefined }));
  return importOfficial(data);
}

// Official account dump (tools/import_official.py): rows with groupName,
// devicePosition, model ('nova'/'halo' from the product series), the Nova
// body `angle`, and the drill detail holding the ball list (pa/pr/ya/us/ds/
// fr/cs, plus ra/sp/led* on the Halo).
function findBalls(obj, depth = 0) {
  if (depth > 6 || obj == null) return null;
  if (typeof obj === 'string') {
    const t = obj.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return null;
    try { return findBalls(JSON.parse(t), depth + 1); } catch { return null; }
  }
  if (Array.isArray(obj)) {
    if (obj.length && obj.every(o => o && typeof o === 'object' && ('us' in o || 'pa' in o))) return obj;
    for (const o of obj) { const r = findBalls(o, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of ['groupJsonStr', 'paramsData', 'groupJson', 'params', 'balls', 'list']) {
      const r = findBalls(obj[k], depth + 1);
      if (r) return r;
    }
    for (const v of Object.values(obj)) { const r = findBalls(v, depth + 1); if (r) return r; }
  }
  return null;
}

const ledsOf = b => [1, 2, 3, 4].map(i => ({ rgb: Number(b[`led${i}_rgb`] ?? 0x1000000), flicker: Number(b[`led${i}_flicker`] ?? 0) }));

// The Halo cloud stores getCloudParams output: ds = signed spin (negative =
// topspin side), ra = head roll index 0-20. Inverse of getCloudParams, as in
// the native getRotationTypeParams (which truncates; rounding keeps the
// angle the user set).
function haloSpinFromCloud(ds, ra) {
  const w = Number(ds) || 0;
  if (w === 0) return { spin: 0, angle: 0 };
  const a = (Number(ra) || 0) / 20 * -180 + (w > 0 ? 180 : 360);
  return { spin: Math.abs(w), angle: Math.round(a) % 360 };
}

function importOfficial(data) {
  const rows = Array.isArray(data) ? data : data.rows ?? data.data?.rows ?? data.data ?? [];
  return rows.map(row => {
    const device = row.model === 'halo' || /^O58|HALO/i.test(String(row.productSeries ?? '')) ? 'halo' : 'nova';
    const balls = findBalls(row.detail) ?? findBalls(row) ?? [];
    const mapped = balls.map(b => ({
      height: b.pa, drop: b.ya, speed: b.us, freq: b.fr, reps: b.cs, rail: b.sp,
      ...(device === 'halo' ? haloSpinFromCloud(b.ds, b.ra) : { rot: b.pr, spin: b.ds }),
      leds: device === 'halo' && 'led1_rgb' in b ? ledsOf(b) : undefined,
    }));
    const angle = Number(row.angle);
    return normalizeDrill({
      name: row.groupName ?? row.name, device, position: Number(row.devicePosition),
      bodyAngle: device === 'nova' && Number.isFinite(angle) && angle !== 0 ? angle : null,
      balls: mapped,
    });
  }).filter(d => d.balls.length);
}

// olanga/nova CSV: Set;Ball;Name;Speed;Spin;Type;Height;Drop;Freq|BPM;Reps.
// Variants (rows sharing a ball number) are folded into one ball whose ±
// ranges cover all variants.
function importOlangaCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = lines.shift().split(';').map(h => h.trim().toLowerCase());
  const bpm = header[8] === 'bpm';
  const drills = new Map();
  for (const line of lines) {
    const p = line.split(';');
    if (p.length < 10) continue;
    const name = p[2].trim();
    const key = `${p[0]}|${name}`;
    if (!drills.has(key)) drills.set(key, { name, slots: new Map() });
    const slots = drills.get(key).slots;
    const slot = Number(p[1]);
    const freq = bpm ? (Number(p[8]) - 30) / 0.6 : Number(p[8]);
    const ball = normalizeBall({
      speed: p[3], spin: p[4], rot: p[5].trim() === 'back' ? 5 : 0,
      height: p[6], drop: p[7], freq: Math.round(freq / 10) * 10, reps: p[9],
    });
    if (!slots.has(slot)) slots.set(slot, []);
    slots.get(slot).push(ball);
  }
  return [...drills.values()].map(({ name, slots }) => normalizeDrill({
    name, position: 10, head: 2,
    balls: [...slots.keys()].sort((a, b) => a - b).map(k => foldVariants(slots.get(k))),
  }));
}

function foldVariants(variants) {
  if (variants.length === 1) return variants[0];
  const ball = { ...variants[0], vary: { ...variants[0].vary } };
  for (const f of ['speed', 'spin', 'height', 'drop']) {
    const vals = variants.map(v => v[f]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const step = DEVICES.nova.fields[f].step;
    ball[f] = Math.round((lo + hi) / 2 / step) * step;
    ball.vary[f] = Math.ceil((hi - lo) / 2 / step) * step;
  }
  return ball;
}

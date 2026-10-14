// Display labels (official English strings where they exist).
import { ROTATION_TYPES, HEAD_POSITIONS } from '../core/physics.js';
import { deviceOf } from '../core/devices.js';
import { fmt } from './dom.js';

export const rotLabel = code => ROTATION_TYPES[code]?.label ?? '?';

// Compass names from the official spin-direction dial, clockwise from the top.
export const COMPASS = ['Top Spin', 'Top Right', 'Right Spin', 'Under Right', 'Under Spin', 'Under Left', 'Left Spin', 'Top Left'];
export const compassLabel = angle => {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  const name = COMPASS[Math.round(a / 45) % 8];
  return a % 45 === 0 ? name : `${name} (${a}°)`;
};

/** Spin direction of a ball on its robot. */
export const spinLabel = (ball, device) => (deviceOf(device).id === 'halo' ? compassLabel(ball.angle) : rotLabel(ball.rot));

export const headLabel = key => {
  const h = HEAD_POSITIONS.find(x => x.key === key) ?? HEAD_POSITIONS[0];
  return h.types.map(rotLabel).join(' / ');
};

export function positionLabel(p, device = 'nova') {
  if (deviceOf(device).id === 'halo') return `Position ${p}`;
  return p === 10 ? 'Standard' : p === 11 ? 'Near-Net' : `Position ${p}`;
}

const withVary = (v, r, step) => fmt(v, step) + (r > 0 ? `±${fmt(r, step)}` : '');

export function ballSummary(b, device = 'nova') {
  return [
    `Speed ${withVary(b.speed, b.vary.speed, 0.5)}`,
    `Spin ${withVary(b.spin, b.vary.spin, 0.5)}`,
    `Height ${withVary(b.height, b.vary.height, 1)}`,
    `Drop ${withVary(b.drop, b.vary.drop, 1)}`,
    deviceOf(device).rail ? `Rail ${withVary(b.rail, b.vary.rail, 1)}` : '',
    `Freq ${b.freq}`,
    b.reps > 1 ? `×${b.reps}` : '',
  ].filter(Boolean).join(' · ');
}

// Robot models and what differs between them.
import { FIELDS, ROBOT_POSITIONS, simulate, maxSpin } from './physics.js';
import { HALO_FIELDS, HALO_POSITIONS, simulateHalo } from './halo.js';

export const DEVICES = {
  nova: {
    id: 'nova', name: 'Nova S Pro',
    positions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], defaultPosition: 10,
    manualHead: true,   // spin axis set by turning the head by hand: 2 spin directions per drill
    rail: false,
    fields: FIELDS,
    variable: ['speed', 'spin', 'height', 'drop'],
    defaults: p => ({ height: ROBOT_POSITIONS[p]?.height ?? 50, speed: ROBOT_POSITIONS[p]?.speed ?? 3 }),
  },
  halo: {
    id: 'halo', name: 'Halo S Pro',
    positions: [1, 2, 3], defaultPosition: 1,
    manualHead: false,  // motorised head roll: any spin direction per ball
    rail: true,
    fields: HALO_FIELDS,
    variable: ['speed', 'spin', 'height', 'drop', 'rail'],
    defaults: p => (p === 1 ? { height: 20, speed: 4 } : { height: 20, speed: 3 }),
  },
};

export const deviceOf = drillOrId => DEVICES[typeof drillOrId === 'string' ? drillOrId : drillOrId?.device] ?? DEVICES.nova;

/** Device model from the robot's Bluetooth name (official prefixes NOVA_ / HALO_). */
export const deviceFromName = name => (/^HALO/i.test(name ?? '') ? 'halo' : 'nova');

export function maxSpinFor(device, speed) {
  return deviceOf(device).id === 'nova' ? maxSpin(speed) : HALO_FIELDS.spin.max;
}

/** Simulate a ball for a drill (device, position and Nova body angle). */
export function simulateBall(ball, drill) {
  if (deviceOf(drill).id === 'halo') return simulateHalo(ball, HALO_POSITIONS[drill.position] ? drill.position : 1);
  return simulate(ball, drill.position, drill.bodyAngle ?? null);
}

// Entry point: robot connection, header and hash router.
import { createRobot, BleRobot, MockRobot } from './ble.js';
import { Runner } from './runner.js';
import { STATE } from './core/protocol.js';
import { store } from './store.js';
import { $, toast, confirmDialog } from './ui/dom.js';
import * as drillsScreen from './ui/screens/drills.js';
import * as positionScreen from './ui/screens/position.js';
import * as headScreen from './ui/screens/head.js';
import * as comboScreen from './ui/screens/combo.js';
import * as ballScreen from './ui/screens/ball.js';
import * as prepScreen from './ui/screens/prep.js';
import * as servingScreen from './ui/screens/serving.js';
import * as settingsScreen from './ui/screens/settings.js';

export const robot = createRobot();
export const runner = new Runner(robot);

// Pattern -> screen. Params come from the hash path.
const routes = [
  [/^#?\/?$/, drillsScreen],
  [/^#\/(new|edit)\/position$/, positionScreen, ['mode']],
  [/^#\/(new|edit)\/head$/, headScreen, ['mode']],
  [/^#\/edit$/, comboScreen],
  [/^#\/edit\/ball\/(\d+)$/, ballScreen, ['index']],
  [/^#\/prep\/([\w]+)$/, prepScreen, ['id']],
  [/^#\/serving$/, servingScreen],
  [/^#\/settings$/, settingsScreen],
];

let current = null;

export function go(hash, { replace = false } = {}) {
  if (replace) location.replace(hash); else location.hash = hash;
}

export function back() {
  if (history.length > 1) history.back(); else go('#/', { replace: true });
}

async function render() {
  const hash = location.hash || '#/';
  for (const [re, screen, names = []] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    current?.cleanup?.();
    const params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    const view = $('#view');
    view.innerHTML = '';
    window.scrollTo(0, 0);
    current = { screen, cleanup: null };
    const ctx = {
      params, robot, runner, go, back, connect, start,
      setTitle: t => { $('#title').textContent = t; },
      setBack: (show, handler) => { backHandler = handler ?? null; $('#btn-back').hidden = !show; },
    };
    ctx.setBack(hash !== '#/');
    current.cleanup = await screen.render(view, ctx);
    return;
  }
  go('#/', { replace: true });
}

let backHandler = null;
$('#btn-back').addEventListener('click', () => (backHandler ? backHandler() : back()));
window.addEventListener('hashchange', render);

function updateConn() {
  const btn = $('#btn-conn'), label = $('#conn-label');
  btn.className = 'conn ' + robot.connection;
  if (robot.connection === 'ready') {
    const busy = runner.active;
    if (busy) btn.classList.add('busy');
    label.textContent = robot.state === STATE.paused ? 'Paused' : busy ? 'In Use' : 'Available';
  } else {
    label.textContent = robot.connection === 'connecting' ? 'Connecting…' : 'Offline';
  }
}

robot.addEventListener('connection', e => {
  updateConn();
  if (e.detail === 'ready') {
    toast(`Connected to ${robot.name}`);
    if (robot.model && robot.model !== store.settings.device) {
      store.settings.device = robot.model;
      store.saveSettings();
      if ((location.hash || '#/') === '#/') render();
    }
  }
  if (e.detail === 'disconnected') toast('Robot disconnected');
});
robot.addEventListener('message', updateConn);
runner.addEventListener('update', updateConn);

export async function connect() {
  if (robot.connection !== 'disconnected') return robot.connection === 'ready';
  if (robot instanceof BleRobot && !BleRobot.supported) {
    toast('Web Bluetooth is not available. Use Chrome or Edge on Android/Windows, or open with ?mock to try the simulator.', 5000);
    return false;
  }
  try {
    await robot.connect();
    return true;
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast('Connection failed: ' + (e?.message ?? e));
    return false;
  }
}

/** Connects if needed and starts a session; shows a toast and returns false on failure. */
async function start(drill, kind, ballIndex = 0, opts = {}) {
  if (!await connect()) return false;
  try {
    runner.start(structuredClone(drill), kind, ballIndex, opts);
    return true;
  } catch (e) {
    toast(e.message, 4000);
    return false;
  }
}

$('#btn-conn').addEventListener('click', async () => {
  if (robot.connection === 'ready') {
    if (!runner.active && await confirmDialog('Disconnect', 'Disconnect from the robot?', 'Disconnect')) robot.disconnect();
    return;
  }
  connect();
});

if (robot instanceof MockRobot) document.title += ' (simulator)';
updateConn();
render();

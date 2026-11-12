// Robot connection over Web Bluetooth, plus a simulated robot for testing
// without hardware (open the app with ?mock, or ?mock=halo).
import {
  SERVICE_ADV, SERVICE, CHAR_WRITE, CHAR_NOTIFY, CMD, STATE, authResponse, parseNotification,
  haloFrame, haloUnframe, HALO_CHUNK, assertSendable,
} from './core/protocol.js';
import { deviceFromName } from './core/devices.js';

const HEARTBEAT_MS = 10000;

// Connection tracing that works on a phone, where there is no console. Every
// line is kept in localStorage (so it survives the disconnect and reload) and
// shown in a floating on-screen panel with Copy/Clear. A disconnect can thus
// be told apart from the firmware's 9s sign-in watchdog after the fact.
// On by default; silence with window.bleTrace = false or ?trace=off.
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');
const LOG_KEY = 'bleLog';
const LOG_CAP = 400;

function traceEnabled() {
  if (globalThis.bleTrace === false) return false;
  if (globalThis.bleTrace === true) return true;
  try { return new URLSearchParams(location.search).get('trace') !== 'off'; } catch { return true; }
}

let logLines = [];
try { logLines = JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { logLines = []; }
let logBody = null;

function logPersist() {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(logLines.slice(-LOG_CAP))); } catch { /* quota/private */ }
}

function logCopy() {
  const text = logLines.join('\n');
  try {
    navigator.clipboard?.writeText(text);
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
}

function mountLogPanel() {
  if (logBody || typeof document === 'undefined' || !document.body || !traceEnabled()) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace';
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;background:#111;color:#4ade80;padding:5px 10px';
  const title = document.createElement('span');
  title.style.cssText = 'flex:1;font-weight:bold';
  const body = document.createElement('div');
  body.style.cssText = 'max-height:42vh;overflow:auto;background:rgba(0,0,0,.92);color:#e5e7eb;padding:6px 10px;white-space:pre-wrap;word-break:break-all';
  let open = false;
  try { open = localStorage.getItem('bleLogOpen') === '1'; } catch { /* ignore */ }
  const refreshTitle = () => { title.textContent = `BLE trace (${logLines.length}) ${open ? '▼' : '▲'}`; };
  const setOpen = o => { open = o; body.style.display = o ? 'block' : 'none'; try { localStorage.setItem('bleLogOpen', o ? '1' : '0'); } catch { /* ignore */ } refreshTitle(); };
  title.onclick = () => setOpen(!open);
  const mkBtn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'background:#333;color:#fff;border:0;border-radius:4px;padding:3px 8px'; b.onclick = fn; return b; };
  bar.append(title, mkBtn('Copy', logCopy), mkBtn('Clear', () => { logLines = []; logPersist(); body.textContent = ''; refreshTitle(); }));
  wrap.append(bar, body);
  document.body.appendChild(wrap);
  logBody = body;
  body.textContent = logLines.join('\n');
  setOpen(open);
  body.scrollTop = body.scrollHeight;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLogPanel);
  else mountLogPanel();
}

function makeTrace() {
  let t0 = 0;
  return (...a) => {
    if (!traceEnabled()) return;
    if (a[0] === 'reset') { t0 = performance.now(); return; }
    const line = `[+${((performance.now() - t0) / 1000).toFixed(2)}s] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
    console.log('[ble]', line);
    logLines.push(line);
    if (logLines.length > LOG_CAP) logLines = logLines.slice(-LOG_CAP);
    logPersist();
    mountLogPanel();
    if (logBody) { logBody.textContent = logLines.join('\n'); logBody.scrollTop = logBody.scrollHeight; }
  };
}

class RobotBase extends EventTarget {
  constructor() {
    super();
    this.connection = 'disconnected'; // disconnected | connecting | ready
    this.state = null;                // last STATE.* reported by the robot
    this.name = '';
    this.model = null;                // 'nova' | 'halo', from the Bluetooth name
  }

  setConnection(c) {
    this.connection = c;
    this.dispatchEvent(new CustomEvent('connection', { detail: c }));
  }

  handle(bytes) {
    const msg = parseNotification(haloUnframe(bytes));
    if (msg.type === 'status') this.state = msg.state;
    this.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }
}

export class BleRobot extends RobotBase {
  #device = null;
  #write = null;
  #step = 'idle';
  #queue = Promise.resolve();
  #heartbeat = null;
  #trace = makeTrace();

  static get supported() {
    return 'bluetooth' in navigator;
  }

  async connect() {
    this.setConnection('connecting');
    this.#trace('reset');
    try {
      this.#device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_ADV] }, { namePrefix: 'NOVA' }, { namePrefix: 'HALO' }],
        optionalServices: [SERVICE],
      });
      this.name = this.#device.name ?? 'Nova S Pro';
      this.model = deviceFromName(this.name);
      this.#trace('chosen', this.name, '->', this.model);
      this.#device.addEventListener('gattserverdisconnected', () => this.#onDisconnect());
      const server = await this.#device.gatt.connect();
      this.#trace('gatt connected');
      const service = await server.getPrimaryService(SERVICE);
      for (const c of await service.getCharacteristics()) {
        if (c.uuid === CHAR_NOTIFY) {
          await c.startNotifications();
          this.#trace('notifications on', CHAR_NOTIFY);
          c.addEventListener('characteristicvaluechanged', e => this.#onNotify(e.target.value));
        }
        if (c.uuid === CHAR_WRITE) this.#write = c;
      }
      if (!this.#write) throw new Error('write characteristic not found');
      this.#step = 'access';
      this.#trace('-> access: sending accessInfo (0x07)');
      await this.send(CMD.accessInfo);
      this.#trace('accessInfo written, awaiting challenge');
    } catch (e) {
      this.#trace('connect() threw', e?.message ?? e);
      this.setConnection('disconnected');
      throw e;
    }
  }

  disconnect() {
    this.#device?.gatt?.disconnect();
  }

  send(bytes) {
    let data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    assertSendable(this.model, data);
    // The Halo wraps every command in a CRC frame, written in 252-byte chunks.
    const chunks = [];
    if (this.model === 'halo') {
      data = haloFrame(data);
      for (let i = 0; i < data.length; i += HALO_CHUNK) chunks.push(data.slice(i, i + HALO_CHUNK));
    } else {
      chunks.push(data);
    }
    for (const c of chunks) {
      this.#queue = this.#queue.then(() => this.#write?.writeValue(c)).catch(e => this.#trace('BLE write failed', e?.message ?? e));
    }
    return this.#queue;
  }

  #onNotify(dv) {
    const raw = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this.#trace(`notify @${this.#step}`, hex(raw));
    const bytes = this.#step === 'ready' ? raw : haloUnframe(raw);
    // Handshake: access info -> MD5 reply -> 01 00 00 -> 02 00 00 -> wake.
    switch (this.#step) {
      case 'access': {
        const text = new TextDecoder().decode(bytes);
        if (text.length > 18) {
          this.#step = 'verify';
          this.send(authResponse(text));
        }
        return;
      }
      case 'verify': this.#step = 'info'; this.send(CMD.verified1); return;
      case 'info': this.#step = 'status'; this.send(CMD.verified2); return;
      case 'status':
        this.#step = 'ready';
        this.send(CMD.wake);
        this.#heartbeat = setInterval(() => this.send(CMD.heartbeat), HEARTBEAT_MS);
        this.setConnection('ready');
        return;
    }
    this.handle(bytes);
  }

  #onDisconnect() {
    this.#trace(`gattserverdisconnected (was @${this.#step})`);
    clearInterval(this.#heartbeat);
    this.#write = null;
    this.#step = 'idle';
    this.state = null;
    this.model = null;
    this.setConnection('disconnected');
  }
}

// Simulated robot: fires balls at the programmed frequency and reports
// progress and completion like the real one.
export class MockRobot extends RobotBase {
  #balls = [];
  #mode = 1;
  #modeValue = 1;
  #timer = null;
  #index = 0;
  #group = 0;
  #rep = 0;
  #started = 0;
  #paused = false;
  #ballSize = 24;

  static get supported() {
    return true;
  }

  async connect() {
    this.setConnection('connecting');
    await new Promise(r => setTimeout(r, 400));
    this.model = new URLSearchParams(location.search).get('mock') === 'halo' ? 'halo' : 'nova';
    this.name = `${this.model === 'halo' ? 'Halo' : 'Nova'} S Pro (simulated)`;
    this.state = STATE.standby2;
    this.setConnection('ready');
  }

  disconnect() {
    clearTimeout(this.#timer);
    this.setConnection('disconnected');
  }

  async send(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    assertSendable(this.model, b);
    this.#ballSize = this.model === 'halo' ? 56 : 24;
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b[0] === 0x81) {
      this.#mode = b[3];
      this.#modeValue = v.getUint16(4, true);
      this.#balls = this.#readBalls(b, 7);
      this.#index = 0; this.#group = 0; this.#rep = 0; this.#paused = false;
      this.#started = Date.now();
      this.#emit([0, 0x81, 0, 0]);
      this.#emit([0, 2, 3, 0, STATE.active, 1, 0]);
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#fire(), 600);
    } else if (b[0] === 0x84) {
      this.#balls = this.#readBalls(b, 3);
      this.#index %= this.#balls.length;
    } else if (b[0] === 0x80) {
      const c = b[3];
      if (c === 1) { clearTimeout(this.#timer); this.#emit([0, 2, 3, 0, STATE.standby2, 1, 0]); }
      if (c === 2) { this.#paused = true; clearTimeout(this.#timer); this.#emit([0, 2, 3, 0, STATE.paused, 1, 0]); }
      if (c === 3 && this.#paused) { this.#paused = false; this.#emit([0, 2, 3, 0, STATE.active, 1, 0]); this.#fire(); }
      this.#emit([0, 0x80, 0, 0]);
    }
  }

  #readBalls(b, off) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const out = [];
    const n = this.#ballSize, fo = n === 56 ? 20 : 16, ro = n === 56 ? 24 : 20;
    for (let o = off; o + n <= b.length; o += n) {
      // Halo freq is 0-1 (balls/s - 0.5 on the Nova scale).
      const f = v.getFloat32(o + fo, true);
      out.push({ freq: n === 56 ? f + 0.5 : f, reps: v.getUint32(o + ro, true) });
    }
    return out;
  }

  #fire() {
    if (this.#paused || !this.#balls.length) return;
    const ball = this.#balls[this.#index];
    const p = new Uint8Array(10);
    const pv = new DataView(p.buffer);
    p.set(this.model === 'halo' ? [0, 0x0b, 6, 0] : [0, 5, 7, 0]);
    pv.setUint16(4, this.#group + 1, true);
    pv.setUint16(6, Math.floor((Date.now() - this.#started) / 1000), true);
    pv.setUint16(8, this.#index + 1, true);
    this.#emit(p);
    if (++this.#rep >= ball.reps) {
      this.#rep = 0;
      if (++this.#index >= this.#balls.length) { this.#index = 0; this.#group++; }
    }
    const timeUp = this.#mode === 0 && Date.now() - this.#started >= this.#modeValue * 60000;
    const groupsDone = this.#mode === 1 && this.#group >= this.#modeValue;
    const wait = 1000 / Math.max(0.5, ball.freq);
    this.#timer = setTimeout(() => {
      if (timeUp || groupsDone) this.#emit([0, 2, 3, 0, STATE.complete, 1, 0]);
      else this.#fire();
    }, wait);
  }

  #emit(arr) {
    queueMicrotask(() => this.handle(new Uint8Array(arr)));
  }
}

export function createRobot() {
  return new URLSearchParams(location.search).has('mock') ? new MockRobot() : new BleRobot();
}

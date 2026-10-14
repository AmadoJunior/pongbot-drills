// Reusable form controls.
import { esc, fmt } from './dom.js';

const snap = (v, step, min, max) => Math.min(max, Math.max(min, Math.round(v / step) * step));

/**
 * Parameter row: label, value, -/+ buttons and a slider. With `vary`, adds a
 * "±" toggle that reveals a second stepper for the random range.
 * opts: { label, value, min, max, step, format, vary, varyMax, varyStep, onChange, onVary }
 */
export function paramRow(opts) {
  const el = document.createElement('div');
  el.className = 'param';
  const format = opts.format ?? (v => fmt(v, opts.step));
  let value = opts.value, max = opts.max, vary = opts.vary ?? null, open = (vary ?? 0) > 0;

  el.innerHTML = `
    <div class="param-head">
      <div class="param-label">${esc(opts.label)}</div>
      ${vary !== null ? '<button class="vary-btn" data-act="vary">±</button>' : ''}
      <button class="step-btn" data-act="dec">−</button>
      <div class="param-value"></div>
      <button class="step-btn" data-act="inc">+</button>
    </div>
    <input type="range">
    ${vary !== null ? `<div class="vary-row" hidden>
      <div class="param-label">Random ± range, rolled every shot</div>
      <button class="step-btn" data-act="vdec">−</button>
      <div class="param-value vary-value"></div>
      <button class="step-btn" data-act="vinc">+</button>
    </div>` : ''}`;
  const range = el.querySelector('input[type=range]');
  const valueEl = el.querySelector('.param-head .param-value');
  const varyBtn = el.querySelector('[data-act=vary]');
  const varyRow = el.querySelector('.vary-row');

  function paint() {
    range.min = opts.min; range.max = max; range.step = opts.step; range.value = value;
    valueEl.innerHTML = esc(format(value)) + (vary > 0 ? `<small>±${esc(fmt(vary, opts.varyStep ?? opts.step))}</small>` : '');
    if (varyBtn) {
      varyBtn.classList.toggle('on', vary > 0);
      varyRow.hidden = !open;
      varyRow.querySelector('.vary-value').textContent = '±' + fmt(vary, opts.varyStep ?? opts.step);
    }
  }

  function set(v) {
    const nv = snap(v, opts.step, opts.min, max);
    if (nv === value) return paint();
    value = nv;
    paint();
    opts.onChange?.(value);
  }

  function setVary(v) {
    const vs = opts.varyStep ?? opts.step;
    const nv = snap(v, vs, 0, opts.varyMax);
    if (nv === vary) return;
    vary = nv;
    paint();
    opts.onVary?.(vary);
  }

  el.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const vs = opts.varyStep ?? opts.step;
    if (act === 'dec') set(value - opts.step);
    if (act === 'inc') set(value + opts.step);
    if (act === 'vary') { open = !open; paint(); }
    if (act === 'vdec') setVary(vary - vs);
    if (act === 'vinc') setVary(vary + vs);
  });
  range.addEventListener('input', () => set(Number(range.value)));
  paint();

  el.update = (v, newMax = max) => { max = newMax; value = snap(v, opts.step, opts.min, max); paint(); };
  return el;
}

/** Segmented control. options: [{ value, label }]. */
export function segmented(options, value, onChange) {
  const el = document.createElement('div');
  el.className = 'seg';
  const paint = () => {
    el.innerHTML = options.map(o => `<button data-v="${esc(o.value)}" class="${String(o.value) === String(value) ? 'on' : ''}">${esc(o.label)}</button>`).join('');
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const o = options.find(x => String(x.value) === b.dataset.v);
    value = o.value;
    paint();
    onChange(value);
  });
  paint();
  return el;
}

/**
 * Circular spin-direction dial (0° = topspin at the top, clockwise), laid
 * out like the official compass. Drag the handle or tap a direction.
 * opts: { value, step, detents (angles that are selectable, default all),
 *         enabled (angles shown as available), onChange, onBlocked }
 * With `detents`, the value snaps to the nearest detent; tapping a detent
 * that is not `enabled` calls onBlocked(angle) instead of changing.
 */
export function compassDial(opts) {
  const el = document.createElement('div');
  el.className = 'dial';
  const size = 240, c = size / 2, R = 78;
  let value = opts.value;
  const names = ['Top Spin', 'Top Right', 'Right Spin', 'Under Right', 'Under Spin', 'Under Left', 'Left Spin', 'Top Left'];
  const enabled = a => !opts.enabled || opts.enabled.includes(a);
  const pt = (a, r) => [c + r * Math.sin((a * Math.PI) / 180), c - r * Math.cos((a * Math.PI) / 180)];

  function paint() {
    const ticks = names.map((n, i) => {
      const a = i * 45, main = i % 2 === 0;
      const [x1, y1] = pt(a, R + 6), [x2, y2] = pt(a, R + 16), [tx, ty] = pt(a, R + 36);
      const on = enabled(a);
      const lines = n.split(' ');
      return `<g class="tick ${on ? '' : 'off'} ${main ? 'main' : ''}" data-a="${a}">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <text x="${tx}" y="${ty - (lines.length - 1) * 6}">${lines.map((l, j) => `<tspan x="${tx}" dy="${j ? 12 : 0}">${esc(l)}</tspan>`).join('')}</text>
        <circle class="hit" cx="${tx}" cy="${ty}" r="22"/>
      </g>`;
    }).join('');
    const [hx, hy] = pt(value, R);
    const large = value > 180 ? 1 : 0;
    const [ax, ay] = pt(value, R);
    el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle class="track" cx="${c}" cy="${c}" r="${R}"/>
      ${value > 0 ? `<path class="arc" d="M ${c} ${c - R} A ${R} ${R} 0 ${large} 1 ${ax} ${ay}"/>` : ''}
      ${ticks}
      <line class="needle" x1="${c}" y1="${c}" x2="${hx}" y2="${hy}"/>
      <circle class="knob" cx="${hx}" cy="${hy}" r="11"/>
      <text class="center" x="${c}" y="${c + 6}">${Math.round(value)}°</text>
    </svg>`;
  }

  function snap(a) {
    a = ((a % 360) + 360) % 360;
    if (opts.detents) {
      const dist = x => Math.abs(((a - x + 540) % 360) - 180);
      return opts.detents.reduce((best, x) => (dist(x) < dist(best) ? x : best), opts.detents[0]);
    }
    const step = opts.step ?? 1;
    return (Math.round(a / step) * step) % 360;
  }

  function set(a) {
    if (opts.detents && !enabled(a)) return opts.onBlocked?.(a);
    if (a === value) return;
    value = a;
    paint();
    opts.onChange?.(value);
  }

  const angleAt = e => {
    const r = el.querySelector('svg').getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    return (Math.atan2(x, -y) * 180) / Math.PI;
  };
  let dragging = false;
  el.addEventListener('pointerdown', e => {
    const tick = e.target.closest('.tick');
    if (tick) return set(Number(tick.dataset.a));
    dragging = true;
    el.setPointerCapture(e.pointerId);
    const a = snap(angleAt(e));
    if (!opts.detents || enabled(a)) set(a);
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const a = snap(angleAt(e));
    if (!opts.detents || enabled(a)) set(a);
  });
  el.addEventListener('pointerup', () => { dragging = false; });
  el.addEventListener('pointercancel', () => { dragging = false; });

  paint();
  el.update = v => { value = v; paint(); };
  return el;
}

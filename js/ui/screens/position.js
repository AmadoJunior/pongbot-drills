// Select Robot Position, with the drop-point coverage estimate.
import { store } from '../../store.js';
import { $, esc } from '../dom.js';
import { paramRow } from '../controls.js';
import { drawTopView } from '../trajectory.js';
import { landsOnTable, ROBOT_POSITIONS } from '../../core/physics.js';
import { simulateBall, deviceOf } from '../../core/devices.js';
import { newDrill } from '../../core/drills.js';
import { positionLabel } from '../labels.js';

const coverageCache = new Map();

// Landing points reachable from a placement (light topspin and backspin).
function coverage(place) {
  const key = `${place.device}|${place.position}|${place.bodyAngle}`;
  if (coverageCache.has(key)) return coverageCache.get(key);
  const pts = [];
  for (let drop = -10; drop <= 10; drop += 2) {
    for (let speed = 1; speed <= 8; speed += 1) {
      for (let height = -50; height <= 100; height += 10) {
        for (const [rot, angle] of [[0, 0], [5, 180]]) {
          const r = simulateBall({ height, speed, spin: 3, rot, angle, drop, rail: 0 }, place);
          if (landsOnTable(r)) pts.push(r.landing);
        }
      }
    }
  }
  coverageCache.set(key, pts);
  return pts;
}

export function render(view, ctx) {
  const editing = ctx.params.mode === 'edit';
  ctx.setTitle('Select Robot Position');
  const draft = editing ? store.draft : null;
  const device = draft?.device ?? store.settings.device;
  const dev = deviceOf(device);
  const place = { device, position: draft?.position ?? dev.defaultPosition, bodyAngle: draft?.bodyAngle ?? null };
  const halo = device === 'halo';

  view.innerHTML = `
    <div class="card">
      <div class="hint" style="margin-bottom:10px">To create a custom drill, first select a robot position and place your robot accordingly.
        Orange dots estimate the drop-point coverage from there.</div>
      <div class="pos-table" id="table"><canvas></canvas></div>
      <div class="pos-presets" id="presets"></div>
    </div>
    <div class="card" id="angle-card" ${halo ? 'hidden' : ''}></div>
    <div class="card"><div class="row-between"><span class="muted">Current position</span><b id="cur"></b></div></div>
    <div class="bottom-bar"><button class="btn" id="next">${editing ? 'Done' : 'Next'}</button></div>`;

  const table = $('#table', view);
  const canvas = $('canvas', table);
  const presetAngle = () => ROBOT_POSITIONS[place.position]?.xyza[3] ?? 0;

  // Nova: the robot can be turned on the table (official circular slider on this screen).
  let angleRow = null;
  if (!halo) {
    angleRow = paramRow({
      label: 'Robot angle on the table (°)', value: place.bodyAngle ?? presetAngle(), min: -45, max: 45, step: 1,
      format: v => (v > 0 ? '+' : '') + v,
      onChange: v => { place.bodyAngle = v === presetAngle() ? null : v; paint(); },
    });
    const reset = document.createElement('button');
    reset.className = 'btn small ghost';
    reset.textContent = 'Reset to position default';
    reset.addEventListener('click', () => { place.bodyAngle = null; angleRow.update(presetAngle()); paint(); });
    $('#angle-card', view).append(angleRow, reset);
  }

  function selectPosition(p) {
    place.position = p;
    place.bodyAngle = null;
    angleRow?.update(presetAngle());
    paint();
  }

  function paint() {
    const w = Math.min(table.parentElement.clientWidth - 28, 300);
    table.style.width = w + 'px';
    const { mapXY } = drawTopView(canvas, { drill: place, cssW: w });
    const c = canvas.getContext('2d');
    c.fillStyle = 'rgba(244,100,60,.55)';
    for (const [x, y] of coverage(place)) {
      const [sx, sy] = mapXY(x, y);
      c.beginPath(); c.arc(sx, sy, 2.2, 0, Math.PI * 2); c.fill();
    }
    table.querySelectorAll('.pos-dot').forEach(d => d.remove());
    $('#cur', view).textContent = positionLabel(place.position, device) + (place.bodyAngle != null ? `, turned ${place.bodyAngle}°` : '');
    if (halo) {
      $('#presets', view).innerHTML = `<div class="halo-pos" style="width:100%">${dev.positions.map(p => `
        <button data-p="${p}" class="${p === place.position ? 'on' : ''}"><img src="assets/img/halo-position-${p}.svg" alt=""><b>Position ${p}</b></button>`).join('')}</div>`;
      return;
    }
    const pos = place.position;
    for (let p = 1; p <= 9; p++) {
      const [x, y] = ROBOT_POSITIONS[p].xyza;
      const [sx, sy] = mapXY(x, y);
      const dot = document.createElement('button');
      dot.className = 'pos-dot' + (p === pos ? ' on' : '');
      dot.style.left = sx + 'px';
      dot.style.top = sy + 'px';
      dot.textContent = p;
      dot.onclick = () => selectPosition(p);
      table.append(dot);
    }
    $('#presets', view).innerHTML = [10, 11].map(p =>
      `<button class="btn small ${p === pos ? '' : 'ghost'}" data-p="${p}">${esc(positionLabel(p))}</button>`).join('');
  }

  $('#presets', view).addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (b) selectPosition(Number(b.dataset.p));
  });

  $('#next', view).addEventListener('click', () => {
    if (editing) {
      Object.assign(store.draft, { position: place.position, bodyAngle: place.bodyAngle });
      store.draftDirty = true;
      ctx.back();
      return;
    }
    const drill = newDrill(place.position, 2, device);
    drill.bodyAngle = place.bodyAngle;
    store.startDraft(drill);
    // The Nova head is set by hand for the whole drill; the Halo sets it per ball.
    ctx.go(dev.manualHead ? '#/new/head' : '#/edit', { replace: true });
  });

  paint();
  const onResize = () => paint();
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

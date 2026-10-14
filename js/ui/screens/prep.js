// Drill Prep: setup reminders, serve mode and sequence, then Start.
import { store } from '../../store.js';
import { $, esc } from '../dom.js';
import { paramRow, segmented } from '../controls.js';
import { drawTopView, traceBall, ballColor } from '../trajectory.js';
import { HEAD_POSITIONS } from '../../core/physics.js';
import { drillHasVariation } from '../../core/scheduler.js';
import { deviceOf } from '../../core/devices.js';
import { spinLabel, headLabel, positionLabel, ballSummary } from '../labels.js';

export function render(view, ctx) {
  const drill = store.get(ctx.params.id);
  if (!drill) return ctx.go('#/', { replace: true });
  ctx.setTitle(drill.name || 'Drill Prep');
  const head = HEAD_POSITIONS.find(h => h.key === drill.head) ?? HEAD_POSITIONS[0];
  const save = () => store.upsert(drill);

  view.innerHTML = `
    <div class="card">
      <div class="traj"><canvas class="top"></canvas>
        <div class="side-wrap">
          <div class="muted">${esc(deviceOf(drill).name)} · Robot Position</div>
          <b>${esc(positionLabel(drill.position, drill.device))}${drill.bodyAngle != null ? `, turned ${drill.bodyAngle}°` : ''}</b>
          ${drill.device === 'halo'
            ? `<img src="assets/img/halo-position-${drill.position}.svg" alt="" style="width:100%;max-width:220px">`
            : `<div class="muted" style="margin-top:8px">Rotate the robot head</div>
          <div class="rot-choice"><img src="assets/img/nova-head.svg" alt="" style="transform:rotate(${head.angle}deg)">
            <b>${esc(headLabel(drill.head))}</b></div>`}
          ${drillHasVariation(drill) ? '<span class="chip accent" style="align-self:flex-start">± per-shot variation</span>' : ''}
        </div>
      </div>
    </div>
    <div class="card" id="mode"><h3>Serve Mode</h3></div>
    <div class="card" id="seq"><h3>Sequence</h3></div>
    <div class="card"><h3>Balls</h3><div id="balls"></div></div>
    <div class="bottom-bar">
      <button class="btn ghost" id="edit">Edit</button>
      <button class="btn" id="start">Start</button>
    </div>`;

  drawTopView($('canvas.top', view), {
    drill, cssW: 128,
    items: drill.balls.map((b, i) => ({ trace: traceBall(b, drill, 16), color: ballColor(i), emphasis: 0.9 })),
  });

  const modeCard = $('#mode', view);
  const countHolder = document.createElement('div');
  const paintCount = () => {
    countHolder.innerHTML = '';
    countHolder.append(drill.mode === 'time'
      ? paramRow({ label: 'Time (minutes)', value: drill.minutes, min: 1, max: 60, step: 1, onChange: v => { drill.minutes = v; save(); } })
      : paramRow({ label: 'Combos (repeats of the sequence)', value: drill.groups, min: 1, max: 200, step: 1, onChange: v => { drill.groups = v; save(); } }));
  };
  modeCard.append(segmented([{ value: 'groups', label: 'Combo' }, { value: 'time', label: 'Time' }], drill.mode, v => {
    drill.mode = v; save(); paintCount();
  }), countHolder);
  paintCount();

  const seqCard = $('#seq', view);
  seqCard.append(segmented([{ value: 'sequential', label: 'Sequential' }, { value: 'random', label: 'Random' }], drill.sequence, v => {
    drill.sequence = v; save();
  }));
  const seqHint = document.createElement('div');
  seqHint.className = 'hint';
  seqHint.style.marginTop = '8px';
  seqHint.textContent = 'Random shuffles the ball order every combo. To keep the order and only vary the shots, use Sequential with ± ranges on the balls.';
  seqCard.append(seqHint);

  $('#balls', view).innerHTML = drill.balls.map((b, i) => `
    <div class="ball-tile" style="padding:8px 0">
      <div class="ball-no" style="background:${ballColor(i)}">${i + 1}</div>
      <div class="desc"><b>${esc(spinLabel(b, drill.device))}</b><br>${esc(ballSummary(b, drill.device))}</div>
    </div>`).join('');

  $('#edit', view).addEventListener('click', () => {
    store.startDraft(drill);
    ctx.go('#/edit');
  });
  $('#start', view).addEventListener('click', async () => {
    if (await ctx.start(drill, 'drill', 0, { deferred: true })) ctx.go('#/serving');
  });
}

// Single ball settings, with live ball prediction and ± variation ranges.
import { store } from '../../store.js';
import { $, confirmDialog } from '../dom.js';
import { paramRow, compassDial } from '../controls.js';
import { drawTopView, drawSideView, traceBall, ballColor, describe, GOOD_LAND_RATE } from '../trajectory.js';
import { HEAD_POSITIONS, headForType } from '../../core/physics.js';
import { deviceOf, maxSpinFor } from '../../core/devices.js';
import { ROT_ANGLE, angleToRot } from '../../core/drills.js';
import { VARY_MAX } from '../../core/variation.js';
import { spinLabel, headLabel } from '../labels.js';

export function render(view, ctx) {
  const d = store.draft;
  const index = Number(ctx.params.index);
  const ball = d?.balls[index];
  if (!ball) return ctx.go('#/', { replace: true });
  ctx.setTitle(`Ball ${index + 1} of ${d.balls.length}`);
  const dev = deviceOf(d);

  view.innerHTML = `
    <div class="card">
      <div class="traj"><canvas class="top"></canvas>
        <div class="side-wrap"><canvas class="side"></canvas><div class="traj-status" id="status"></div></div>
      </div>
    </div>
    <div class="card">
      <div class="row-between"><h3 style="margin:0">Rotation Type</h3><b id="rot-label"></b></div>
      <div id="dial"></div>
      <div class="hint" id="rot-hint"></div>
    </div>
    <div class="card" id="params"></div>
    <div class="bottom-bar">
      <button class="btn ghost" id="test">Ball Test</button>
      <button class="btn" id="done">Done</button>
    </div>`;

  let frame = 0;
  function paintPreview() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const trace = traceBall(ball, d);
      const items = [{ trace, color: ballColor(index), emphasis: 1 }];
      const side = $('canvas.side', view);
      drawTopView($('canvas.top', view), { drill: d, items, cssW: 128 });
      drawSideView(side, { drill: d, items, cssW: side.parentElement.clientWidth, cssH: 120 });
      const info = describe(trace.base), status = $('#status', view);
      const rate = trace.samples.length ? Math.round(trace.landRate * 100) : null;
      status.className = 'traj-status ' + (info.ok && (rate === null || rate >= GOOD_LAND_RATE) ? 'good' : 'bad');
      status.textContent = info.text + (rate !== null ? ` · ${rate}% of varied shots land` : '');
    });
  }

  const changed = () => { store.draftDirty = true; paintPreview(); };

  // Spin direction dial. Halo: any angle, the head turns by itself.
  // Nova: the 8 directions, of which the drill's manual head position allows two.
  const rotLabelEl = $('#rot-label', view), rotHint = $('#rot-hint', view);
  const paintRotText = () => {
    rotLabelEl.textContent = spinLabel(ball, d.device);
    rotHint.textContent = dev.manualHead
      ? `Head position for this drill: ${headLabel(d.head)}. Tap a greyed direction to move the whole drill to that head position.`
      : 'The Halo turns its head for every ball, so each ball can use any direction.';
  };
  const allowed = () => (HEAD_POSITIONS.find(h => h.key === d.head) ?? HEAD_POSITIONS[0]).types.map(t => ROT_ANGLE[t]);
  const enabled = allowed();
  const dial = dev.manualHead
    ? compassDial({
      value: ROT_ANGLE[ball.rot], detents: ROT_ANGLE, enabled,
      onChange: a => { ball.rot = angleToRot(a); ball.angle = a; paintRotText(); changed(); },
      onBlocked: async a => {
        const rot = angleToRot(a), head = headForType(rot);
        if (!await confirmDialog('Change head position?', `${headLabel(head.key)} needs the robot head turned differently. Switch the whole drill to that head position? Other balls keep their topspin/backspin side.`, 'Switch')) return;
        for (const b of d.balls) b.rot = b.rot >= 4 ? head.types[1] : head.types[0];
        d.head = head.key;
        ball.rot = rot;
        for (const b of d.balls) b.angle = ROT_ANGLE[b.rot];
        enabled.splice(0, enabled.length, ...allowed());
        dial.update(ROT_ANGLE[rot]);
        paintRotText();
        changed();
      },
    })
    : compassDial({
      value: ball.angle, step: dev.fields.angle.step,
      onChange: a => { ball.angle = a; ball.rot = angleToRot(a); paintRotText(); changed(); },
    });
  $('#dial', view).append(dial);
  paintRotText();

  const params = $('#params', view);
  const row = (key, label, extra = {}) => paramRow({
    label, value: ball[key], ...dev.fields[key],
    vary: dev.variable.includes(key) ? ball.vary[key] ?? 0 : null, varyMax: VARY_MAX[key],
    onChange: v => { ball[key] = v; extra.onChange?.(v); changed(); },
    onVary: v => { ball.vary[key] = v; changed(); },
    ...extra.opts,
  });

  const spinRow = row('spin', 'Spin', { opts: { max: maxSpinFor(d.device, ball.speed) } });
  params.append(
    row('height', 'Ball Height'),
    row('drop', 'Drop Point', { opts: { format: v => (v > 0 ? '+' : '') + v } }),
  );
  if (dev.rail) params.append(row('rail', 'Rail Position', { opts: { format: v => (v > 0 ? '+' : '') + v } }));
  params.append(
    row('speed', 'Speed', {
      onChange: v => {
        const m = maxSpinFor(d.device, v);
        if (ball.spin > m) ball.spin = m;
        spinRow.update(ball.spin, m);
      },
    }),
    spinRow,
    // Nova: 30 + 0.6·freq balls per minute (official app). The Halo's rate is unverified, so it shows the raw value.
    row('freq', 'Freq.', { opts: { format: v => (dev.id === 'nova' ? `${v} · ${Math.round(30 + 0.6 * v)}/min` : `${v}`) } }),
    row('reps', 'Number of Repetition'),
  );
  const freqHint = document.createElement('div');
  freqHint.className = 'hint';
  freqHint.textContent = (dev.rail ? 'Rail moves the Halo sideways (−10…+10 = ±0.8 m); the preview does not show the rail offset, like the official app. ' : '')
    + '± ranges are rolled again on every single shot; repetitions of a varied ball each get their own roll.';
  params.append(freqHint);

  $('#done', view).addEventListener('click', () => ctx.back());
  $('#test', view).addEventListener('click', async () => {
    if (await ctx.start(d, 'ballTest', index)) ctx.go('#/serving');
  });

  paintPreview();
  return () => cancelAnimationFrame(frame);
}

// Drill in process: countdown, progress ring, live shot preview, pause/stop.
import { store } from '../../store.js';
import { $, esc, fmt, confirmDialog, toast } from '../dom.js';
import { drawTopView, traceBall, ballColor } from '../trajectory.js';
import { summarize } from '../../core/timing.js';

const RING = 2 * Math.PI * 100;
const mmss = ms => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function render(view, ctx) {
  const { runner } = ctx;
  const s0 = runner.session;
  if (!s0) return ctx.back();
  const drill = s0.drill;
  const title = { drill: drill.name || 'Drill', ballTest: 'Ball Test', comboTest: 'Combo Test' }[s0.kind];
  ctx.setTitle(title);
  ctx.setBack(true, leave);

  view.innerHTML = `
    <div class="serve">
      ${s0.kind !== 'drill' ? `<div class="card hint">${s0.kind === 'ballTest'
        ? 'Ball Test In Process: the selected ball is served five times, each shot with its own random roll.'
        : 'Combo Test In Process: the combo is served twice.'}</div>` : ''}
      <div class="ring">
        <svg viewBox="0 0 230 230"><circle class="bg" cx="115" cy="115" r="100"/><circle class="fg" cx="115" cy="115" r="100" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/></svg>
        <div class="center"><div class="big" id="big">–</div><div class="sub" id="sub"></div></div>
      </div>
      <div class="shot-info" id="shot"></div>
      ${s0.varied ? '<div class="hint" id="gap" style="text-align:center"></div>' : ''}
      <div class="card"><div class="traj" style="justify-content:center"><canvas class="top"></canvas></div></div>
    </div>
    <div class="bottom-bar">
      <button class="btn ghost" id="pause">Pause</button>
      <button class="btn" id="stop">Stop</button>
    </div>`;

  const canvas = $('canvas.top', view);
  const drawShot = entry => drawTopView(canvas, {
    drill, cssW: 150,
    items: entry
      ? [{ trace: traceBall(entry.shot, drill), color: ballColor(entry.ballIndex), emphasis: 1 }]
      : drill.balls.map((b, i) => ({ trace: traceBall(b, drill, 0), color: ballColor(i), emphasis: 0.5 })),
  });
  drawShot(null);

  // Countdown before the first ball, as in the official app (tap to skip).
  let countdownEl = null;
  if (s0.waiting && store.settings.countdown) {
    let n = store.settings.countdownSecs;
    countdownEl = document.createElement('div');
    countdownEl.className = 'countdown';
    countdownEl.innerHTML = `<div class="n">${n}</div><div style="margin-top:12px;opacity:.7">Tap to skip</div>`;
    document.body.append(countdownEl);
    const finish = () => {
      clearInterval(cd);
      countdownEl?.remove();
      countdownEl = null;
      runner.begin();
    };
    const cd = setInterval(() => {
      if (--n <= 0) return finish();
      countdownEl.querySelector('.n').textContent = n;
    }, 1000);
    countdownEl.addEventListener('click', finish);
  } else {
    runner.begin();
  }

  let lastShot = null;
  function paint() {
    const s = runner.session;
    if (!s) return;
    const fg = view.querySelector('.ring .fg');
    let frac;
    if (s.timed) {
      const left = s.timeTotalMs - runner.elapsed();
      $('#big', view).textContent = mmss(left);
      $('#sub', view).textContent = 'remaining';
      frac = runner.elapsed() / s.timeTotalMs;
    } else {
      $('#big', view).textContent = `${Math.min(s.cyclesDone + 1, s.cyclesTotal)}/${s.cyclesTotal}`;
      $('#sub', view).textContent = s.kind === 'ballTest' ? 'ball test' : 'combo';
      frac = s.cyclesDone / s.cyclesTotal;
    }
    fg.setAttribute('stroke-dashoffset', String(RING * (1 - Math.min(1, frac))));
    $('#pause', view).textContent = s.paused ? 'Continue' : 'Pause';
    const gapEl = $('#gap', view);
    if (gapEl) {
      const t = summarize(s.timing);
      const sec = ms => `${(ms / 1000).toFixed(2)} s`;
      gapEl.textContent = t.lastGapMs == null
        ? 'Batch gap: measured when the next batch starts'
        : `Batch gap ${sec(t.lastGapMs)} · normal spacing ${t.spacingMs == null ? '–' : sec(t.spacingMs)}`
          + (t.batches > 1 ? ` · avg ${sec(t.gapMs)} over ${t.batches}` : '');
    }
    if (s.shot && s.shot !== lastShot) {
      lastShot = s.shot;
      const sh = s.shot.shot;
      $('#shot', view).innerHTML = `<span class="chip accent">Ball ${s.shot.ballIndex + 1}</span>` +
        [['Speed', sh.speed, 0.5], ['Spin', sh.spin, 0.5], ['Height', sh.height, 1], ['Drop', sh.drop, 1],
          ...(drill.device === 'halo' ? [['Rail', sh.rail, 1]] : [])]
          .map(([l, v, st]) => `<span class="chip">${l} <b class="num">${esc(fmt(v, st))}</b></span>`).join('');
      drawShot(s.shot);
    }
  }

  const onUpdate = () => paint();
  const onFinish = e => {
    const { reason } = e.detail;
    if (reason === 'rejected') toast('The robot rejected the drill');
    if (reason === 'disconnected') toast('Robot disconnected');
    if (reason === 'done') toast(`${title} finished`);
    ctx.back();
  };
  runner.addEventListener('update', onUpdate);
  runner.addEventListener('tick', onUpdate);
  runner.addEventListener('finish', onFinish);

  $('#pause', view).addEventListener('click', () => {
    if (countdownEl) return;
    runner.session?.paused ? runner.resume() : runner.pause();
  });
  $('#stop', view).addEventListener('click', () => runner.stop());

  async function leave() {
    if (runner.session && !await confirmDialog('Drill in process', 'Drill in process, are you sure you wish to return?', 'Stop and return')) return;
    runner.stop();
  }

  paint();
  return () => {
    countdownEl?.remove();
    runner.removeEventListener('update', onUpdate);
    runner.removeEventListener('tick', onUpdate);
    runner.removeEventListener('finish', onFinish);
  };
}

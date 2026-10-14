// Edit Combo: title, robot setup and the ball list.
import { store } from '../../store.js';
import { $, esc, toast, confirmDialog, pressable } from '../dom.js';
import { drawTopView, drawSideView, traceBall, ballColor, describe, GOOD_LAND_RATE } from '../trajectory.js';
import { spinLabel, headLabel, positionLabel, ballSummary } from '../labels.js';
import { MAX_TITLE } from '../../core/drills.js';
import { MAX_BALLS } from '../../core/scheduler.js';

let selectedBall = 0;

export function render(view, ctx) {
  const d = store.draft;
  if (!d) return ctx.go('#/', { replace: true });
  ctx.setTitle('Edit Combo');
  ctx.setBack(true, leave);
  selectedBall = Math.min(selectedBall, d.balls.length - 1);

  async function leave() {
    if (store.draftDirty && !await confirmDialog('Leave without saving?', 'Your settings won\'t be saved, do you still wish to return?', 'Return')) return;
    store.draft = null;
    selectedBall = 0;
    ctx.back();
  }

  view.innerHTML = `
    <input class="title-input" id="name" maxlength="${MAX_TITLE}" placeholder="Custom Drill Title (A maximum of 35 characters)">
    <div class="card">
      <div class="traj"><canvas class="top"></canvas>
        <div class="side-wrap"><canvas class="side"></canvas><div class="traj-status" id="status"></div><div class="legend" id="legend"></div></div>
      </div>
    </div>
    <div class="card">
      <button class="row-between menu-item" id="pos"><span class="muted">Robot Position</span><b></b></button>
      <button class="row-between menu-item" id="head" ${d.device === 'halo' ? 'hidden' : ''}><span class="muted">Combo Rotation Type</span><b></b></button>
    </div>
    <div class="hint" style="margin:0 4px 8px">Tap a ball to preview it, press and hold to edit. Drag ☰ to reorder; drag a ball to the bottom of the page to delete it.</div>
    <div class="balls" id="balls"></div>
    <div class="bottom-bar">
      <button class="btn ghost" id="test">Combo Test</button>
      <button class="btn" id="save">Save</button>
    </div>`;

  const name = $('#name', view);
  name.value = d.name;
  name.addEventListener('input', () => { d.name = name.value; store.draftDirty = true; });
  $('#pos b', view).textContent = positionLabel(d.position, d.device) + (d.bodyAngle != null ? `, ${d.bodyAngle}°` : '');
  $('#head b', view).textContent = headLabel(d.head);
  $('#pos', view).addEventListener('click', () => ctx.go('#/edit/position'));
  $('#head', view).addEventListener('click', () => ctx.go('#/edit/head'));

  function paintPreview() {
    const traces = d.balls.map(b => traceBall(b, d));
    const items = traces.map((trace, i) => ({ trace, color: ballColor(i), emphasis: i === selectedBall ? 1 : 0.35 }));
    const top = $('canvas.top', view), side = $('canvas.side', view);
    drawTopView(top, { drill: d, items, cssW: 128 });
    const sideW = side.parentElement.clientWidth;
    drawSideView(side, { drill: d, items: [items[selectedBall]], cssW: sideW, cssH: 120 });
    const t = traces[selectedBall], info = describe(t.base);
    const status = $('#status', view);
    const rate = t.samples.length ? Math.round(t.landRate * 100) : null;
    status.className = 'traj-status ' + (info.ok && (rate === null || rate >= GOOD_LAND_RATE) ? 'good' : 'bad');
    status.textContent = `Ball ${selectedBall + 1}: ${info.text}` + (rate !== null ? ` · ${rate}% of varied shots land` : '');
    $('#legend', view).innerHTML = '<span><i style="background:#fff"></i>solid = base shot</span><span>faint = random range</span><span>○ bounce on robot side</span>';
  }

  function paintBalls() {
    const list = $('#balls', view);
    list.innerHTML = '';
    d.balls.forEach((b, i) => {
      const tile = document.createElement('div');
      tile.className = 'ball-tile' + (i === selectedBall ? ' sel' : '');
      tile.innerHTML = `
        <div class="ball-no" style="background:${ballColor(i)}">${i + 1}</div>
        <div class="desc"><b>${esc(spinLabel(b, d.device))}</b><br>${esc(ballSummary(b, d.device))}</div>
        <button class="icon-btn" data-nopress data-edit aria-label="Edit ball"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg></button>
        <div class="handle" data-nopress aria-label="Reorder"><svg viewBox="0 0 24 24"><path d="M4 8h16M4 12h16M4 16h16"/></svg></div>`;
      pressable(tile, {
        onTap: () => { selectedBall = i; paintBalls(); paintPreview(); },
        onLong: () => openBall(i),
      });
      $('[data-edit]', tile).addEventListener('click', () => openBall(i));
      enableDrag(tile, $('.handle', tile), i);
      list.append(tile);
    });
    if (d.balls.length < MAX_BALLS) {
      const add = document.createElement('button');
      add.className = 'add-ball';
      add.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Add ball';
      add.addEventListener('click', () => {
        d.balls.push(structuredClone(d.balls[d.balls.length - 1]));
        store.draftDirty = true;
        openBall(d.balls.length - 1);
      });
      list.append(add);
    }
  }

  function openBall(i) {
    selectedBall = i;
    ctx.go(`#/edit/ball/${i}`);
  }

  function enableDrag(tile, handle, index) {
    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const tiles = [...view.querySelectorAll('.ball-tile')];
      const rects = tiles.map(t => t.getBoundingClientRect());
      const startY = e.clientY;
      let target = index, overTrash = false;
      const trash = document.createElement('div');
      trash.className = 'trash-zone';
      trash.textContent = d.balls.length > 1 ? 'Drop here to delete' : 'A drill needs at least one ball';
      document.body.append(trash);
      tile.classList.add('dragging');

      const move = ev => {
        const dy = ev.clientY - startY;
        tile.style.transform = `translateY(${dy}px)`;
        overTrash = d.balls.length > 1 && ev.clientY > window.innerHeight - 110;
        trash.classList.toggle('hot', overTrash);
        const mid = rects[index].top + rects[index].height / 2 + dy;
        target = rects.filter((r, j) => j !== index && r.top + r.height / 2 < mid).length;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        trash.remove();
        tile.classList.remove('dragging');
        tile.style.transform = '';
        if (overTrash) {
          d.balls.splice(index, 1);
          selectedBall = Math.min(selectedBall, d.balls.length - 1);
          store.draftDirty = true;
        } else if (target !== index) {
          const [b] = d.balls.splice(index, 1);
          d.balls.splice(target, 0, b);
          selectedBall = target;
          store.draftDirty = true;
        }
        paintBalls();
        paintPreview();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  $('#save', view).addEventListener('click', () => {
    if (!d.name.trim()) { name.focus(); return toast('To save this drill, please fill in a title'); }
    store.upsert(d);
    store.draft = null;
    selectedBall = 0;
    toast('Drill saved');
    ctx.back();
  });

  $('#test', view).addEventListener('click', async () => {
    if (await ctx.start(d, 'comboTest')) ctx.go('#/serving');
  });

  paintBalls();
  paintPreview();
}

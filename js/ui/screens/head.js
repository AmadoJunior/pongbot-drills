// Combo Rotation Type: the manual head position for the whole drill.
import { store } from '../../store.js';
import { $, esc } from '../dom.js';
import { HEAD_POSITIONS } from '../../core/physics.js';
import { rotLabel } from '../labels.js';
import { ROT_ANGLE } from '../../core/drills.js';

export function render(view, ctx) {
  if (!store.draft) return ctx.go('#/', { replace: true });
  const editing = ctx.params.mode === 'edit';
  ctx.setTitle('Combo Rotation Type');
  let head = store.draft.head;

  function paint() {
    view.innerHTML = `
      <div class="card"><div class="muted">Please manually rotate the robot head as shown below. Every ball in this drill uses this head position;
        each ball can then pick between its two spin directions.</div></div>
      <div class="heads">${HEAD_POSITIONS.map(h => `
        <button class="head-opt ${h.key === head ? 'on' : ''}" data-k="${h.key}">
          <img src="assets/img/nova-head.svg" alt="" style="transform:rotate(${h.angle}deg)">
          <div class="lbl">${esc(h.types.map(rotLabel).join(' / '))}</div>
          <div class="hint">head roll ${h.roll > 0 ? '+' : ''}${h.roll}°</div>
        </button>`).join('')}
      </div>
      <div class="bottom-bar"><button class="btn" id="next">${editing ? 'Done' : 'Next'}</button></div>`;
    view.querySelectorAll('.head-opt').forEach(b => b.addEventListener('click', () => { head = Number(b.dataset.k); paint(); }));
    $('#next', view).addEventListener('click', apply);
  }

  function apply() {
    const d = store.draft;
    const types = HEAD_POSITIONS.find(h => h.key === head).types;
    if (head !== d.head) {
      // Keep each ball's spin family (topspin/backspin) on the new head position.
      for (const b of d.balls) {
        b.rot = b.rot >= 4 ? types[1] : types[0];
        b.angle = ROT_ANGLE[b.rot];
      }
      d.head = head;
      store.draftDirty = true;
    }
    if (editing) ctx.back(); else ctx.go('#/edit', { replace: true });
  }

  paint();
}

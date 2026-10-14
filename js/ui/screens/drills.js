// Custom Drills -> Mine: the drill library.
import { store } from '../../store.js';
import { $, esc, toast, confirmDialog, menu, pressable, pickFile, download } from '../dom.js';
import { drawTopView, traceBall, ballColor } from '../trajectory.js';
import { positionLabel, headLabel } from '../labels.js';
import { segmented } from '../controls.js';
import { DEVICES } from '../../core/devices.js';
import { drillHasVariation } from '../../core/scheduler.js';
import { importText, exportJson, normalizeDrill } from '../../core/drills.js';

export function render(view, ctx) {
  ctx.setTitle('Custom Drills');
  let selecting = false;
  const selected = new Set();

  function paint() {
    const device = store.settings.device;
    const drills = store.drills.filter(d => d.device === device);
    const allSelected = drills.length > 0 && drills.every(d => selected.has(d.id));
    view.innerHTML = `
      <div class="model-switch" id="model"></div>
      <div class="row-between">
        <div class="tabs"><button class="on">Mine</button></div>
        ${selecting
          ? `<div class="select-bar">
               <span class="hint">${selected.size} selected</span>
               <button class="btn small ghost" id="all">${allSelected ? 'Deselect all' : 'Select all'}</button>
             </div>`
          : `<button class="icon-btn" id="more" aria-label="More">
               <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
             </button>`}
      </div>
      ${drills.length ? '' : `<div class="empty">Looks like you haven't created any drills yet, click "Add New" down below and start creating your own drill.<br><br>
        <span class="hint">Already have drills? Use ··· → Import (official app export, olanga CSV or a backup).</span></div>`}
      <div id="list"></div>
      <div class="bottom-bar">
        ${selecting
          ? `<button class="btn ghost" id="dup" ${selected.size ? '' : 'disabled'}>Duplicate</button>
             <button class="btn danger" id="del" ${selected.size ? '' : 'disabled'}>Delete</button>
             <button class="btn small ghost" id="done">Done</button>`
          : '<button class="btn" id="add">Add New</button>'}
      </div>`;
    const list = $('#list', view);
    for (const d of drills) {
      const item = document.createElement('div');
      item.className = 'drill-item';
      const varied = drillHasVariation(d);
      item.innerHTML = `
        ${selecting ? `<div class="check ${selected.has(d.id) ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></div>` : ''}
        <div class="info">
          <div class="name">${esc(d.name || 'Untitled drill')}</div>
          <div class="meta">
            <span class="chip">${d.balls.length} ball${d.balls.length === 1 ? '' : 's'}</span>
            <span class="chip">${esc(positionLabel(d.position, d.device))}</span>
            ${d.device === 'nova' ? `<span class="chip">${esc(headLabel(d.head))}</span>` : ''}
            ${varied ? '<span class="chip accent">± variation</span>' : ''}
          </div>
        </div>
        <canvas></canvas>`;
      list.append(item);
      drawTopView($('canvas', item), {
        drill: d, cssW: 64, showGrid: false,
        items: d.balls.map((b, i) => ({ trace: traceBall(b, d, 12), color: ballColor(i), emphasis: 0.9 })),
      });
      pressable(item, {
        onTap: () => {
          if (!selecting) return ctx.go(`#/prep/${d.id}`);
          selected.has(d.id) ? selected.delete(d.id) : selected.add(d.id);
          paint();
        },
        onLong: () => { selecting = true; selected.add(d.id); paint(); },
      });
    }

    $('#model', view).append(segmented(Object.values(DEVICES).map(x => ({ value: x.id, label: x.name })), device, v => {
      store.settings.device = v;
      store.saveSettings();
      selecting = false; selected.clear();
      paint();
    }));
    $('#add', view)?.addEventListener('click', () => ctx.go('#/new/position'));
    $('#done', view)?.addEventListener('click', () => { selecting = false; selected.clear(); paint(); });
    $('#all', view)?.addEventListener('click', () => {
      if (allSelected) selected.clear(); else for (const d of drills) selected.add(d.id);
      paint();
    });
    $('#del', view)?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete drills', 'Do you wish to delete these drills?', 'Delete')) return;
      store.remove([...selected]);
      selecting = false; selected.clear(); paint();
    });
    $('#dup', view)?.addEventListener('click', async () => {
      if (!await confirmDialog('Duplicate drills', 'Do you wish to duplicate these drills?', 'Duplicate')) return;
      const copies = store.drills.filter(d => selected.has(d.id))
        .map(d => normalizeDrill({ ...structuredClone(d), id: undefined, name: (d.name + ' copy').slice(0, 35) }));
      store.add(copies);
      selecting = false; selected.clear(); paint();
    });
    $('#more', view)?.addEventListener('click', moreMenu);
  }

  async function moreMenu() {
    const v = await menu([
      { value: 'import', label: 'Import drills…' },
      { value: 'export', label: 'Export all drills (backup)' },
      { value: 'select', label: 'Select drills' },
      { value: 'settings', label: 'Settings' },
    ]);
    if (v === 'select') { selecting = true; paint(); }
    if (v === 'settings') ctx.go('#/settings');
    if (v === 'export') download(`nova-drills-${new Date().toISOString().slice(0, 10)}.json`, exportJson(store.drills));
    if (v === 'import') {
      const file = await pickFile('.json,.csv,.txt');
      if (!file) return;
      try {
        const drills = importText(await file.text());
        if (!drills.length) return toast('No drills found in that file');
        store.add(drills);
        const count = id => drills.filter(d => d.device === id).length;
        toast(`Imported ${drills.length} drill${drills.length === 1 ? '' : 's'} (${count('nova')} Nova, ${count('halo')} Halo)`, 3500);
        paint();
      } catch (e) {
        toast('Import failed: ' + e.message, 4000);
      }
    }
  }

  paint();
}

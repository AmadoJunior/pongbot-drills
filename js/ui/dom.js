// Small DOM helpers shared by the screens.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (v, step = 1) => (step < 1 ? v.toFixed(1) : String(Math.round(v)));

let toastTimer;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function openModal(inner, onClick) {
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${inner}</div>`;
  root.append(back);
  const close = () => back.remove();
  back.addEventListener('click', e => {
    if (e.target === back) { close(); onClick?.(null); return; }
    const btn = e.target.closest('[data-v]');
    if (btn) { close(); onClick?.(btn.dataset.v); }
  });
  return close;
}

/** Bottom-sheet confirm. Resolves true when the confirm button is pressed. */
export function confirmDialog(title, text, ok = 'Confirm', cancel = 'Cancel') {
  return new Promise(resolve => {
    openModal(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}
      <div class="row"><button class="btn ghost" data-v="0">${esc(cancel)}</button><button class="btn" data-v="1">${esc(ok)}</button></div>`,
    v => resolve(v === '1'));
  });
}

/** Bottom-sheet menu. items: [{ value, label }]. Resolves the chosen value or null. */
export function menu(items) {
  return new Promise(resolve => {
    openModal(items.map(i => `<button class="menu-item" data-v="${esc(i.value)}">${esc(i.label)}</button>`).join(''), resolve);
  });
}

/** Calls onLong after a press-and-hold, onTap for a short press. */
export function pressable(el, { onTap, onLong, ms = 500 }) {
  let timer = null, long = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-nopress]')) return;
    long = false; sx = e.clientX; sy = e.clientY;
    timer = setTimeout(() => { long = true; onLong?.(e); }, ms);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('pointerup', e => {
    cancel();
    if (!long && !e.target.closest('[data-nopress]')) onTap?.(e);
  });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] ?? null);
    input.click();
  });
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

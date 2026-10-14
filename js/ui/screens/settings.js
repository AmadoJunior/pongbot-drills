// Settings: serve countdown, shot timing diagnostics and app info.
import { store } from '../../store.js';
import { $, esc, toast, download, confirmDialog } from '../dom.js';
import { paramRow } from '../controls.js';
import { MockRobot } from '../../ble.js';
import { loadTimingSessions, clearTimingSessions } from '../../core/timing.js';

export function render(view, ctx) {
  ctx.setTitle('Settings');
  const s = store.settings;
  view.innerHTML = `
    <div class="card">
      <div class="row-between"><b>Serve Count Down</b><button class="switch ${s.countdown ? 'on' : ''}" id="cd"></button></div>
      <div id="len"></div>
    </div>
    <div class="card">
      <h3>Robot</h3>
      <div class="muted">${ctx.robot instanceof MockRobot
        ? 'Simulator mode (opened with ?mock). No robot is used.'
        : 'Connect with the status button at the top right. Requires Chrome or Edge with Bluetooth.'}</div>
    </div>
    <div class="card" id="timing"></div>
    <div class="card hint">Nova+ is a personal controller for the Pongbot Nova S Pro, based on olanga/nova and the
      official app's protocol and ball physics. Drills are stored in this browser; use Export to back them up.</div>`;

  const len = $('#len', view);
  const paintLen = () => {
    len.innerHTML = '';
    if (s.countdown) len.append(paramRow({ label: 'Count Down Length (s)', value: s.countdownSecs, min: 1, max: 10, step: 1, onChange: v => { s.countdownSecs = v; store.saveSettings(); } }));
  };
  $('#cd', view).addEventListener('click', e => {
    s.countdown = !s.countdown;
    e.currentTarget.classList.toggle('on', s.countdown);
    store.saveSettings();
    paintLen();
  });
  paintLen();
  paintTiming();

  function paintTiming() {
    const el = $('#timing', view);
    const sessions = loadTimingSessions();
    const sec = ms => (ms == null ? '–' : `${(ms / 1000).toFixed(2)} s`);
    el.innerHTML = `
      <h3>Shot timing</h3>
      <div class="muted">Measured during drills: the normal spacing between shots, and for drills with ± ranges the
        pause when the next batch is uploaded. The last 10 sessions are kept.</div>
      ${sessions.map(r => `
        <div class="timing-row">
          <b>${esc(r.drill || r.kind)}</b> <span class="hint">${esc(new Date(r.at).toLocaleString())} · ${esc(r.robot ?? r.device)}</span>
          <div>${r.summary.shots} shots · spacing ${sec(r.summary.spacingMs)}${r.varied
            ? ` · batch gap ${sec(r.summary.gapMs)} (${r.summary.batches} measured)` : ' · no batches (fixed drill)'}</div>
        </div>`).join('') || '<div class="hint" style="margin-top:8px">No drills measured yet.</div>'}
      ${sessions.length ? `<div class="row-between" style="margin-top:10px">
        <button class="btn small ghost" id="t-copy">Copy log</button>
        <button class="btn small ghost" id="t-save">Save log</button>
        <button class="btn small danger" id="t-clear">Clear</button></div>` : ''}`;
    const text = () => JSON.stringify({ app: 'novaplus-timing', version: 1, sessions }, null, 1);
    $('#t-copy', el)?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text()); toast('Timing log copied'); } catch { toast('Copy failed, use Save log'); }
    });
    $('#t-save', el)?.addEventListener('click', () => download(`novaplus-timing-${new Date().toISOString().slice(0, 10)}.json`, text()));
    $('#t-clear', el)?.addEventListener('click', async () => {
      if (!await confirmDialog('Clear timing', 'Delete the saved shot timing logs?', 'Clear')) return;
      clearTimingSessions();
      paintTiming();
    });
  }
}

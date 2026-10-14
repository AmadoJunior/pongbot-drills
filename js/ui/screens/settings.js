// Settings: serve countdown and app info.
import { store } from '../../store.js';
import { $ } from '../dom.js';
import { paramRow } from '../controls.js';
import { MockRobot } from '../../ble.js';

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
}

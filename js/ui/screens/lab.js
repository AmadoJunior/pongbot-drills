// Serve lab: tests the two halves of a future serve-practice mode separately.
// 1. Bounce detection: the microphone picks the far-side bounce out of a serve.
// 2. Robot reaction time: how long the robot takes to fire after a command,
//    either by restarting a 1-ball drill (0x81) or by resuming a paused one.
// Only commands the drill runner already uses are sent (0x81, pause, resume, stop).
import { store } from '../../store.js';
import { $, esc, toast } from '../dom.js';
import { paramRow, segmented } from '../controls.js';
import { Mic } from '../../audio/mic.js';
import { ServeDetector, analyzeCalibration } from '../../core/serve-detect.js';
import { CMD, MODE, STATE, drillPacket, packBall } from '../../core/protocol.js';
import { rollBall } from '../../core/variation.js';
import { newDrill } from '../../core/drills.js';

const TRIALS_KEY = 'novaplus.lab.trials.v1';
const DEFAULTS = { sensitivity: 5, triggerOn: 3, maxGapMs: 900, vibrate: true, method: 'restart', freq: 50, autoFire: false, ball: '', calib: null };
const DEFAULT_MIN_BRIGHT = 0.1;
const CALIB_BALLS = 5;
const SOUND_WINDOW_MS = 2500;
const FIRE_TIMEOUT_MS = 5000;
const METHODS = { restart: 'Restart each shot', pause: 'Pause → resume' };

const db = v => 20 * Math.log10(Math.max(v, 1e-5));
const ms = v => (v == null ? '–' : `${Math.round(v)} ms`);
const median = a => {
  const s = a.filter(v => v != null).sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

function loadTrials() {
  try { return JSON.parse(localStorage.getItem(TRIALS_KEY) ?? '[]'); } catch { return []; }
}
function saveTrials(trials) {
  try { localStorage.setItem(TRIALS_KEY, JSON.stringify(trials.slice(0, 50))); } catch { /* storage full or blocked */ }
}

export function render(view, ctx) {
  ctx.setTitle('Serve Lab');
  const cfg = store.settings.lab = { ...DEFAULTS, ...store.settings.lab };
  const save = () => store.saveSettings();
  const robot = ctx.robot;
  const mic = new Mic();
  const serve = new ServeDetector({ triggerOn: cfg.triggerOn, maxGapMs: cfg.maxGapMs });
  const onsets = [];   // recent clicks, for the robot test's "first sound"
  const log = [];      // recent clicks, for display
  let runStart = 0, serves = 0, flashUntil = 0;
  let trials = loadTrials();
  let phase = 'idle';  // robot test: idle | arming | armed | firing
  let trial = null;
  let calib = null;    // calibration run in progress: { t0, shots, timer }
  let closed = false;
  const detectorOptions = () => ({ sensitivity: cfg.sensitivity, floorDb: cfg.calib?.floorDb ?? null, minBright: cfg.calib?.minBright ?? DEFAULT_MIN_BRIGHT });

  view.innerHTML = `
    <div class="card">
      <h3>1 · Bounce detection</h3>
      <div class="hint">Put the phone on your side of the table, out of the ball's way. A serve makes quick sounds:
        your paddle, the bounce on your side, then the bounce on the far side. The light turns on at the sound
        number picked below.</div>
      <button class="btn" id="mic-btn" style="width:100%;margin:12px 0 6px">Start listening</button>
      <div class="hint" id="mic-info"></div>
      <div class="lab-meter" title="Live level (green) and the level a sound must pass (red)"><div class="lvl"></div><div class="thr"></div></div>
      <div class="lab-light" id="light"><b id="light-title">Far bounce</b><span id="light-sub">Not listening</span></div>
      <div class="lab-dots" id="dots"></div>
      <div id="mic-params"></div>
      <div class="param" id="calib"></div>
      <div class="lab-log" id="log"></div>
    </div>
    <div class="card">
      <h3>2 · Robot reaction time</h3>
      <div class="hint">How long the robot takes to fire after the app's command. <b>Fired</b> is when the robot
        reports the ball. <b>Sound</b> is the first sounds the mic hears after the command (needs listening on in
        card 1); with the phone on your side that is the launch or the ball landing near you.</div>
      <div class="muted" id="robot-state" style="margin:10px 0"></div>
      <select class="lab-select" id="ball"></select>
      <div id="robot-params"></div>
      <div id="method" style="margin-top:10px"></div>
      <div class="hint" id="method-hint" style="margin-top:8px"></div>
      <div class="lab-actions">
        <button class="btn ghost" id="arm">Arm</button>
        <button class="btn" id="fire">Fire</button>
        <button class="btn ghost" id="stop">Stop</button>
      </div>
      <div class="row-between" style="padding:6px 0 10px">
        <span class="param-label">Fire automatically when a serve is detected (card 1)</span>
        <button class="switch ${cfg.autoFire ? 'on' : ''}" id="auto"></button>
      </div>
      <div id="summary"></div>
      <div id="trials"></div>
      <div class="row-between" style="margin-top:10px">
        <button class="btn small ghost" id="copy">Copy results</button>
        <button class="btn small danger" id="clear">Clear</button>
      </div>
    </div>`;

  // ---------- 1. Bounce detection ----------

  const micParams = $('#mic-params', view);
  micParams.append(
    paramRow({ label: 'Sensitivity', value: cfg.sensitivity, min: 1, max: 10, step: 1,
      onChange: v => { cfg.sensitivity = v; save(); mic.setOptions({ sensitivity: v }); } }),
  );
  const trig = document.createElement('div');
  trig.className = 'param';
  trig.innerHTML = `<div class="param-label" style="margin-bottom:8px">Light up on sound number</div>`;
  trig.append(segmented([{ value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }], cfg.triggerOn, v => {
    cfg.triggerOn = v; save(); serve.setOptions({ triggerOn: v }); serve.reset(); paintDots(0);
  }));
  trig.insertAdjacentHTML('beforeend', `<div class="hint" style="margin-top:6px">3rd = paddle, your bounce, far bounce.
    Pick 2nd if your paddle hit doesn't show up in the list below.</div>`);
  micParams.append(trig,
    paramRow({ label: 'Max gap between a serve\'s sounds (ms)', value: cfg.maxGapMs, min: 300, max: 2000, step: 50,
      onChange: v => { cfg.maxGapMs = v; save(); serve.setOptions({ maxGapMs: v }); } }));
  const vib = document.createElement('div');
  vib.className = 'row-between param';
  vib.innerHTML = `<span class="param-label">Vibrate on detection</span><button class="switch ${cfg.vibrate ? 'on' : ''}"></button>`;
  vib.querySelector('button').addEventListener('click', e => {
    cfg.vibrate = !cfg.vibrate; save(); e.currentTarget.classList.toggle('on', cfg.vibrate);
  });
  micParams.append(vib);

  const micBtn = $('#mic-btn', view), micInfo = $('#mic-info', view);
  const lvl = $('.lab-meter .lvl', view), thr = $('.lab-meter .thr', view);
  const light = $('#light', view), lightSub = $('#light-sub', view), dots = $('#dots', view);
  const meterPos = v => `${Math.min(100, Math.max(0, (db(v) + 80) / 80 * 100))}%`;

  micBtn.addEventListener('click', async () => {
    if (mic.running) {
      mic.stop();
      paintMic();
      return;
    }
    if (!Mic.supported) return toast('This browser has no microphone access for web apps.', 4000);
    micBtn.disabled = true;
    try {
      await mic.start(detectorOptions());
      serve.reset();
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone failed: ${e?.message ?? e}`, 4000);
    }
    micBtn.disabled = false;
    paintMic();
  });

  function paintMic() {
    micBtn.textContent = mic.running ? 'Stop listening' : 'Start listening';
    micBtn.classList.toggle('ghost', mic.running);
    const i = mic.info;
    micInfo.innerHTML = mic.running && i
      ? `${(i.sampleRate / 1000).toFixed(1)} kHz · audio latency ≈ ${i.baseLatencyMs} ms · screen kept on`
        + (i.processing.length ? `<br><b style="color:var(--danger)">The phone kept ${esc(i.processing.join(', '))} on, so quiet bounces may be missed.</b>` : '')
      : '';
    if (!mic.running) { lvl.style.width = '0'; lightSub.textContent = 'Not listening'; }
    else if (calib) lightSub.textContent = 'Calibrating: robot balls…';
    else if (performance.now() > flashUntil) lightSub.textContent = `Waiting for a serve · ${serves} detected`;
    paintCalib();
  }

  mic.addEventListener('level', e => {
    lvl.style.width = meterPos(e.detail.peak);
    thr.style.left = meterPos(e.detail.threshold);
  });

  mic.addEventListener('onset', e => {
    const o = e.detail;
    onsets.push(o);
    while (onsets.length > 200) onsets.shift();
    if (o.dull || calib) {
      log.unshift({ dull: o.dull, calib: !!calib, level: db(o.peakHp), bright: o.bright });
      log.length = Math.min(log.length, 14);
      return paintLog();
    }
    const r = serve.push(o.perf);
    if (r.n === 1) runStart = o.perf;
    log.unshift({ ...r, dt: r.ignored ? null : o.perf - runStart, level: db(o.peakHp), bright: o.bright });
    log.length = Math.min(log.length, 14);
    paintLog();
    if (!r.trigger) return paintDots(r.n);
    serves++;
    flashUntil = performance.now() + 1200;
    paintDots(cfg.triggerOn);
    light.classList.add('hit');
    lightSub.textContent = `Detected · serve ${serves}`;
    if (cfg.vibrate) navigator.vibrate?.(80);
    if (cfg.autoFire) fire(o.perf);
  });

  function paintDots(n) {
    dots.innerHTML = Array.from({ length: cfg.triggerOn }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  }

  function paintLog() {
    $('#log', view).innerHTML = log.length
      ? '<div class="hint" style="margin:8px 0 2px">Sounds heard (newest first): number in the serve, time since the first, level, brightness</div>'
        + log.map(l => `<div class="${l.trigger ? 'trig' : ''}">${l.calib ? `— calibration${l.dull ? ' (dull)' : ''}`
          : l.dull ? '— dull thump, not counted'
          : l.ignored ? '— ignored (just after a serve)'
          : `#${l.n} · +${(l.dt / 1000).toFixed(2)} s`} · ${l.level.toFixed(0)} dB · ${l.bright.toFixed(2)}${l.trigger ? ' ← far bounce' : ''}</div>`).join('')
      : '';
  }

  // Clears the dots once a run goes quiet, and ends the flash.
  const ticker = setInterval(() => {
    const now = performance.now();
    if (now < flashUntil) return;
    if (light.classList.contains('hit')) { light.classList.remove('hit'); paintMic(); }
    paintDots(serve.count(now));
  }, 100);

  // ---------- 2. Robot reaction time ----------

  const ballSel = $('#ball', view);
  const robotParams = $('#robot-params', view);
  robotParams.append(paramRow({ label: 'Frequency (higher = shorter wait between balls)', value: cfg.freq, min: 0, max: 100, step: 10,
    onChange: v => { cfg.freq = v; save(); } }));
  $('#method', view).append(segmented(Object.entries(METHODS).map(([value, label]) => ({ value, label })), cfg.method, v => {
    if (phase !== 'idle') stopRobot();
    cfg.method = v; save(); paintRobot();
  }));

  const device = () => robot.model ?? store.settings.device;
  const ready = () => robot.connection === 'ready' && !ctx.runner.active;

  function paintBalls() {
    const d = device();
    const opts = store.drills.filter(x => x.device === d)
      .flatMap(x => x.balls.map((_, i) => ({ value: `${x.id}:${i}`, label: `${x.name || 'Untitled drill'} · ball ${i + 1}` })));
    ballSel.innerHTML = `<option value="">Default ball</option>`
      + opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    ballSel.value = opts.some(o => o.value === cfg.ball) ? cfg.ball : '';
  }
  ballSel.addEventListener('change', () => { cfg.ball = ballSel.value; save(); });

  function buildBall(reps = 1) {
    const dev = device();
    const [id, idx] = (ballSel.value || '').split(':');
    const src = store.get(id);
    const drill = src?.device === dev ? src : newDrill(dev === 'halo' ? 1 : 10, 2, dev);
    const ball = drill.balls[Number(idx) || 0] ?? drill.balls[0];
    const shot = { ...rollBall(ball, Math.random, dev), freq: cfg.freq };
    return packBall(shot, reps, dev, drill.position);
  }

  // ---------- Calibration: robot balls teach the detector what a bounce sounds like ----------

  async function calibrate() {
    if (!mic.running) return toast('Start listening first');
    if (!ready() || phase !== 'idle') return toast('Connect the robot first (card 2), with nothing running');
    calib = { t0: performance.now(), shots: [], timer: setTimeout(endCalib, 25000) };
    phase = 'calibrating';
    paintMic();
    paintRobot();
    if (!await send(drillPacket([buildBall(CALIB_BALLS)], MODE.groups, 1, false))) cancelCalib();
  }

  function cancelCalib() {
    if (!calib) return;
    clearTimeout(calib.timer);
    calib = null;
    phase = 'idle';
    paintMic();
    paintRobot();
  }

  function calibShot(now) {
    calib.shots.push(now);
    if (calib.shots.length >= CALIB_BALLS) { clearTimeout(calib.timer); calib.timer = setTimeout(endCalib, 1500); }
  }

  function endCalib() {
    const c = calib;
    if (!c) return;
    const res = analyzeCalibration(c.shots, onsets.filter(o => o.perf >= c.t0));
    cancelCalib();
    if (!res) {
      toast(c.shots.length
        ? 'Heard fewer than 2 bounces. Raise the sensitivity or move the phone nearer to where the balls land, then try again.'
        : 'The robot fired no balls.', 5000);
      return;
    }
    cfg.calib = { ...res, at: new Date().toISOString() };
    save();
    mic.setOptions(detectorOptions());
    paintCalib();
    toast(`Calibrated from ${res.heard} of ${res.balls} balls`);
  }

  function paintCalib() {
    if (closed) return;
    const c = cfg.calib;
    const canRun = mic.running && ready() && phase === 'idle';
    $('#calib', view).innerHTML = `
      <div class="param-label" style="margin-bottom:6px"><b>Calibrate with the robot</b></div>
      <div class="hint">The robot fires ${CALIB_BALLS} balls of the ball picked in card 2 at your side. The app learns how loud
        and how sharp a bounce is next to the phone, and how quiet the far end of the table sounds (the robot's launch),
        then sets the detector to match. Keep the phone out of the balls' way.</div>
      ${c ? `<div class="lab-sum" style="margin-top:8px">Bounce near the phone ${c.bounceDb} dB · far-end launch
        ${c.launchDb == null ? 'not heard' : `${c.launchDb} dB`} · bounce brightness ≥ ${c.bounceBright}<br>
        → counts sounds above <b>${c.floorDb} dB</b> with brightness ≥ <b>${c.minBright}</b>
        <span class="hint">(${esc(new Date(c.at).toLocaleString())})</span></div>` : ''}
      <div class="lab-actions">
        <button class="btn ${c ? 'ghost' : ''}" data-calib="run" ${canRun ? '' : 'disabled'}>${calib ? 'Calibrating…' : c ? 'Calibrate again' : `Calibrate (${CALIB_BALLS} balls)`}</button>
        ${c ? '<button class="btn small danger" data-calib="reset">Reset</button>' : ''}
      </div>
      ${canRun || calib ? '' : `<div class="hint">${mic.running ? 'Connect the robot to calibrate.' : 'Start listening to calibrate.'}</div>`}`;
  }

  $('#calib', view).addEventListener('click', e => {
    const act = e.target.closest('[data-calib]')?.dataset.calib;
    if (act === 'run') calibrate();
    if (act === 'reset') { cfg.calib = null; save(); mic.setOptions(detectorOptions()); paintCalib(); }
  });

  async function send(bytes) {
    try {
      await robot.send(bytes);
      return true;
    } catch (e) {
      toast(`Send failed: ${e?.message ?? e}`, 3500);
      return false;
    }
  }

  async function arm() {
    if (!ready() || phase !== 'idle') return;
    phase = 'arming';
    paintRobot();
    if (!await send(drillPacket([buildBall()], MODE.endless, 0, false))) phase = 'idle';
    paintRobot();
  }

  async function fire(servePerf = null) {
    if (!ready() || phase === 'firing' || phase === 'arming' || phase === 'calibrating') return;
    if (cfg.method === 'pause' && phase !== 'armed') return toast('Tap Arm first');
    const t0 = performance.now();
    trial = { method: cfg.method, device: device(), at: new Date().toISOString(), t0,
      servePerf, ackMs: null, firedMs: null, extraBalls: 0, sounds: null };
    phase = 'firing';
    paintRobot();
    const ok = await send(cfg.method === 'restart' ? drillPacket([buildBall()], MODE.groups, 1, false) : CMD.resume);
    if (!trial) return;
    trial.writeMs = performance.now() - t0;
    if (!ok) { trial = null; phase = cfg.method === 'pause' ? 'armed' : 'idle'; return paintRobot(); }
    trial.timer = setTimeout(() => finishTrial(null), FIRE_TIMEOUT_MS);
  }

  function finishTrial(firedPerf) {
    const t = trial;
    if (!t) return;
    trial = null;
    clearTimeout(t.timer);
    delete t.timer;
    t.firedMs = firedPerf == null ? null : firedPerf - t.t0;
    if (t.servePerf != null && firedPerf != null) t.serveToFiredMs = firedPerf - t.servePerf;
    if (t.method === 'pause') { send(CMD.pause); phase = 'armed'; } else phase = 'idle';
    trials.unshift(t);
    trials = trials.slice(0, 50);
    // The sounds of the shot arrive after the robot's report: collect them a bit later.
    setTimeout(() => {
      t.sounds = mic.running
        ? onsets.filter(o => o.perf > t.t0 && o.perf <= t.t0 + SOUND_WINDOW_MS).slice(0, 3).map(o => Math.round(o.perf - t.t0))
        : null;
      saveTrials(trials);
      paintTrials();
    }, Math.max(0, t.t0 + SOUND_WINDOW_MS - performance.now()));
    saveTrials(trials);
    paintRobot();
  }

  function stopRobot() {
    if (trial) { clearTimeout(trial.timer); trial = null; }
    if (calib) { clearTimeout(calib.timer); calib = null; paintMic(); }
    if (phase !== 'idle' && robot.connection === 'ready') send(CMD.stop);
    phase = 'idle';
    paintRobot();
  }

  function onRobotMsg(e) {
    const msg = e.detail, now = performance.now();
    if (msg.type === 'drillAck' && !msg.ok && phase !== 'idle') {
      toast('The robot rejected the ball');
      if (trial) { clearTimeout(trial.timer); trial = null; }
      if (calib) return cancelCalib();
      phase = 'idle';
      return paintRobot();
    }
    if (phase === 'calibrating' && calib) {
      if (msg.type === 'progress') calibShot(now);
      if (msg.type === 'status' && msg.state === STATE.complete) { clearTimeout(calib.timer); calib.timer = setTimeout(endCalib, 1500); }
    } else if (phase === 'firing' && trial) {
      if ((msg.type === 'drillAck' || msg.type === 'controlAck') && trial.ackMs == null) trial.ackMs = now - trial.t0;
      if (msg.type === 'progress') finishTrial(now);
    } else if (phase === 'arming' && msg.type === 'progress') {
      send(CMD.pause);
      phase = 'armed';
      paintRobot();
    } else if (phase === 'armed' && msg.type === 'progress' && trials[0]?.method === 'pause') {
      // A ball fired before the pause landed.
      trials[0].extraBalls++;
      saveTrials(trials);
      paintTrials();
    }
  }
  const onConnection = () => {
    if (robot.connection !== 'ready') {
      if (trial) { clearTimeout(trial.timer); trial = null; }
      if (calib) { clearTimeout(calib.timer); calib = null; paintMic(); }
      phase = 'idle';
    }
    paintBalls();
    paintRobot();
  };
  robot.addEventListener('message', onRobotMsg);
  robot.addEventListener('connection', onConnection);

  const stateEl = $('#robot-state', view);
  const armBtn = $('#arm', view), fireBtn = $('#fire', view), stopBtn = $('#stop', view);
  armBtn.addEventListener('click', arm);
  fireBtn.addEventListener('click', () => fire());
  stopBtn.addEventListener('click', stopRobot);
  $('#auto', view).addEventListener('click', e => {
    cfg.autoFire = !cfg.autoFire; save(); e.currentTarget.classList.toggle('on', cfg.autoFire);
  });

  function paintRobot() {
    if (closed) return;
    const pause = cfg.method === 'pause';
    $('#method-hint', view).textContent = pause
      ? 'Arm starts an endless drill, lets one ball fire, then pauses. Each Fire resumes and pauses again after the ball. While armed, check whether the wheels keep spinning: that decides how fast this can be.'
      : 'Each Fire sends a new 1-ball drill, so the wheels may stop and spin up again every time.';
    armBtn.hidden = !pause;
    let state;
    if (robot.connection !== 'ready') state = 'Not connected. Use the status button at the top right.';
    else if (ctx.runner.active) state = 'A drill is running. Stop it first.';
    else state = { idle: pause ? 'Ready. Tap Arm.' : 'Ready.', arming: 'Arming: waiting for the first ball…',
      armed: 'Armed: robot paused.', firing: 'Firing…', calibrating: 'Calibrating the microphone (card 1)…' }[phase];
    stateEl.textContent = `${robot.name ? `${robot.name} · ` : ''}${state}`;
    armBtn.disabled = !ready() || phase !== 'idle';
    fireBtn.disabled = !ready() || phase === 'firing' || phase === 'arming' || phase === 'calibrating' || (pause && phase !== 'armed');
    stopBtn.disabled = robot.connection !== 'ready';
    paintTrials();
    paintCalib();
  }

  function paintTrials() {
    if (closed) return;
    const row = t => `<div class="lab-trial"><b>${esc(METHODS[t.method] ?? t.method)}</b>${t.servePerf != null ? ' · auto' : ''}
      <span class="hint">${esc(new Date(t.at).toLocaleTimeString())} · ${esc(t.device)}</span><br>
      ack ${ms(t.ackMs)} · fired ${t.firedMs == null ? 'no ball within 5 s' : ms(t.firedMs)}
      · sound ${t.sounds == null ? (mic.running ? '…' : 'mic off') : t.sounds.length ? t.sounds.map(ms).join(', ') : 'none'}
      ${t.serveToFiredMs != null ? `<br>far bounce → fired ${ms(t.serveToFiredMs)}` : ''}
      ${t.extraBalls ? `<br><b style="color:var(--danger)">${t.extraBalls} extra ball(s) before the pause landed</b>` : ''}</div>`;
    $('#trials', view).innerHTML = trials.slice(0, 12).map(row).join('') || '<div class="hint">No tries yet.</div>';
    $('#summary', view).innerHTML = Object.keys(METHODS).map(m => {
      const ts = trials.filter(t => t.method === m && t.device === device());
      if (!ts.length) return '';
      return `<div class="lab-sum"><b>${esc(METHODS[m])}</b>: median fired ${ms(median(ts.map(t => t.firedMs)))}
        · first sound ${ms(median(ts.map(t => t.sounds?.[0])))} <span class="hint">(${ts.length} tries)</span></div>`;
    }).join('');
  }

  $('#copy', view).addEventListener('click', async () => {
    const text = JSON.stringify({ app: 'novaplus-lab', version: 1, mic: mic.info, settings: cfg, trials,
      sounds: log.slice(0, 14) }, null, 1);
    try { await navigator.clipboard.writeText(text); toast('Results copied'); } catch { toast('Copy failed'); }
  });
  $('#clear', view).addEventListener('click', () => { trials = []; saveTrials(trials); paintTrials(); });

  paintMic();
  paintDots(0);
  paintBalls();
  paintRobot();

  return () => {
    clearInterval(ticker);
    mic.stop();
    robot.removeEventListener('message', onRobotMsg);
    robot.removeEventListener('connection', onConnection);
    stopRobot();
    closed = true;
  };
}

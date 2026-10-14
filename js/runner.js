// Runs a drill on the robot and reports progress.
//
// Fixed drills are uploaded once with the official mode/count/random header
// and the robot loops them. Drills with variation are fed in batches from
// the scheduler, each batch with freshly rolled shots.
import { CMD, MODE, STATE, drillPacket, packBall } from './core/protocol.js';
import { drillHasVariation, nextBatch, MAX_BALLS } from './core/scheduler.js';
import { rollBall } from './core/variation.js';
import { deviceOf } from './core/devices.js';
import * as timing from './core/timing.js';

export class Runner extends EventTarget {
  constructor(robot) {
    super();
    this.robot = robot;
    this.session = null;
    robot.addEventListener('message', e => this.#onMessage(e.detail));
    robot.addEventListener('connection', e => {
      if (e.detail !== 'ready' && this.session) this.#finish('disconnected');
    });
  }

  get active() {
    return !!this.session;
  }

  /**
   * kind: 'drill' (uses drill.mode/groups/minutes/sequence),
   * 'ballTest' (one ball served 5 times) or 'comboTest' (2 cycles).
   * With `deferred`, nothing is sent until begin() (used for the countdown).
   */
  start(drill, kind = 'drill', ballIndex = 0, { deferred = false } = {}) {
    if (this.robot.model && drill.device && this.robot.model !== drill.device) {
      throw new Error(`This drill is for the ${deviceOf(drill).name}, but a ${deviceOf(this.robot.model).name} is connected.`);
    }
    if (this.session) this.stop();
    let plan = drill;
    if (kind === 'ballTest') {
      plan = { ...drill, balls: [{ ...drill.balls[ballIndex], reps: 5 }], mode: 'groups', groups: 1, sequence: 'sequential' };
    } else if (kind === 'comboTest') {
      plan = { ...drill, mode: 'groups', groups: 2, sequence: 'sequential' };
    }
    const timed = plan.mode === 'time';
    this.session = {
      drill: plan, kind, timed,
      cyclesTotal: timed ? Infinity : plan.groups,
      timeTotalMs: timed ? plan.minutes * 60000 : 0,
      cyclesDone: 0, elapsedMs: 0, resumedAt: Date.now(), paused: false,
      varied: drillHasVariation(plan), entries: [], batchCycles: 0, pending: [],
      shot: null, shotCount: 0, waiting: true, timing: timing.newTiming(), batchNo: 0,
    };
    this.session.tick = setInterval(() => this.#tick(), 250);
    if (!deferred) this.begin();
    this.#emit();
  }

  begin() {
    const s = this.session;
    if (!s?.waiting) return;
    s.waiting = false;
    s.resumedAt = Date.now();
    s.timing = timing.newTiming(s.resumedAt);
    if (s.varied) this.#sendBatch();
    else this.#sendNative();
    this.#emit();
  }

  pause() {
    const s = this.session;
    if (!s || s.paused || s.waiting) return;
    s.elapsedMs += Date.now() - s.resumedAt;
    s.paused = true;
    timing.onPause(s.timing);
    this.robot.send(CMD.pause);
    this.#emit();
  }

  resume() {
    const s = this.session;
    if (!s || !s.paused) return;
    s.paused = false;
    s.resumedAt = Date.now();
    this.robot.send(CMD.resume);
    this.#emit();
  }

  stop() {
    if (!this.session) return;
    if (!this.session.waiting) this.robot.send(CMD.stop);
    this.#finish('stopped');
  }

  elapsed() {
    const s = this.session;
    if (!s || s.waiting) return 0;
    return s.elapsedMs + (s.paused ? 0 : Date.now() - s.resumedAt);
  }

  #sendNative() {
    const d = this.session.drill;
    const balls = d.balls.slice(0, MAX_BALLS).map(b => packBall(rollBall(b, Math.random, d.device), b.reps, d.device, d.position));
    this.session.entries = d.balls.map((b, i) => ({ ballIndex: i, shot: rollBall(b, Math.random, d.device), reps: b.reps }));
    const packet = d.mode === 'time'
      ? drillPacket(balls, MODE.minutes, d.minutes, d.sequence === 'random')
      : drillPacket(balls, MODE.groups, d.groups, d.sequence === 'random');
    this.robot.send(packet);
  }

  #sendBatch() {
    const s = this.session;
    const left = s.cyclesTotal - s.cyclesDone;
    const batch = nextBatch(s.drill, left, Math.random, s.pending);
    s.entries = batch.entries;
    s.batchCycles = batch.cycles;
    s.pending = batch.rest;
    const d = s.drill;
    this.robot.send(drillPacket(batch.entries.map(e => packBall(e.shot, e.reps, d.device, d.position)), MODE.groups, 1, false));
    timing.onBatchSent(s.timing, Date.now(), s.batchNo++ === 0);
  }

  #onMessage(msg) {
    const s = this.session;
    if (!s) return;
    if (!s.waiting) timing.onMessage(s.timing, msg);
    if (msg.type === 'drillAck' && !msg.ok) {
      this.#finish('rejected');
    } else if (msg.type === 'progress') {
      if (!s.varied) s.cyclesDone = Math.max(0, msg.group - 1);
      const entry = s.entries[msg.ball - 1];
      if (entry) {
        s.shot = entry;
        s.shotCount++;
      }
      this.#emit();
    } else if (msg.type === 'status' && msg.state === STATE.complete) {
      if (!s.varied) return this.#finish('done');
      timing.onComplete(s.timing);
      s.cyclesDone += s.batchCycles;
      const timeUp = s.timed && this.elapsed() >= s.timeTotalMs;
      if (!s.pending.length && (timeUp || s.cyclesDone >= s.cyclesTotal)) return this.#finish('done');
      this.#sendBatch();
      this.#emit();
    }
  }

  #tick() {
    const s = this.session;
    if (!s) return;
    if (s.timed && s.varied && !s.paused && !s.waiting && this.elapsed() >= s.timeTotalMs) {
      this.robot.send(CMD.stop);
      return this.#finish('done');
    }
    this.dispatchEvent(new CustomEvent('tick'));
  }

  #finish(reason) {
    const s = this.session;
    if (!s) return;
    clearInterval(s.tick);
    this.session = null;
    if (s.timing.log.some(m => m.type === 'progress')) {
      timing.saveTimingSession({
        at: new Date().toISOString(), device: s.drill.device, robot: this.robot.name ?? null,
        drill: s.drill.name, kind: s.kind, varied: s.varied, reason,
        summary: timing.summarize(s.timing), gaps: s.timing.gaps, log: s.timing.log,
      });
    }
    this.dispatchEvent(new CustomEvent('finish', { detail: { reason, drill: s.drill, kind: s.kind } }));
    this.#emit();
  }

  #emit() {
    this.dispatchEvent(new CustomEvent('update'));
  }
}

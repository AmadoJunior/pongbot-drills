// Runs a drill on the robot and reports progress.
//
// Fixed drills are uploaded once with the official mode/count/random header
// and the robot loops them. Drills with variation are fed in batches from
// the scheduler, each batch with freshly rolled shots:
// - Nova, seamless (smee's method, see re/evidence/community_smee_nova.md):
//   the drill runs in endless mode and right after the last shot of a batch
//   the next batch replaces the balls with 0x84, so the wheels keep running.
//   0x84 needs the same number of balls each time, so every batch is the same
//   number of whole combos.
// - Otherwise (Halo, which has no live edit, or a combo longer than one
//   batch): wait for "complete", then start the next batch with a new 0x81.
import { CMD, MODE, STATE, drillPacket, modifyPacket, packBall } from './core/protocol.js';
import { drillHasVariation, nextBatch, buildCycle, MAX_BALLS } from './core/scheduler.js';
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
      seamlessCycles: 0, shotsInBatch: 0, batchShots: 0, cycleEnds: [],
    };
    if (this.session.varied && deviceOf(plan).id === 'nova') {
      // Every combo has the same number of entries (shuffling keeps the count).
      const len = buildCycle(plan).length;
      if (len <= MAX_BALLS) this.session.seamlessCycles = Math.floor(MAX_BALLS / len);
    }
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
    if (s.seamlessCycles) this.#sendSeamless();
    else if (s.varied) this.#sendBatch();
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

  // Next batch of whole combos: started with 0x81 (endless) the first time,
  // then swapped in with 0x84. Records where each combo ends, in shots.
  #sendSeamless() {
    const s = this.session;
    const d = s.drill;
    const entries = [];
    s.cycleEnds = [];
    let shots = 0;
    for (let c = 0; c < s.seamlessCycles; c++) {
      for (const e of buildCycle(d)) {
        entries.push(e);
        shots += e.reps;
      }
      s.cycleEnds.push(shots);
    }
    s.entries = entries;
    s.batchShots = shots;
    s.shotsInBatch = 0;
    const balls = entries.map(e => packBall(e.shot, e.reps, d.device, d.position));
    const first = s.batchNo++ === 0;
    this.robot.send(first ? drillPacket(balls, MODE.endless, 0, false) : modifyPacket(balls));
    timing.onBatchSent(s.timing, Date.now(), first);
  }

  #onSeamlessShot() {
    const s = this.session;
    s.shotsInBatch++;
    while (s.cycleEnds.length && s.shotsInBatch >= s.cycleEnds[0]) {
      s.cycleEnds.shift();
      s.cyclesDone++;
    }
    if (!s.timed && s.cyclesDone >= s.cyclesTotal) {
      this.robot.send(CMD.stop);
      return this.#finish('done');
    }
    // The last shot of the batch just fired: swap in the next one before the
    // robot loops back to its first ball.
    if (s.shotsInBatch >= s.batchShots) this.#sendSeamless();
  }

  #onMessage(msg) {
    const s = this.session;
    if (!s) return;
    if (!s.waiting) timing.onMessage(s.timing, msg);
    if (msg.type === 'drillAck' && !msg.ok) {
      this.#finish('rejected');
    } else if (msg.type === 'progress' && s.seamlessCycles) {
      const entry = s.entries[msg.ball - 1];
      if (entry) {
        s.shot = entry;
        s.shotCount++;
      }
      this.#onSeamlessShot();
      this.#emit();
    } else if (msg.type === 'progress') {
      if (!s.varied) s.cyclesDone = Math.max(0, msg.group - 1);
      const entry = s.entries[msg.ball - 1];
      if (entry) {
        s.shot = entry;
        s.shotCount++;
      }
      this.#emit();
    } else if (msg.type === 'status' && msg.state === STATE.complete) {
      if (!s.varied || s.seamlessCycles) return this.#finish('done');
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

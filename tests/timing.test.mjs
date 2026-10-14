import test from 'node:test';
import assert from 'node:assert/strict';
import { newTiming, onMessage, onComplete, onBatchSent, onPause, summarize } from '../js/core/timing.js';

const shot = (t, ms) => onMessage(t, { type: 'progress', group: 1, ball: 1, time: 0 }, ms);

test('batch gap is measured from the last shot to the first shot of the next batch', () => {
  const t = newTiming(0);
  onBatchSent(t, 0, true);
  shot(t, 600); shot(t, 1600); shot(t, 2600);       // spacing 1000
  onComplete(t, 3600);
  onBatchSent(t, 3620);
  shot(t, 4300);                                     // gap 1700
  shot(t, 5300);
  const s = summarize(t);
  assert.equal(s.spacingMs, 1000);
  assert.equal(s.batches, 1);
  assert.equal(s.gapMs, 1700);
  assert.equal(s.extraMs, 700);
  assert.deepEqual(t.gaps[0], { gapMs: 1700, lastShotToCompleteMs: 1000, completeToSentMs: 20, sentToFirstShotMs: 680 });
  assert.equal(s.shots, 5);
});

test('a pause does not count as spacing or gap', () => {
  const t = newTiming(0);
  onBatchSent(t, 0, true);
  shot(t, 500); shot(t, 1500);
  onPause(t, 1700);
  shot(t, 9000); shot(t, 10000);
  assert.deepEqual(t.spacings, [1000, 1000]);
  assert.equal(summarize(t).batches, 0);
});

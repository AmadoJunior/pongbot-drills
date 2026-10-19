// Shot timing diagnostics: measures the pause between upload batches of a
// varied drill against the normal spacing between shots, and keeps a raw log
// of robot messages so the protocol timing can be checked later.
//
// Each progress notification counts as one shot (true in the simulator; to be
// confirmed on the robot, which is why the raw log is kept).

const LOG_MAX = 400;
const STORAGE_KEY = 'novaplus.timing.v1';
const KEEP_SESSIONS = 10;

export function newTiming(now = Date.now()) {
  return { t0: now, log: [], spacings: [], gaps: [], lastShotAt: null, completeAt: null, sentAt: null, awaitingFirst: false };
}

function log(t, now, entry) {
  if (t.log.length < LOG_MAX) t.log.push({ ms: now - t.t0, ...entry });
}

/** A robot notification arrived. */
export function onMessage(t, msg, now = Date.now()) {
  log(t, now, msg);
  if (msg.type !== 'progress') return;
  if (t.awaitingFirst) {
    if (t.lastShotAt != null) {
      t.gaps.push({
        gapMs: now - t.lastShotAt,
        lastShotToCompleteMs: t.completeAt - t.lastShotAt,
        completeToSentMs: t.sentAt - t.completeAt,
        sentToFirstShotMs: now - t.sentAt,
      });
    }
    t.awaitingFirst = false;
  } else if (t.lastShotAt != null) {
    t.spacings.push(now - t.lastShotAt);
  }
  t.lastShotAt = now;
}

/** The robot reported a batch complete. */
export function onComplete(t, now = Date.now()) {
  t.completeAt = now;
}

/** The next batch was uploaded. */
export function onBatchSent(t, now = Date.now(), first = false) {
  log(t, now, { type: 'sent' });
  t.sentAt = now;
  if (!first) t.awaitingFirst = true;
}

/** Pausing breaks the timing chain; the next shot starts a fresh measurement. */
export function onPause(t, now = Date.now()) {
  log(t, now, { type: 'pause' });
  t.lastShotAt = null;
  t.awaitingFirst = false;
}

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function summarize(t) {
  const spacing = median(t.spacings);
  const gap = t.gaps.length ? t.gaps.reduce((a, g) => a + g.gapMs, 0) / t.gaps.length : null;
  return {
    shots: t.spacings.length + t.gaps.length + (t.lastShotAt != null ? 1 : 0),
    batches: t.gaps.length,
    spacingMs: spacing,
    gapMs: gap,
    lastGapMs: t.gaps.at(-1)?.gapMs ?? null,
    extraMs: gap != null && spacing != null ? gap - spacing : null,
  };
}

export function loadTimingSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

/** Best effort: a full or missing storage must never break ending a drill. */
export function saveTimingSession(record) {
  try {
    const all = [record, ...loadTimingSessions()].slice(0, KEEP_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('timing log not saved', e);
  }
}

export function clearTimingSessions() {
  localStorage.removeItem(STORAGE_KEY);
}

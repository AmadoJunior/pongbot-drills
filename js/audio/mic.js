// Microphone click listener. Events:
//   'onset' detail { perf (performance.now() ms of the sound), arrived, peak, peakHp, bg, bright, rise }
//   'level' detail { peak, threshold }  (high-passed, full scale = 1)
// The phone's echo cancellation, noise suppression and auto gain are turned
// off: they flatten or cut exactly the short clicks we listen for.
export class Mic extends EventTarget {
  #ctx = null;
  #stream = null;
  #node = null;
  #wake = null;
  #onVisible = null;
  info = null;

  static get supported() {
    return !!(globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.AudioWorkletNode);
  }

  get running() {
    return !!this.#ctx;
  }

  async start(options = {}) {
    if (this.#ctx) return;
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.#ctx = ctx;
      await ctx.audioWorklet.addModule(new URL('./onset-worklet.js', import.meta.url));
      const src = ctx.createMediaStreamSource(this.#stream);
      const node = new AudioWorkletNode(ctx, 'onset', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: options });
      // The node has to reach the output to be run; a zero gain keeps it silent.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(node).connect(mute).connect(ctx.destination);
      node.port.onmessage = e => this.#onMessage(e.data);
      this.#node = node;
      await ctx.resume();
      const t = this.#stream.getAudioTracks()[0]?.getSettings?.() ?? {};
      this.info = {
        sampleRate: ctx.sampleRate,
        baseLatencyMs: Math.round((ctx.baseLatency ?? 0) * 1000),
        processing: ['echoCancellation', 'noiseSuppression', 'autoGainControl'].filter(k => t[k]),
      };
      this.#keepAwake();
    } catch (e) {
      this.stop();
      throw e;
    }
  }

  setOptions(o) {
    this.#node?.port.postMessage(o);
  }

  stop() {
    this.#stream?.getTracks().forEach(t => t.stop());
    this.#ctx?.close().catch(() => {});
    this.#wake?.release().catch(() => {});
    if (this.#onVisible) document.removeEventListener('visibilitychange', this.#onVisible);
    this.#ctx = this.#stream = this.#node = this.#wake = this.#onVisible = null;
  }

  // AudioContext time -> performance.now() time, so clicks can be compared
  // with when BLE commands were sent.
  #perf(ctxTime) {
    const ts = this.#ctx.getOutputTimestamp?.();
    if (!ts?.performanceTime) return performance.now() - (this.#ctx.currentTime - ctxTime) * 1000;
    return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
  }

  #onMessage(m) {
    if (!this.#ctx) return;
    if (m.type === 'onset') {
      const arrived = performance.now();
      this.dispatchEvent(new CustomEvent('onset', { detail: { ...m, perf: Math.min(this.#perf(m.time), arrived), arrived } }));
    } else if (m.type === 'level') {
      this.dispatchEvent(new CustomEvent('level', { detail: m }));
    }
  }

  // The screen must stay on while listening; Android stops the mic otherwise.
  async #keepAwake() {
    const request = async () => {
      try { this.#wake = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
    };
    this.#onVisible = () => { if (document.visibilityState === 'visible' && this.#ctx) request(); };
    document.addEventListener('visibilitychange', this.#onVisible);
    await request();
  }
}

// Runs the click detector on the audio thread, so clicks are timed to the
// sample and the UI thread being busy doesn't delay or drop them.
import { OnsetDetector } from '../core/onset.js';

class OnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.det = new OnsetDetector(sampleRate, options.processorOptions ?? {});
    this.blocks = 0;
    this.port.onmessage = e => this.det.setOptions(e.data);
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    this.det.frame = currentFrame; // keep click times on the AudioContext clock
    for (const ev of this.det.process(ch)) {
      this.port.postMessage({ type: 'onset', time: ev.frame / sampleRate, peak: ev.peak, peakHp: ev.peakHp, bg: ev.bg, bright: ev.bright, rise: ev.rise });
    }
    if (++this.blocks >= 16) { // ~40 ms
      this.blocks = 0;
      this.port.postMessage({ type: 'level', peak: this.det.takeLevel(), threshold: this.det.threshold() });
    }
    return true;
  }
}

registerProcessor('onset', OnsetProcessor);

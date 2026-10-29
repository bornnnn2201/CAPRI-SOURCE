// Her ears on the audio thread (speech.js): the sound in chunks of `size` samples, each a copy of its
// own, posted to the page with how loud each input was in it. Channel 0 is your microphone, channel 1
// the PC's own sound in audience mode (what Discord plays, your game...): she hears both as one, and
// knows from the two levels who was talking. No output: it needs nothing downstream to keep running.

class Ears extends AudioWorkletProcessor {
  constructor({ processorOptions = {} } = {}) {
    super();
    this.size = processorOptions.size || 1024;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.e0 = 0;
    this.e1 = 0;
  }

  process(inputs) {
    const mic = inputs[0]?.[0];
    if (!mic) return true;
    const pc = inputs[0][1];
    for (let i = 0; i < mic.length; i++) {
      const a = mic[i];
      const b = pc ? pc[i] : 0;
      this.e0 += a * a;
      this.e1 += b * b;
      this.buf[this.n++] = pc ? a + b : a;
      if (this.n === this.size) {
        this.port.postMessage({ buf: this.buf, e0: this.e0, e1: this.e1 }, [this.buf.buffer]);
        this.buf = new Float32Array(this.size);
        this.n = 0;
        this.e0 = 0;
        this.e1 = 0;
      }
    }
    return true;
  }
}

registerProcessor('capri-ears', Ears);

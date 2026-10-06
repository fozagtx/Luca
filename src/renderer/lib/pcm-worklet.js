/**
 * Microphone → 16-bit mono PCM for AssemblyAI streaming, on the audio thread. Posts one
 * transferable chunk of `processorOptions.chunk` samples with its RMS level for the meter.
 * Plain JS on purpose: Vite ships it untranspiled for `audioWorklet.addModule`.
 */
class LucaPcm extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.size = options.processorOptions.chunk
    this.buf = new Int16Array(this.size)
    this.n = 0
    this.sum = 0
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]))
      this.sum += v * v
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
      if (this.n === this.size) {
        const pcm = this.buf.buffer
        this.port.postMessage({ pcm, rms: Math.sqrt(this.sum / this.size) }, [pcm])
        this.buf = new Int16Array(this.size)
        this.n = 0
        this.sum = 0
      }
    }
    return true
  }
}

registerProcessor('luca-pcm', LucaPcm)

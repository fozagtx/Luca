// Emitted as a file, never a data: URL: the renderer CSP only allows scripts from 'self'.
import workletUrl from './pcm-worklet.js?url&no-inline'

/** AssemblyAI streaming takes 16 kHz mono PCM; the AudioContext resamples the microphone to it. */
export const MIC_SAMPLE_RATE = 16_000
/** Chunk length streamed to AssemblyAI (it accepts 50–1000 ms). */
const CHUNK_MS = 50

export type Mic = {
  /** Input level 0–1, updated every chunk, for meters. */
  level: () => number
  /** While muted, silence is streamed in place of the microphone so the session stays in step. */
  mute: (muted: boolean) => void
  close: () => void
}

export async function openMic(onPcm: (pcm: ArrayBuffer) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  const ctx = new AudioContext({ sampleRate: MIC_SAMPLE_RATE, latencyHint: 'interactive' })
  let level = 0
  let muted = false
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    level = 0
    for (const t of stream.getTracks()) t.stop()
    void ctx.close().catch(() => undefined)
  }
  try {
    await ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(ctx, 'luca-pcm', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { chunk: (MIC_SAMPLE_RATE * CHUNK_MS) / 1000 }
    })
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      if (closed) return
      level = toLevel(e.data.rms)
      onPcm(muted ? new ArrayBuffer(e.data.pcm.byteLength) : e.data.pcm)
    }
    ctx.createMediaStreamSource(stream).connect(node)
    if (ctx.state === 'suspended') await ctx.resume()
  } catch (err) {
    close()
    throw err
  }
  return {
    level: () => level,
    mute: (m) => {
      muted = m
    },
    close
  }
}

/** RMS → 0–1 across -55…-10 dBFS, roughly the range of speech into a laptop mic. */
function toLevel(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6))
  return Math.min(1, Math.max(0, (db + 55) / 45))
}

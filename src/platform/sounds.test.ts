import { describe, expect, it } from 'vitest'

import {
  SOUND_IDS,
  SOUND_PATTERNS,
  envelopeEvents,
  patternLength,
  voiceEnd,
} from './sound-patterns'
import { renderSound, type OfflineContextFactory } from './sounds'

interface ParamCall {
  readonly method: string
  readonly value: number
  readonly time: number
}

/** An AudioParam that records its automation calls. */
class FakeParam {
  value = 1
  readonly calls: ParamCall[] = []
  setValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'linear', value, time })
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.calls.push({ method: 'exponential', value, time })
  }
}

class FakeNode {
  readonly connections: unknown[] = []
  connect(target: unknown): unknown {
    this.connections.push(target)
    return target
  }
}

class FakeOscillator extends FakeNode {
  type = 'sine'
  readonly frequency = new FakeParam()
  startedAt: number | null = null
  stoppedAt: number | null = null
  start(when: number): void {
    this.startedAt = when
  }
  stop(when: number): void {
    this.stoppedAt = when
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam()
}

/** Records the graph a render builds; `startRendering` returns a buffer holding a test ramp. */
class FakeOfflineContext {
  readonly destination = new FakeNode()
  readonly oscillators: FakeOscillator[] = []
  readonly gains: FakeGain[] = []
  readonly channel: Float32Array
  readonly channels: number
  readonly length: number
  readonly sampleRate: number
  constructor(channels: number, length: number, sampleRate: number) {
    this.channels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.channel = new Float32Array(length)
    // Something to normalize: a ramp from -0.5 to 0.25.
    for (let i = 0; i < length; i++) this.channel[i] = -0.5 + (0.75 * i) / length
  }
  createOscillator(): FakeOscillator {
    const node = new FakeOscillator()
    this.oscillators.push(node)
    return node
  }
  createGain(): FakeGain {
    const node = new FakeGain()
    this.gains.push(node)
    return node
  }
  startRendering(): Promise<unknown> {
    return Promise.resolve({ getChannelData: () => this.channel, length: this.length })
  }
}

function recorder(): { factory: OfflineContextFactory; contexts: FakeOfflineContext[] } {
  const contexts: FakeOfflineContext[] = []
  const factory: OfflineContextFactory = (channels, length, sampleRate) => {
    const ctx = new FakeOfflineContext(channels, length, sampleRate)
    contexts.push(ctx)
    return ctx as unknown as OfflineAudioContext
  }
  return { factory, contexts }
}

const live = { sampleRate: 48_000 } as BaseAudioContext

describe('renderSound', () => {
  for (const id of SOUND_IDS) {
    describe(id, () => {
      const pattern = SOUND_PATTERNS[id]

      it('renders one mono period at the live context sample rate', async () => {
        const { factory, contexts } = recorder()
        await renderSound(live, id, factory)
        expect(contexts).toHaveLength(1)
        expect(contexts[0]?.channels).toBe(1)
        expect(contexts[0]?.sampleRate).toBe(48_000)
        expect(contexts[0]?.length).toBe(patternLength(pattern, 48_000))
      })

      it('plays one oscillator per voice with its waveform and frequency, inside the period', async () => {
        const { factory, contexts } = recorder()
        await renderSound(live, id, factory)
        const ctx = contexts[0]
        expect(ctx?.oscillators).toHaveLength(pattern.voices.length)
        pattern.voices.forEach((voice, i) => {
          const osc = ctx?.oscillators[i]
          expect(osc?.type).toBe(voice.waveform)
          expect(osc?.frequency.value).toBe(voice.frequency)
          expect(osc?.startedAt).toBe(voice.start)
          expect(osc?.stoppedAt).toBe(voiceEnd(voice))
          expect(osc?.stoppedAt ?? Infinity).toBeLessThanOrEqual(pattern.duration)
        })
      })

      it('routes each oscillator through its own enveloped gain into the destination', async () => {
        const { factory, contexts } = recorder()
        await renderSound(live, id, factory)
        const ctx = contexts[0]
        expect(ctx?.gains).toHaveLength(pattern.voices.length)
        pattern.voices.forEach((voice, i) => {
          const gain = ctx?.gains[i]
          expect(ctx?.oscillators[i]?.connections).toEqual([gain])
          expect(gain?.connections).toEqual([ctx?.destination])
          // Silent until the envelope starts, then exactly the envelope's events.
          expect(gain?.gain.value).toBe(0)
          expect(gain?.gain.calls).toEqual(
            envelopeEvents(voice).map((e) => ({ method: e.kind, value: e.value, time: e.time })),
          )
          for (const call of gain?.gain.calls ?? []) {
            expect(Number.isFinite(call.value) && Number.isFinite(call.time)).toBe(true)
          }
        })
      })

      it('normalizes the rendered samples to the pattern level', async () => {
        const { factory } = recorder()
        const buffer = await renderSound(live, id, factory)
        const samples = buffer.getChannelData(0)
        const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 0)
        expect(peak).toBeCloseTo(pattern.level, 6)
      })
    })
  }

  it('rejects when rendering fails', async () => {
    const failing: OfflineContextFactory = (channels, length, sampleRate) => {
      const ctx = new FakeOfflineContext(channels, length, sampleRate)
      ctx.startRendering = () => Promise.reject(new Error('render failed'))
      return ctx as unknown as OfflineAudioContext
    }
    await expect(renderSound(live, 'chime', failing)).rejects.toThrow('render failed')
  })

  it('rejects when no offline context can be created', async () => {
    const missing: OfflineContextFactory = () => {
      throw new Error('OfflineAudioContext is not defined')
    }
    await expect(renderSound(live, 'bell', missing)).rejects.toThrow('not defined')
  })
})

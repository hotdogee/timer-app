import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  BELL_PARTIALS,
  CHIME_PARTIALS,
  SILENCE,
  SOUND_IDS,
  SOUND_PATTERNS,
  envelopeAt,
  envelopeEvents,
  normalizePeak,
  patternLength,
  voiceEnd,
  type Voice,
} from './sound-patterns'

/** Sample times across a pattern, 1 ms apart, including both ends. */
function sampleTimes(duration: number): number[] {
  const steps = Math.round(duration * 1000)
  return Array.from({ length: steps + 1 }, (_, i) => (i * duration) / steps)
}

const voice: Voice = {
  waveform: 'sine',
  frequency: 440,
  start: 0.5,
  attack: 0.01,
  hold: 0.2,
  decay: 1,
  peak: 0.4,
}

describe('built-in sound patterns', () => {
  it('has a pattern for every sound id, keyed by its own id', () => {
    expect(SOUND_IDS).toEqual(['chime', 'bell', 'beep'])
    for (const id of SOUND_IDS) expect(SOUND_PATTERNS[id].id).toBe(id)
  })

  it('loops with the designed periods: chime 1.6 s, bell 2.4 s, beep 1.2 s', () => {
    expect(SOUND_PATTERNS.chime.duration).toBe(1.6)
    expect(SOUND_PATTERNS.bell.duration).toBe(2.4)
    expect(SOUND_PATTERNS.beep.duration).toBe(1.2)
  })

  it('builds the chime from two notes with every chime partial', () => {
    const { voices } = SOUND_PATTERNS.chime
    expect(voices).toHaveLength(2 * CHIME_PARTIALS.length)
    expect(new Set(voices.map((v) => v.start))).toEqual(new Set([0, 0.4]))
    expect(voices.every((v) => v.waveform === 'sine')).toBe(true)
  })

  it('builds the bell from one strike with all eleven inharmonic partials', () => {
    const { voices } = SOUND_PATTERNS.bell
    expect(BELL_PARTIALS).toHaveLength(11)
    expect(voices).toHaveLength(BELL_PARTIALS.length)
    expect(voices.every((v) => v.start === 0 && v.waveform === 'sine')).toBe(true)
    // Inharmonic: some partial ratios are not whole multiples of the lowest one.
    const lowest = Math.min(...BELL_PARTIALS.map((p) => p.ratio))
    expect(BELL_PARTIALS.some((p) => !Number.isInteger(p.ratio / lowest))).toBe(true)
    // The detuned pairs beat: two partials share a ratio but differ in frequency.
    const hum = voices.filter((v, i) => BELL_PARTIALS[i]?.ratio === 0.56)
    expect(hum).toHaveLength(2)
    expect(hum[0]?.frequency).not.toBe(hum[1]?.frequency)
  })

  it('makes the beep three short 880 Hz square beeps', () => {
    const { voices } = SOUND_PATTERNS.beep
    expect(voices).toHaveLength(3)
    for (const v of voices) {
      expect(v.waveform).toBe('square')
      expect(v.frequency).toBe(880)
      expect(voiceEnd(v) - v.start).toBeLessThan(0.2)
    }
  })

  for (const id of SOUND_IDS) {
    describe(id, () => {
      const pattern = SOUND_PATTERNS[id]

      it('has only finite, positive voice parameters', () => {
        expect(pattern.voices.length).toBeGreaterThan(0)
        for (const v of pattern.voices) {
          for (const value of [v.frequency, v.attack, v.decay, v.peak]) {
            expect(Number.isFinite(value) && value > 0).toBe(true)
          }
          expect(v.start).toBeGreaterThanOrEqual(0)
          expect(v.hold).toBeGreaterThanOrEqual(0)
        }
      })

      it('keeps every frequency audible and far below the Nyquist limit of 22.05 kHz audio', () => {
        for (const v of pattern.voices) {
          expect(v.frequency).toBeGreaterThan(100)
          expect(v.frequency).toBeLessThan(8000)
        }
      })

      it('ends every voice within the loop period', () => {
        for (const v of pattern.voices) expect(voiceEnd(v)).toBeLessThanOrEqual(pattern.duration)
      })

      it('is silent at both ends of the period, so the loop does not click', () => {
        for (const v of pattern.voices) {
          expect(envelopeAt(v, 0)).toBe(0)
          expect(envelopeAt(v, pattern.duration)).toBe(0)
        }
      })

      it('never sums above full scale and has a finite envelope everywhere', () => {
        let loudest = 0
        for (const t of sampleTimes(pattern.duration)) {
          const sum = pattern.voices.reduce((total, v) => total + envelopeAt(v, t), 0)
          expect(Number.isFinite(sum)).toBe(true)
          loudest = Math.max(loudest, sum)
        }
        expect(loudest).toBeGreaterThan(0)
        expect(loudest).toBeLessThanOrEqual(1 + 1e-9)
      })

      it('has a normalization level between 0 and 1', () => {
        expect(pattern.level).toBeGreaterThan(0)
        expect(pattern.level).toBeLessThanOrEqual(1)
      })
    })
  }
})

describe('envelopeAt', () => {
  it('is silent before the start, ramps linearly, holds, decays to SILENCE and is silent after', () => {
    expect(envelopeAt(voice, 0)).toBe(0)
    expect(envelopeAt(voice, 0.5)).toBe(0)
    expect(envelopeAt(voice, 0.505)).toBeCloseTo(0.2, 10)
    expect(envelopeAt(voice, 0.51)).toBe(0.4)
    expect(envelopeAt(voice, 0.6)).toBe(0.4)
    // Halfway through the decay the exponential curve is at sqrt(SILENCE).
    expect(envelopeAt(voice, 0.71 + 0.5)).toBeCloseTo(0.4 * Math.sqrt(SILENCE), 10)
    expect(envelopeAt(voice, voiceEnd(voice) - 1e-9)).toBeCloseTo(0.4 * SILENCE, 6)
    expect(envelopeAt(voice, voiceEnd(voice))).toBe(0)
    expect(envelopeAt(voice, 100)).toBe(0)
  })

  it('reads 0 for NaN and stays finite and within [0, peak] for any time', () => {
    expect(envelopeAt(voice, Number.NaN)).toBe(0)
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (t) => {
        const value = envelopeAt(voice, t)
        return Number.isFinite(value) && value >= 0 && value <= voice.peak
      }),
    )
  })

  it('never increases after the attack', () => {
    let previous = Infinity
    for (let t = 0.51; t <= 2; t += 0.001) {
      const value = envelopeAt(voice, t)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })
})

describe('envelopeEvents', () => {
  it('lists set, linear attack, hold, exponential decay and the final cut, in time order', () => {
    expect(envelopeEvents(voice)).toEqual([
      { kind: 'set', time: 0.5, value: 0 },
      { kind: 'linear', time: 0.51, value: 0.4 },
      { kind: 'set', time: 0.71, value: 0.4 },
      { kind: 'exponential', time: 1.71, value: 0.4 * SILENCE },
      { kind: 'set', time: 1.71, value: 0 },
    ])
  })

  it('omits the hold step for a voice without hold', () => {
    const kinds = envelopeEvents({ ...voice, hold: 0 }).map((e) => e.kind)
    expect(kinds).toEqual(['set', 'linear', 'exponential', 'set'])
  })

  it('gives every built-in voice finite, ordered events with a positive exponential target', () => {
    for (const id of SOUND_IDS) {
      for (const v of SOUND_PATTERNS[id].voices) {
        const events = envelopeEvents(v)
        for (const [i, event] of events.entries()) {
          expect(Number.isFinite(event.time) && Number.isFinite(event.value)).toBe(true)
          if (i > 0) expect(event.time).toBeGreaterThanOrEqual(events[i - 1]?.time ?? 0)
          // exponentialRampToValueAtTime throws for a target of 0.
          if (event.kind === 'exponential') expect(event.value).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('patternLength', () => {
  it('is the period in frames at the sample rate', () => {
    expect(patternLength(SOUND_PATTERNS.chime, 48_000)).toBe(76_800)
    expect(patternLength(SOUND_PATTERNS.bell, 44_100)).toBe(105_840)
    expect(patternLength(SOUND_PATTERNS.beep, 22_050)).toBe(26_460)
  })

  it('is at least one frame', () => {
    expect(patternLength(SOUND_PATTERNS.beep, 0)).toBe(1)
  })
})

describe('normalizePeak', () => {
  it('scales the largest absolute sample to the level, keeping signs and ratios', () => {
    const samples = new Float32Array([0.1, -0.5, 0.25, 0])
    normalizePeak(samples, 0.9)
    expect(Array.from(samples)).toEqual([
      Math.fround(0.18),
      Math.fround(-0.9),
      Math.fround(0.45),
      0,
    ])
  })

  it('leaves a silent buffer silent', () => {
    const samples = new Float32Array(4)
    normalizePeak(samples, 0.9)
    expect(Array.from(samples)).toEqual([0, 0, 0, 0])
  })

  it('zeroes non-finite samples instead of spreading them', () => {
    const samples = new Float32Array([Number.NaN, 0.5, Infinity, -Infinity])
    normalizePeak(samples, 1)
    expect(Array.from(samples)).toEqual([0, 1, 0, 0])
  })

  it('handles an empty buffer', () => {
    const samples = new Float32Array(0)
    normalizePeak(samples, 1)
    expect(samples).toHaveLength(0)
  })
})

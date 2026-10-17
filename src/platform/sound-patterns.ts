/**
 * The built-in alarm sounds (spec Q21) as plain data: which oscillators play, when, at what pitch,
 * and with what gain envelope. `sounds.ts` renders a pattern into an `AudioBuffer` with Web Audio;
 * everything here is pure math, so it is unit-tested without an audio stack.
 *
 * Every pattern is silent at its first and last instant, so the rendered buffer loops without a
 * click: the alarm repeats the pattern every `duration` seconds.
 */

/** A built-in alarm sound. */
export type SoundId = 'chime' | 'bell' | 'beep'

/** Every built-in sound, in the order a settings list shows them. */
export const SOUND_IDS: readonly SoundId[] = ['chime', 'bell', 'beep']

/** Oscillator waveform. Web Audio band-limits `square`, so it does not alias. */
export type Waveform = 'sine' | 'square'

/**
 * One oscillator with its own gain envelope. Silent before `start`; a linear attack from 0 to
 * `peak`; a hold at `peak`; an exponential decay to `peak × SILENCE` at the voice's end; silent
 * after. Times are in seconds from the start of the pattern.
 */
export interface Voice {
  readonly waveform: Waveform
  /** Hz. */
  readonly frequency: number
  readonly start: number
  readonly attack: number
  readonly hold: number
  readonly decay: number
  /** Linear gain at the top of the envelope, greater than 0. */
  readonly peak: number
}

/** A sound: voices laid out over one loop period. */
export interface SoundPattern {
  readonly id: SoundId
  /** Loop period in seconds. Every voice ends by then. */
  readonly duration: number
  readonly voices: readonly Voice[]
  /**
   * Peak sample amplitude of the rendered buffer after {@link normalizePeak}, 0 to 1. Square waves
   * carry more energy than sines at the same peak, so `beep` sits lower to sound about as loud.
   */
  readonly level: number
}

/** Relative gain where a decay ends: -60 dB, inaudible under the alarm's other voices. */
export const SILENCE = 0.001

/**
 * A partial of a struck note: frequency `ratio` to the note, `detune` in Hz added on top (a pair of
 * slightly detuned partials beats, which makes a bell shimmer), relative `gain`, and decay time
 * relative to the note's.
 */
export interface Partial {
  readonly ratio: number
  readonly detune: number
  readonly gain: number
  readonly decay: number
}

/** A struck note before it is expanded into one voice per partial. */
interface Note {
  readonly frequency: number
  readonly start: number
  /** Decay time of the strongest partial, in seconds. */
  readonly decay: number
}

/** Fundamental plus two quiet harmonics that fade faster: a soft electronic chime. */
export const CHIME_PARTIALS: readonly Partial[] = [
  { ratio: 1, detune: 0, gain: 1, decay: 1 },
  { ratio: 2, detune: 0, gain: 0.22, decay: 0.45 },
  { ratio: 3, detune: 0, gain: 0.06, decay: 0.25 },
]

/**
 * Inharmonic bell partials after Jean-Claude Risset's classic synthesized bell (his ratios,
 * amplitudes and relative decays), including the two beating pairs that make it shimmer.
 */
export const BELL_PARTIALS: readonly Partial[] = [
  { ratio: 0.56, detune: 0, gain: 1, decay: 1 },
  { ratio: 0.56, detune: 1, gain: 0.67, decay: 0.9 },
  { ratio: 0.92, detune: 0, gain: 1, decay: 0.65 },
  { ratio: 0.92, detune: 1.7, gain: 1.8, decay: 0.55 },
  { ratio: 1.19, detune: 0, gain: 2.67, decay: 0.325 },
  { ratio: 1.7, detune: 0, gain: 1.67, decay: 0.35 },
  { ratio: 2, detune: 0, gain: 1.46, decay: 0.25 },
  { ratio: 2.74, detune: 0, gain: 1.33, decay: 0.2 },
  { ratio: 3, detune: 0, gain: 1.33, decay: 0.15 },
  { ratio: 3.76, detune: 0, gain: 1, decay: 0.1 },
  { ratio: 4.07, detune: 0, gain: 1.33, decay: 0.075 },
]

/** Attack of a struck note, in seconds: fast, but long enough not to click. */
const STRIKE_ATTACK = 0.004

/** Expands struck notes into one sine voice per partial. */
function strike(notes: readonly Note[], partials: readonly Partial[]): Voice[] {
  return notes.flatMap((note) =>
    partials.map((partial): Voice => ({
      waveform: 'sine',
      frequency: note.frequency * partial.ratio + partial.detune,
      start: note.start,
      attack: STRIKE_ATTACK,
      hold: 0,
      decay: note.decay * partial.decay,
      peak: partial.gain,
    })),
  )
}

/**
 * Scales every peak so the peaks sum to 1. The sum bounds the summed signal at every instant, so
 * the render never exceeds full scale whatever the phases; {@link normalizePeak} sets the final
 * loudness afterwards.
 */
function fitPeaks(voices: readonly Voice[]): Voice[] {
  const total = voices.reduce((sum, voice) => sum + voice.peak, 0)
  return voices.map((voice) => ({ ...voice, peak: voice.peak / total }))
}

/** Two falling notes (E6, then C6), 1.6 s period. */
const chime: SoundPattern = {
  id: 'chime',
  duration: 1.6,
  level: 0.9,
  voices: fitPeaks(
    strike(
      [
        { frequency: 1318.51, start: 0, decay: 1.1 },
        { frequency: 1046.5, start: 0.4, decay: 1.15 },
      ],
      CHIME_PARTIALS,
    ),
  ),
}

/** One strike on D5 with long inharmonic decays, 2.4 s period. */
const bell: SoundPattern = {
  id: 'bell',
  duration: 2.4,
  level: 0.9,
  voices: fitPeaks(strike([{ frequency: 587.33, start: 0, decay: 2.35 }], BELL_PARTIALS)),
}

/** Three short 880 Hz square beeps, then a pause, 1.2 s period. */
const beep: SoundPattern = {
  id: 'beep',
  duration: 1.2,
  level: 0.5,
  voices: fitPeaks(
    [0, 0.2, 0.4].map((start): Voice => ({
      waveform: 'square',
      frequency: 880,
      start,
      attack: STRIKE_ATTACK,
      hold: 0.1,
      decay: 0.02,
      peak: 1,
    })),
  ),
}

/** The built-in sounds by id. */
export const SOUND_PATTERNS: Readonly<Record<SoundId, SoundPattern>> = { chime, bell, beep }

/** When the voice falls silent, in seconds from the start of the pattern. */
export function voiceEnd(voice: Voice): number {
  return voice.start + voice.attack + voice.hold + voice.decay
}

/** One automation step for a gain `AudioParam`, in seconds from the start of the pattern. */
export interface EnvelopeEvent {
  /** `setValueAtTime`, `linearRampToValueAtTime` or `exponentialRampToValueAtTime`. */
  readonly kind: 'set' | 'linear' | 'exponential'
  readonly time: number
  readonly value: number
}

/** The automation events that give a gain param the voice's envelope (see {@link Voice}). */
export function envelopeEvents(voice: Voice): readonly EnvelopeEvent[] {
  const attackEnd = voice.start + voice.attack
  const decayStart = attackEnd + voice.hold
  const end = decayStart + voice.decay
  const events: EnvelopeEvent[] = [
    { kind: 'set', time: voice.start, value: 0 },
    { kind: 'linear', time: attackEnd, value: voice.peak },
  ]
  if (voice.hold > 0) events.push({ kind: 'set', time: decayStart, value: voice.peak })
  events.push(
    { kind: 'exponential', time: end, value: voice.peak * SILENCE },
    { kind: 'set', time: end, value: 0 },
  )
  return events
}

/**
 * The voice's gain at time `t` (seconds from the start of the pattern), exactly as Web Audio
 * evaluates {@link envelopeEvents}. 0 for a `t` outside the voice, and for NaN.
 */
export function envelopeAt(voice: Voice, t: number): number {
  if (!(t >= voice.start)) return 0
  const attackEnd = voice.start + voice.attack
  if (t < attackEnd) return (voice.peak * (t - voice.start)) / voice.attack
  const decayStart = attackEnd + voice.hold
  if (t < decayStart) return voice.peak
  const end = decayStart + voice.decay
  if (t < end) return voice.peak * SILENCE ** ((t - decayStart) / voice.decay)
  return 0
}

/** Number of sample frames in one period of the pattern at `sampleRate` (at least 1). */
export function patternLength(pattern: SoundPattern, sampleRate: number): number {
  return Math.max(1, Math.round(pattern.duration * sampleRate))
}

/**
 * Scales `samples` in place so the largest absolute sample equals `level`. Non-finite samples
 * become 0. An all-silent buffer stays silent.
 */
export function normalizePeak(samples: Float32Array, level: number): void {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] ?? 0
    if (!Number.isFinite(sample)) samples[i] = 0
    else if (Math.abs(sample) > peak) peak = Math.abs(sample)
  }
  if (peak === 0) return
  const scale = level / peak
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i] ?? 0) * scale
}

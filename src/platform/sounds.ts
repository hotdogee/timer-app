/**
 * Renders the built-in alarm sounds (see `sound-patterns.ts`) into `AudioBuffer`s. Each sound is
 * played once through an `OfflineAudioContext` at the live context's sample rate, so the live
 * context only loops a finished buffer and never runs oscillators while an alarm rings.
 */
import {
  normalizePeak,
  patternLength,
  SOUND_PATTERNS,
  envelopeEvents,
  voiceEnd,
  type SoundId,
  type Voice,
} from './sound-patterns'

/** Creates the offline context a sound is rendered in; replaced in tests. */
export type OfflineContextFactory = (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext

const createOfflineContext: OfflineContextFactory = (channels, length, sampleRate) =>
  new OfflineAudioContext(channels, length, sampleRate)

/**
 * Renders one period of the sound `id` as a mono buffer at `ctx.sampleRate`, peak-normalized to
 * the pattern's level. Rejects if the browser cannot create or run an offline context.
 */
export async function renderSound(
  ctx: BaseAudioContext,
  id: SoundId,
  createOffline: OfflineContextFactory = createOfflineContext,
): Promise<AudioBuffer> {
  const pattern = SOUND_PATTERNS[id]
  const offline = createOffline(1, patternLength(pattern, ctx.sampleRate), ctx.sampleRate)
  for (const voice of pattern.voices) addVoice(offline, voice)
  const buffer = await offline.startRendering()
  normalizePeak(buffer.getChannelData(0), pattern.level)
  return buffer
}

/** Wires an oscillator through a gain envelope into the destination and schedules it. */
function addVoice(ctx: BaseAudioContext, voice: Voice): void {
  const oscillator = ctx.createOscillator()
  oscillator.type = voice.waveform
  oscillator.frequency.value = voice.frequency
  const gain = ctx.createGain()
  gain.gain.value = 0
  scheduleEnvelope(gain.gain, voice)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(voice.start)
  oscillator.stop(voiceEnd(voice))
}

/** Applies the voice's envelope (see `envelopeEvents`) to a gain param. */
function scheduleEnvelope(param: AudioParam, voice: Voice): void {
  for (const event of envelopeEvents(voice)) {
    switch (event.kind) {
      case 'set':
        param.setValueAtTime(event.value, event.time)
        break
      case 'linear':
        param.linearRampToValueAtTime(event.value, event.time)
        break
      case 'exponential':
        param.exponentialRampToValueAtTime(event.value, event.time)
        break
    }
  }
}

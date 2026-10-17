/**
 * Alarm sound playback (spec › Time's up, Q21). The web implementation renders each built-in sound
 * once (see `sounds.ts`), caches the buffer, and loops it with an `AudioBufferSourceNode` until
 * stopped. Browsers keep audio muted until a user gesture, so the app calls {@link AlarmPlayer.unlock}
 * from gestures (see {@link unlockAudioOnGestures}) and on every Start. Between sounds the audio
 * context is suspended, so an app left open all day does not keep the audio thread (and on some
 * systems the output device) awake; playing resumes it.
 */
import { SOUND_IDS, type SoundId } from './sound-patterns'
import { renderSound } from './sounds'

export { SOUND_IDS, type SoundId }

/** The sound an alarm plays unless settings say otherwise. */
export const DEFAULT_SOUND: SoundId = 'chime'

/** Alarm volume unless settings say otherwise, 0 to 1. */
export const DEFAULT_VOLUME = 0.8

/** How an alarm sound plays. */
export interface PlayOptions {
  /** Repeat the sound until {@link AlarmPlayer.stop}; otherwise play it once. */
  readonly loop: boolean
  /** 0 to 1; out-of-range values are clamped and a non-finite one means {@link DEFAULT_VOLUME}. */
  readonly volume: number
}

/** Plays at most one alarm sound at a time, plus a separate one-shot preview. */
export interface AlarmPlayer {
  /**
   * Creates and starts the audio output. Call it synchronously inside a user gesture (a key press
   * or pointer event): browsers refuse to start audio otherwise. Once audio has started it only
   * wakes the output for a sound that is waiting, so calling it on every gesture is cheap. A sound
   * requested before the first unlock starts now.
   */
  unlock(): void
  /**
   * Plays `sound`, replacing any other alarm sound. Requesting the looping sound that is already
   * playing only updates its volume, so callers can re-assert the alarm on every change. Before
   * {@link unlock} the request waits and starts once audio is unlocked.
   */
  play(sound: SoundId, options: PlayOptions): void
  /** Stops the alarm sound (with a short fade, so it does not click). Idempotent. */
  stop(): void
  /**
   * Whether an alarm sound is requested: true from {@link play} until {@link stop}, or until a
   * one-shot sound finishes. Also true while the request waits for {@link unlock}.
   */
  readonly playing: boolean
  /**
   * Plays `sound` once at `volume` for a settings preview, independent of the alarm sound and of
   * {@link playing}. Call it from a user gesture; it unlocks audio itself.
   */
  preview(sound: SoundId, volume: number): void
}

/** Dependencies of {@link createWebAlarmPlayer}; every field has a browser default. */
export interface WebAlarmPlayerOptions {
  /** Creates the live audio context, or null when Web Audio is unavailable (then nothing sounds). */
  readonly createContext?: (() => AudioContext) | null
  /** Renders a sound for a context. Defaults to `renderSound`. */
  readonly render?: (ctx: BaseAudioContext, sound: SoundId) => Promise<AudioBuffer>
  /**
   * Whether the page has had a user gesture already (`navigator.userActivation.hasBeenActive`).
   * Then {@link AlarmPlayer.play} may create the audio context itself before any `unlock`.
   */
  readonly hasUserActivation?: () => boolean
  /** Reports a failure that leaves the alarm silent. Defaults to `console.warn`. */
  readonly warn?: (message: string, error: unknown) => void
  /** How long the audio context stays awake after the last sound ends. Defaults to 2 seconds. */
  readonly idleSuspendMs?: number
}

/** Length of the fade-out when a sound stops, in seconds. */
const FADE_SECONDS = 0.04

/** How long the context stays awake after the last sound, so a quick next sound starts at once. */
const IDLE_SUSPEND_MS = 2000

/** A sound that has been asked for. `started` once its buffer was requested for the context. */
interface Request {
  readonly sound: SoundId
  readonly loop: boolean
  volume: number
  started: boolean
}

/** The nodes of one sound playing in the live context. */
interface Playback {
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
}

/** Clamps a volume to 0..1; a non-finite one becomes {@link DEFAULT_VOLUME}. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_VOLUME
  return Math.min(1, Math.max(0, volume))
}

/** Web Audio's constructors as browsers may expose them, prefixed in Safari before 14.1. */
interface AudioGlobals {
  readonly AudioContext?: typeof AudioContext
  readonly webkitAudioContext?: typeof AudioContext
}

function defaultContextFactory(): (() => AudioContext) | null {
  const scope = globalThis as AudioGlobals
  const Context = scope.AudioContext ?? scope.webkitAudioContext
  if (!Context) return null
  return () => {
    try {
      // A long buffer suits a looping alarm and saves power; latency does not matter here.
      return new Context({ latencyHint: 'playback' })
    } catch {
      // Old engines reject the options bag.
      return new Context()
    }
  }
}

function defaultHasUserActivation(): boolean {
  const nav = (globalThis as { navigator?: { userActivation?: { hasBeenActive?: boolean } } })
    .navigator
  return nav?.userActivation?.hasBeenActive === true
}

function defaultWarn(message: string, error: unknown): void {
  console.warn(message, error)
}

/** Creates the Web Audio alarm player. It creates no audio context until it needs one. */
export function createWebAlarmPlayer(options: WebAlarmPlayerOptions = {}): AlarmPlayer {
  const createContext =
    options.createContext === undefined ? defaultContextFactory() : options.createContext
  const render = options.render ?? renderSound
  const hasUserActivation = options.hasUserActivation ?? defaultHasUserActivation
  const warn = options.warn ?? defaultWarn
  const idleSuspendMs = options.idleSuspendMs ?? IDLE_SUSPEND_MS

  let ctx: AudioContext | null = null
  let contextFailed = false
  /** Whether the context has run once: unlocked by a gesture, so later resumes need none. */
  let started = false
  /** Whether the context is suspended because nothing played (not by the browser or the OS). */
  let idle = false
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const buffers = new Map<SoundId, Promise<AudioBuffer>>()
  let alarm: Request | null = null
  let alarmPlayback: Playback | null = null
  let preview: Playback | null = null
  let previewToken: object | null = null

  /** The live context, created on first need. Outside a gesture only after one has happened. */
  function context(fromGesture: boolean): AudioContext | null {
    if (ctx || contextFailed || !createContext) return ctx
    if (!fromGesture && !hasUserActivation()) return null
    try {
      ctx = createContext()
    } catch (error) {
      contextFailed = true
      warn('Timer App: could not create an audio context; alarms will be silent', error)
      return null
    }
    // Render the default sound now, so the first alarm starts without waiting for it.
    void buffer(ctx, DEFAULT_SOUND).catch(() => {
      // Reported when the alarm actually needs it.
    })
    return ctx
  }

  /** The rendered buffer for `sound`, cached; a failed render is dropped so the next try retries. */
  function buffer(live: AudioContext, sound: SoundId): Promise<AudioBuffer> {
    let pending = buffers.get(sound)
    if (!pending) {
      const rendering = render(live, sound)
      pending = rendering
      buffers.set(sound, rendering)
      rendering.catch(() => {
        if (buffers.get(sound) === rendering) buffers.delete(sound)
      })
    }
    return pending
  }

  function resume(live: AudioContext): void {
    cancelSuspend()
    idle = false
    if (live.state === 'running') {
      started = true
      return
    }
    live.resume().then(
      () => {
        started = true
      },
      () => {
        // Still not allowed; the next gesture's unlock() tries again.
      },
    )
  }

  function cancelSuspend(): void {
    clearTimeout(idleTimer)
    idleTimer = undefined
  }

  /** Suspends the context a moment after the last sound ends, unless another one starts first. */
  function suspendWhenIdle(): void {
    cancelSuspend()
    const live = ctx
    if (!live || alarm !== null || preview !== null) return
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      if (alarm !== null || preview !== null || live.state !== 'running') return
      idle = true
      live.suspend().catch(() => {
        // Closed or already suspending: nothing to do.
      })
    }, idleSuspendMs)
  }

  /** iOS Safari unlocks output only once a source has started inside a gesture. */
  function startSilentTick(live: AudioContext): void {
    try {
      const source = live.createBufferSource()
      source.buffer = live.createBuffer(1, 1, live.sampleRate)
      source.connect(live.destination)
      source.onended = () => {
        source.disconnect()
      }
      source.start()
    } catch {
      // Not needed by engines that unlock on resume().
    }
  }

  function startPlayback(
    live: AudioContext,
    audio: AudioBuffer,
    loop: boolean,
    volume: number,
    onEnded: (playback: Playback) => void,
  ): Playback {
    const source = live.createBufferSource()
    source.buffer = audio
    source.loop = loop
    const gain = live.createGain()
    gain.gain.value = volume
    source.connect(gain)
    gain.connect(live.destination)
    const playback: Playback = { source, gain }
    source.onended = () => {
      source.disconnect()
      gain.disconnect()
      onEnded(playback)
    }
    source.start()
    return playback
  }

  function stopPlayback(live: AudioContext, playback: Playback): void {
    const now = live.currentTime
    try {
      playback.gain.gain.cancelScheduledValues(now)
      playback.gain.gain.setTargetAtTime(0, now, FADE_SECONDS / 4)
      playback.source.stop(now + FADE_SECONDS)
    } catch {
      // Already stopped: just detach it.
      playback.source.onended = null
      playback.source.disconnect()
      playback.gain.disconnect()
    }
  }

  function startAlarm(live: AudioContext, request: Request): void {
    if (request.started) return
    request.started = true
    buffer(live, request.sound)
      .then((audio) => {
        if (alarm !== request) return
        alarmPlayback = startPlayback(live, audio, request.loop, request.volume, (ended) => {
          if (alarmPlayback !== ended) return
          alarmPlayback = null
          if (alarm === request && !request.loop) alarm = null
          suspendWhenIdle()
        })
      })
      .catch((error: unknown) => {
        warn(`Timer App: could not play the "${request.sound}" alarm sound`, error)
        // Let the next unlock() or play() try again.
        if (alarm === request) request.started = false
      })
  }

  function stopAlarm(): void {
    alarm = null
    if (alarmPlayback && ctx) stopPlayback(ctx, alarmPlayback)
    alarmPlayback = null
  }

  function unlock(): void {
    const live = context(true)
    if (!live) return
    // Wake the output only while it has a job: the first unlock, a sound that is waiting, or
    // recovering from the browser or the OS stopping it (an iOS interruption), not from idling.
    if (started && !alarm && (live.state === 'running' || idle)) return
    if (live.state !== 'running') {
      resume(live)
      startSilentTick(live)
    } else {
      started = true
    }
    if (alarm) startAlarm(live, alarm)
    else suspendWhenIdle()
  }

  return {
    unlock,

    play(sound, { loop, volume }) {
      const level = clampVolume(volume)
      if (alarm?.loop && loop && alarm.sound === sound) {
        alarm.volume = level
        if (alarmPlayback && ctx) {
          alarmPlayback.gain.gain.setTargetAtTime(level, ctx.currentTime, FADE_SECONDS / 4)
        }
        return
      }
      stopAlarm()
      const request: Request = { sound, loop, volume: level, started: false }
      alarm = request
      const live = context(false)
      if (!live) return
      resume(live)
      startAlarm(live, request)
    },

    stop() {
      stopAlarm()
      suspendWhenIdle()
    },

    get playing() {
      return alarm !== null
    },

    preview(sound, volume) {
      unlock()
      const live = ctx
      if (!live) return
      resume(live)
      if (preview) stopPlayback(live, preview)
      preview = null
      const token = {}
      previewToken = token
      buffer(live, sound)
        .then((audio) => {
          if (previewToken !== token) return
          preview = startPlayback(live, audio, false, clampVolume(volume), (ended) => {
            if (preview !== ended) return
            preview = null
            suspendWhenIdle()
          })
        })
        .catch((error: unknown) => {
          warn(`Timer App: could not play the "${sound}" sound`, error)
        })
    },
  }
}

/** Events that count as a user gesture for audio (pointerdown for a mouse, pointerup for touch). */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'keydown'] as const

/**
 * Calls `player.unlock()` on every pointer or key gesture on `target` (the window by default), in
 * the capture phase so no handler can stop it. Unlock is a no-op once audio runs, so this costs
 * nothing later and also recovers audio that the OS interrupted. Returns a function that removes
 * the listeners.
 */
export function unlockAudioOnGestures(
  player: AlarmPlayer,
  target: EventTarget | null = (globalThis as { window?: EventTarget }).window ?? null,
): () => void {
  if (!target) return () => undefined
  const listener = (): void => {
    player.unlock()
  }
  for (const type of GESTURE_EVENTS) {
    target.addEventListener(type, listener, { capture: true, passive: true })
  }
  return () => {
    for (const type of GESTURE_EVENTS) target.removeEventListener(type, listener, { capture: true })
  }
}

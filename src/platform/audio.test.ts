import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  DEFAULT_VOLUME,
  clampVolume,
  createWebAlarmPlayer,
  unlockAudioOnGestures,
  type AlarmPlayer,
  type SoundId,
  type WebAlarmPlayerOptions,
} from './audio'

class FakeParam {
  value = 1
  readonly targets: { value: number; time: number }[] = []
  cancelScheduledValues(): void {
    // Nothing scheduled in the fake.
  }
  setTargetAtTime(value: number, time: number): void {
    this.targets.push({ value, time })
  }
}

class FakeNode {
  connectedTo: unknown = null
  disconnected = false
  connect(target: unknown): unknown {
    this.connectedTo = target
    return target
  }
  disconnect(): void {
    this.disconnected = true
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam()
}

class FakeSource extends FakeNode {
  buffer: unknown = null
  loop = false
  onended: (() => void) | null = null
  started = false
  stoppedAt: number | null = null
  start(): void {
    this.started = true
  }
  stop(when = 0): void {
    this.stoppedAt = when
  }
  /** What the engine does when the source finishes or reaches its stop time. */
  end(): void {
    this.onended?.()
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 10
  readonly sampleRate = 48_000
  readonly destination = new FakeNode()
  readonly sources: FakeSource[] = []
  readonly gains: FakeGain[] = []
  resumes = 0
  suspends = 0
  resumeResult: Promise<void> = Promise.resolve()
  resume(): Promise<void> {
    this.resumes += 1
    this.state = 'running'
    return this.resumeResult
  }
  suspend(): Promise<void> {
    this.suspends += 1
    this.state = 'suspended'
    return Promise.resolve()
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  createGain(): FakeGain {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createBuffer(channels: number, length: number): unknown {
    return { silent: true, channels, length }
  }
  /** Sources that play a rendered sound (not the one-frame unlock tick). */
  get sounds(): FakeSource[] {
    return this.sources.filter((s) => !(s.buffer as { silent?: boolean } | null)?.silent)
  }
}

/** Lets pending promise callbacks run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface Harness {
  readonly player: AlarmPlayer
  readonly contexts: FakeContext[]
  readonly render: Mock<(ctx: BaseAudioContext, sound: SoundId) => Promise<AudioBuffer>>
  readonly warn: Mock<(message: string, error: unknown) => void>
  /** The one context, or a failure. */
  readonly ctx: () => FakeContext
}

function harness(options: Partial<WebAlarmPlayerOptions> = {}): Harness {
  const contexts: FakeContext[] = []
  const render = vi.fn((_ctx: BaseAudioContext, sound: SoundId) =>
    Promise.resolve({ sound } as unknown as AudioBuffer),
  )
  const warn = vi.fn<(message: string, error: unknown) => void>()
  const player = createWebAlarmPlayer({
    createContext: () => {
      const ctx = new FakeContext()
      contexts.push(ctx)
      return ctx as unknown as AudioContext
    },
    render,
    hasUserActivation: () => false,
    warn,
    ...options,
  })
  return {
    player,
    contexts,
    render,
    warn,
    ctx: () => {
      expect(contexts).toHaveLength(1)
      const [ctx] = contexts
      if (!ctx) throw new Error('no context')
      return ctx
    },
  }
}

function soundOf(source: FakeSource | undefined): unknown {
  return (source?.buffer as { sound?: SoundId } | null)?.sound
}

describe('clampVolume', () => {
  it('keeps 0..1, clamps outside it, and maps non-finite volumes to the default', () => {
    expect(clampVolume(0.3)).toBe(0.3)
    expect(clampVolume(0)).toBe(0)
    expect(clampVolume(1)).toBe(1)
    expect(clampVolume(2)).toBe(1)
    expect(clampVolume(-1)).toBe(0)
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME)
    expect(clampVolume(Infinity)).toBe(DEFAULT_VOLUME)
  })
})

describe('createWebAlarmPlayer', () => {
  it('creates no audio context until unlocked', () => {
    const { player, contexts } = harness()
    expect(contexts).toHaveLength(0)
    expect(player.playing).toBe(false)
  })

  it('creates and resumes the context on unlock and pre-renders the default sound', async () => {
    const { player, render, ctx } = harness()
    player.unlock()
    expect(ctx().resumes).toBe(1)
    await flush()
    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]?.[1]).toBe('chime')
    expect(ctx().sounds).toHaveLength(0)
  })

  it('starts a one-frame silent source while unlocking, for iOS', () => {
    const { player, ctx } = harness()
    player.unlock()
    const tick = ctx().sources[0]
    expect(tick?.started).toBe(true)
    expect(tick?.connectedTo).toBe(ctx().destination)
    tick?.end()
    expect(tick?.disconnected).toBe(true)
  })

  it('reuses one context and skips resume once it runs', () => {
    const { player, ctx } = harness()
    player.unlock()
    player.unlock()
    player.unlock()
    expect(ctx().resumes).toBe(1)
  })

  it('queues a sound requested before unlock and starts it, looping, on unlock', async () => {
    const { player, contexts, ctx } = harness()
    player.play('bell', { loop: true, volume: 0.5 })
    expect(player.playing).toBe(true)
    expect(contexts).toHaveLength(0)

    player.unlock()
    await flush()
    const [source] = ctx().sounds
    expect(soundOf(source)).toBe('bell')
    expect(source?.loop).toBe(true)
    expect(source?.started).toBe(true)
    const gain = source?.connectedTo as FakeGain
    expect(gain.gain.value).toBe(0.5)
    expect(gain.connectedTo).toBe(ctx().destination)
  })

  it('plays at once when already unlocked', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('beep', { loop: true, volume: 0.8 })
    await flush()
    expect(ctx().sounds.map(soundOf)).toEqual(['beep'])
  })

  it('creates the context itself after an earlier user gesture, without unlock', async () => {
    const { player, ctx } = harness({ hasUserActivation: () => true })
    player.play('chime', { loop: true, volume: 0.8 })
    await flush()
    expect(ctx().resumes).toBe(1)
    expect(ctx().sounds.map(soundOf)).toEqual(['chime'])
  })

  it('treats a repeated request for the looping sound as a volume change', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('chime', { loop: true, volume: 0.8 })
    await flush()
    player.play('chime', { loop: true, volume: 0.3 })
    player.play('chime', { loop: true, volume: 0.3 })
    await flush()
    expect(ctx().sounds).toHaveLength(1)
    const gain = ctx().sounds[0]?.connectedTo as FakeGain
    expect(gain.gain.targets.at(-1)?.value).toBe(0.3)
  })

  it('replaces the sound when a different one is requested, fading the old one out', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('chime', { loop: true, volume: 0.8 })
    await flush()
    player.play('bell', { loop: true, volume: 0.8 })
    await flush()
    const [chime, bell] = ctx().sounds
    expect(soundOf(bell)).toBe('bell')
    const chimeGain = chime?.connectedTo as FakeGain
    expect(chimeGain.gain.targets.at(-1)?.value).toBe(0)
    expect(chime?.stoppedAt).toBeCloseTo(ctx().currentTime + 0.04, 9)
    expect(bell?.stoppedAt).toBeNull()
    // The engine ends the faded source; it is detached and does not disturb the new one.
    chime?.end()
    expect(chime?.disconnected).toBe(true)
    expect(player.playing).toBe(true)
  })

  it('stops with a fade, reports not playing, and tolerates repeated stops', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('chime', { loop: true, volume: 0.8 })
    await flush()
    player.stop()
    player.stop()
    expect(player.playing).toBe(false)
    const [source] = ctx().sounds
    expect(source?.stoppedAt).not.toBeNull()
    source?.end()
    expect(source?.disconnected).toBe(true)
  })

  it('starts nothing when stopped before the sound finished rendering', async () => {
    let resolve: (buffer: AudioBuffer) => void = () => undefined
    const render = vi.fn(
      () =>
        new Promise<AudioBuffer>((r) => {
          resolve = r
        }),
    )
    const { player, ctx } = harness({ render })
    player.unlock()
    player.play('bell', { loop: true, volume: 0.8 })
    player.stop()
    resolve({ sound: 'bell' } as unknown as AudioBuffer)
    await flush()
    expect(ctx().sounds).toHaveLength(0)
  })

  it('renders each sound once and reuses the buffer', async () => {
    const { player, render } = harness()
    player.unlock()
    for (let i = 0; i < 3; i++) {
      player.play('bell', { loop: true, volume: 0.8 })
      await flush()
      player.stop()
    }
    const bells = render.mock.calls.filter(([, sound]) => sound === 'bell')
    expect(bells).toHaveLength(1)
  })

  it('warns when a sound fails to render and retries on the next unlock', async () => {
    let fail = true
    const render = vi.fn((_ctx: BaseAudioContext, sound: SoundId) =>
      fail
        ? Promise.reject(new Error('no offline audio'))
        : Promise.resolve({ sound } as unknown as AudioBuffer),
    )
    const { player, warn, ctx } = harness({ render })
    player.play('beep', { loop: true, volume: 0.8 })
    player.unlock()
    await flush()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('beep'), expect.any(Error))
    expect(ctx().sounds).toHaveLength(0)

    fail = false
    player.unlock()
    await flush()
    expect(ctx().sounds.map(soundOf)).toEqual(['beep'])
  })

  it('warns instead of failing when the context refuses to start a source', async () => {
    const { player, warn, ctx } = harness()
    player.unlock()
    const live = ctx()
    const create = live.createBufferSource.bind(live)
    live.createBufferSource = () => {
      const source = create()
      source.start = () => {
        throw new Error('InvalidStateError')
      }
      return source
    }
    player.play('bell', { loop: true, volume: 0.8 })
    player.preview('beep', 0.5)
    await flush()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bell'), expect.any(Error))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('beep'), expect.any(Error))
  })

  it('plays a one-shot sound once and reports not playing when it ends', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('beep', { loop: false, volume: 0.8 })
    await flush()
    const [source] = ctx().sounds
    expect(source?.loop).toBe(false)
    expect(player.playing).toBe(true)
    source?.end()
    expect(player.playing).toBe(false)
  })

  it('restarts a one-shot sound requested again', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('beep', { loop: false, volume: 0.8 })
    await flush()
    player.play('beep', { loop: false, volume: 0.8 })
    await flush()
    expect(ctx().sounds).toHaveLength(2)
  })

  it('clamps the volume it plays at', async () => {
    const { player, ctx } = harness()
    player.unlock()
    player.play('chime', { loop: true, volume: 7 })
    await flush()
    expect((ctx().sounds[0]?.connectedTo as FakeGain).gain.value).toBe(1)
  })

  it('swallows a refused resume; the next gesture tries again', () => {
    const { player, contexts } = harness()
    player.play('chime', { loop: true, volume: 0.8 })
    // Make the first context refuse to resume.
    player.unlock()
    const [ctx] = contexts
    if (!ctx) throw new Error('no context')
    ctx.state = 'suspended'
    ctx.resumeResult = Promise.reject(new Error('not allowed'))
    expect(() => {
      player.unlock()
    }).not.toThrow()
    expect(ctx.resumes).toBe(2)
  })

  describe('without Web Audio', () => {
    it('does nothing but still tracks the request', () => {
      const { player } = harness({ createContext: null })
      player.unlock()
      player.play('chime', { loop: true, volume: 0.8 })
      expect(player.playing).toBe(true)
      player.preview('bell', 0.5)
      player.stop()
      expect(player.playing).toBe(false)
    })

    it('warns once when the context cannot be created and stops trying', () => {
      const createContext = vi.fn((): AudioContext => {
        throw new Error('too many contexts')
      })
      const { player, warn } = harness({ createContext })
      player.unlock()
      player.unlock()
      player.play('chime', { loop: true, volume: 0.8 })
      expect(createContext).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)
    })
  })

  describe('preview', () => {
    it('unlocks and plays the sound once without touching the alarm state', async () => {
      const { player, ctx } = harness()
      player.preview('bell', 0.4)
      await flush()
      const [source] = ctx().sounds
      expect(soundOf(source)).toBe('bell')
      expect(source?.loop).toBe(false)
      expect((source?.connectedTo as FakeGain).gain.value).toBe(0.4)
      expect(player.playing).toBe(false)
      source?.end()
      expect(source?.disconnected).toBe(true)
    })

    it('replaces a preview that is still playing', async () => {
      const { player, ctx } = harness()
      player.preview('bell', 0.4)
      await flush()
      player.preview('beep', 0.4)
      await flush()
      const [bell, beep] = ctx().sounds
      expect(bell?.stoppedAt).not.toBeNull()
      expect(soundOf(beep)).toBe('beep')
      expect(beep?.stoppedAt).toBeNull()
    })

    it('plays alongside a ringing alarm and leaves it ringing', async () => {
      const { player, ctx } = harness()
      player.unlock()
      player.play('chime', { loop: true, volume: 0.8 })
      await flush()
      player.preview('beep', 0.5)
      await flush()
      const [alarm, preview] = ctx().sounds
      expect(soundOf(preview)).toBe('beep')
      preview?.end()
      expect(alarm?.stoppedAt).toBeNull()
      expect(player.playing).toBe(true)
    })
  })
})

describe('idle suspend', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A player with fake timers that suspends 100 ms after the last sound. */
  function idleHarness(): Harness {
    vi.useFakeTimers()
    return harness({ idleSuspendMs: 100 })
  }

  it('suspends the context a moment after the first unlock when nothing plays', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(99)
    expect(ctx().suspends).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(ctx().suspends).toBe(1)
    expect(ctx().state).toBe('suspended')
  })

  it('does not wake the context on later gestures with nothing to play', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(100)
    player.unlock()
    player.unlock()
    expect(ctx().resumes).toBe(1)
    expect(ctx().state).toBe('suspended')
  })

  it('stays awake while the alarm plays and suspends after it stops', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(100)
    player.play('chime', { loop: true, volume: 0.8 })
    expect(ctx().state).toBe('running')
    expect(ctx().resumes).toBe(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(ctx().suspends).toBe(1)
    player.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(ctx().suspends).toBe(2)
  })

  it('recovers a context the OS interrupted on the next gesture, then idles again', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(0)
    ;(ctx() as { state: string }).state = 'interrupted'
    player.unlock()
    expect(ctx().resumes).toBe(2)
    expect(ctx().state).toBe('running')
    await vi.advanceTimersByTimeAsync(100)
    expect(ctx().state).toBe('suspended')
  })

  it('wakes a suspended context for a waiting alarm on the next gesture', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(100)
    player.play('chime', { loop: true, volume: 0.8 })
    ctx().state = 'suspended' // the OS interrupted the output
    player.unlock()
    expect(ctx().state).toBe('running')
    expect(ctx().resumes).toBe(3)
  })

  it('cancels a pending suspend when a sound starts', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    await vi.advanceTimersByTimeAsync(50)
    player.play('bell', { loop: true, volume: 0.8 })
    await vi.advanceTimersByTimeAsync(500)
    expect(ctx().suspends).toBe(0)
  })

  it('suspends after a one-shot sound and after a preview ends', async () => {
    const { player, ctx } = idleHarness()
    player.unlock()
    player.play('beep', { loop: false, volume: 0.8 })
    await vi.advanceTimersByTimeAsync(0)
    ctx().sounds[0]?.end()
    await vi.advanceTimersByTimeAsync(100)
    expect(ctx().suspends).toBe(1)

    player.preview('bell', 0.5)
    expect(ctx().state).toBe('running')
    await vi.advanceTimersByTimeAsync(0)
    ctx().sounds[1]?.end()
    await vi.advanceTimersByTimeAsync(100)
    expect(ctx().suspends).toBe(2)
  })
})

describe('unlockAudioOnGestures', () => {
  it('unlocks on pointer and key gestures until removed', () => {
    const target = new EventTarget()
    const unlock = vi.fn()
    const player = { unlock } as unknown as AlarmPlayer
    const remove = unlockAudioOnGestures(player, target)
    for (const type of ['pointerdown', 'pointerup', 'keydown'])
      target.dispatchEvent(new Event(type))
    target.dispatchEvent(new Event('scroll'))
    expect(unlock).toHaveBeenCalledTimes(3)
    remove()
    target.dispatchEvent(new Event('keydown'))
    expect(unlock).toHaveBeenCalledTimes(3)
  })

  it('does nothing without a target', () => {
    const player = { unlock: vi.fn() } as unknown as AlarmPlayer
    expect(() => {
      unlockAudioOnGestures(player, null)()
    }).not.toThrow()
  })
})

/**
 * Server-time offset (spec › Sync › Clock skew): device clocks can be seconds apart, so a signed-in
 * device measures how far its clock is from the server's and the app clock adds the difference
 * (`src/state/app-clock.ts`). Every device then stamps and reads timer state in server time and
 * shows the same remaining time.
 *
 * A measurement takes three samples of `GET /api/time` one after another and keeps the one with
 * the shortest round trip (the least room for asymmetric delay): offset = server time + half the
 * round trip − device time at the answer. Offsets under 250 ms are not worth a jump of the display
 * and count as 0. The offset is measured on sign-in, on every reconnect of the sync socket and
 * every 30 minutes while signed in; signed out it is 0.
 */
import { systemClock, type Clock, type Ms } from '../core'
import { clockOffset, setClockOffset } from '../state/app-clock'
import { apiUrl } from './api'
import { API_PATHS } from './protocol'

/** Offsets smaller than this (either way) are not applied: the app clock stays on device time. */
export const CLOCK_OFFSET_THRESHOLD_MS = 250

/** Requests per measurement; the one with the shortest round trip counts. */
export const CLOCK_SAMPLES = 3

/** How often the offset is measured again while signed in. */
export const CLOCK_REMEASURE_INTERVAL_MS = 30 * 60_000

/** How long one sample may take before it counts as failed. */
export const CLOCK_SAMPLE_TIMEOUT_MS = 5000

/** The parts of `fetch` a measurement uses. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** One request's result: the offset it suggests and how long the round trip took. */
export interface TimeSample {
  readonly offset: Ms
  readonly roundTrip: Ms
}

export interface MeasureOptions {
  /** `fetch` by default. */
  readonly fetch?: FetchLike | undefined
  /** The time endpoint; `/api/time` on the API origin by default. */
  readonly url?: string | undefined
  /** The device clock (never the app clock, which already has an offset). System time by default. */
  readonly clock?: Clock | undefined
  /** How many requests to make; {@link CLOCK_SAMPLES} by default. */
  readonly samples?: number | undefined
  /** How long each request may take; {@link CLOCK_SAMPLE_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number | undefined
}

/** The server time in a `TimeResponse` body, or null when the body is not one. */
function serverTime(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('now' in body)) return null
  const { now } = body
  return typeof now === 'number' && Number.isFinite(now) ? now : null
}

/**
 * One request to the time endpoint: the offset it suggests and its round trip, or null when it
 * failed (network, timeout, an error status, a body that is not a `TimeResponse`, a clock that
 * went backwards during the request).
 */
async function sample(
  request: FetchLike,
  url: string,
  clock: Clock,
  timeoutMs: number,
): Promise<TimeSample | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const sentAt = clock()
    const response = await request(url, {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const now = serverTime(await response.json())
    const receivedAt = clock()
    const roundTrip = receivedAt - sentAt
    if (now === null || roundTrip < 0) return null
    return { offset: now + roundTrip / 2 - receivedAt, roundTrip }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** The sample with the shortest round trip (the first of equals), or null when there is none. */
export function bestSample(samples: readonly (TimeSample | null)[]): TimeSample | null {
  let best: TimeSample | null = null
  for (const candidate of samples) {
    if (candidate && (best === null || candidate.roundTrip < best.roundTrip)) best = candidate
  }
  return best
}

/**
 * Measures how far the server's clock is ahead of the device's, in whole milliseconds (negative
 * when the device is ahead): {@link CLOCK_SAMPLES} requests one after another, the shortest round
 * trip wins. Resolves to null when every request failed (offline, server down). Never rejects.
 */
export async function measureOffset(options: MeasureOptions = {}): Promise<Ms | null> {
  const request: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
  const url = options.url ?? apiUrl(API_PATHS.time)
  const clock = options.clock ?? systemClock
  const count = Math.max(1, Math.floor(options.samples ?? CLOCK_SAMPLES))
  const timeoutMs = options.timeoutMs ?? CLOCK_SAMPLE_TIMEOUT_MS
  const samples: (TimeSample | null)[] = []
  // One after another, so the requests do not queue behind each other on the connection.
  for (let i = 0; i < count; i++) samples.push(await sample(request, url, clock, timeoutMs))
  const best = bestSample(samples)
  return best === null ? null : Math.round(best.offset) || 0
}

/**
 * The offset to apply for a measured one: itself when it is at least
 * {@link CLOCK_OFFSET_THRESHOLD_MS} either way, else 0 (the device clock is close enough).
 */
export function applicableOffset(measured: Ms): Ms {
  return Number.isFinite(measured) && Math.abs(measured) >= CLOCK_OFFSET_THRESHOLD_MS
    ? Math.round(measured)
    : 0
}

/** Keeps the app clock's offset measured while signed in. */
export interface ClockSync {
  /**
   * Measures the offset now and applies it ({@link applicableOffset}). A measurement that fails
   * keeps the current offset. A call while one runs shares it. Never rejects.
   */
  measure(): Promise<void>
  /** Measures now, then every {@link CLOCK_REMEASURE_INTERVAL_MS} until stopped. Idempotent. */
  start(): void
  /**
   * Stops measuring and sets the offset back to 0 (signed out). A measurement still running is
   * discarded. Idempotent.
   */
  stop(): void
  /** Whether it is started. */
  readonly running: boolean
}

/** Dependencies of {@link createClockSync}; every field has a default. */
export interface ClockSyncOptions {
  /** Takes one measurement; {@link measureOffset} against the API by default. */
  readonly measure?: (() => Promise<Ms | null>) | undefined
  /** Applies an offset; the app clock's `setClockOffset` by default. */
  readonly apply?: ((offset: Ms) => void) | undefined
  /** The offset in use; the app clock's by default. Read to skip applying an unchanged one. */
  readonly current?: (() => Ms) | undefined
  /** Time between measurements while started; {@link CLOCK_REMEASURE_INTERVAL_MS} by default. */
  readonly intervalMs?: number | undefined
}

/** Creates a stopped {@link ClockSync}. */
export function createClockSync(options: ClockSyncOptions = {}): ClockSync {
  const takeMeasurement = options.measure ?? (() => measureOffset())
  const apply = options.apply ?? setClockOffset
  const current = options.current ?? clockOffset
  const intervalMs = options.intervalMs ?? CLOCK_REMEASURE_INTERVAL_MS
  let interval: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | null = null
  /** Bumped by `stop`, so a measurement that started before it never applies after it. */
  let generation = 0

  function measure(): Promise<void> {
    if (inFlight) return inFlight
    const started = generation
    const run = (async () => {
      const measured = await Promise.resolve()
        .then(takeMeasurement)
        .catch(() => null)
      if (started !== generation || measured === null) return
      const next = applicableOffset(measured)
      if (next !== current()) apply(next)
    })()
    const done = run.finally(() => {
      if (inFlight === done) inFlight = null
    })
    inFlight = done
    return done
  }

  return {
    measure,
    start() {
      if (interval !== undefined) return
      interval = setInterval(() => {
        void measure()
      }, intervalMs)
      void measure()
    },
    stop() {
      generation++
      inFlight = null
      if (interval !== undefined) {
        clearInterval(interval)
        interval = undefined
      }
      if (current() !== 0) apply(0)
    },
    get running() {
      return interval !== undefined
    },
  }
}

/** The app's clock sync: `GET /api/time` on the API origin, applied to the app clock. */
export const clockSync: ClockSync = createClockSync()

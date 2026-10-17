/**
 * The wake worker: a module worker that holds one timeout for the earliest timer deadline and
 * posts `'fire'` when it passes. Browsers throttle main-thread timers in hidden tabs (Chrome by up
 * to a minute), but not a dedicated worker's, so alarms ring on time in a background tab.
 * Protocol and logic: `wake-timer.ts`. Spawned by `wake.ts`.
 */
import { connectWakeWorker } from './wake-timer'

connectWakeWorker(self)

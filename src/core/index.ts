/**
 * Public entry point of the pure core engine. Timer and stopwatch transitions are namespaced
 * (`timer.start`, `stopwatch.start`) because both modules export functions with the same names.
 */
export * from './types'
export * from './clock'
export * as timer from './timer'
export * as stopwatch from './stopwatch'
export * as digits from './digit-entry'
export * from './format'
export * from './ticker'

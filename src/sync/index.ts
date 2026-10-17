/**
 * The data layer: the two TinyBase stores, their schemas and codecs, persistence (IndexedDB and
 * localStorage), tab sync, and the bridge that mirrors the card store into the synced store.
 * State modules read and write settings and presets through `src/state`; only `src/state` and
 * this folder touch TinyBase.
 */
export * from './schema'
export * from './stores'
export * from './persist'
export * from './tabs'
export * from './cards-bridge.svelte'
export * from './bootstrap'

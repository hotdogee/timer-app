/**
 * Everything the desktop services do in the shell, as one lazily loaded chunk: `services.ts`
 * imports it on the first call to any desktop service (only the desktop app ever does), so the web
 * bundle carries one small loader instead of one per service.
 */
export * as accent from './accent'
export * as activity from './activity'
export * as autostart from './autostart'
export * as hotkeys from './hotkeys'
export * as miniWindow from './mini-window'
export * as notifications from './notifications'
export * as opener from './opener'
export * as updater from './updater'

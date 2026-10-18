/**
 * The desktop app's services: the {@link Platform} services backed by the Tauri shell (M5). Each
 * is a thin object, free of side effects until it is used, that keeps only what must answer at
 * once (whether the mini window is open, the notification permission, the listeners). The first
 * call to any of them loads the code that does the work and talks to the shell (`./desktop`, which
 * gathers `./accent`, `./hotkeys`, …) through dynamic `import()`, so `@tauri-apps/*` and the
 * desktop logic stay out of the web bundle.
 *
 * As everywhere in `src/platform`, nothing here rejects. A shell call that fails (a plugin that is
 * missing or not permitted, a command that errors) logs one `console.warn` and turns that service
 * off for good: its calls then resolve to the "nothing happened" value, and its `supported` reads
 * false, so the UI drops its controls the next time it draws them. The exceptions are results,
 * not failures: a hotkey the OS refuses (taken, or any other error for that one combo), a URL the
 * opener may not open, and an update check or install that fails (one warning each time; the next
 * call tries again).
 *
 * @see `src-tauri/src` for the commands and events, and `src-tauri/capabilities` for what each
 * window may call.
 */
import type { AccentSource } from '../accent'
import type { Platform } from '../index'
import type { NotificationPermissionState, Notifier } from '../notifications'
import type {
  ActivityReporter,
  Autostart,
  GlobalHotkeys,
  HotkeyId,
  MiniWindowController,
  Opener,
  UpdateCheck,
  Updater,
} from '../types'
import { isWebUrl } from '../web/url'
import type { TrayLabels } from './activity'
import type * as DesktopModule from './desktop'
import type * as SmokeModule from './smoke'

export type { TrayLabels } from './activity'

/**
 * Small hooks into the desktop shell that only the app's bootstrap and the mini window's page
 * use. On the web every method does nothing.
 */
export interface DesktopShell {
  /** Whether a shell is listening (the desktop app). */
  readonly supported: boolean
  /**
   * Sends the tray menu's labels in the app's language (the shell starts with English). Call it
   * at startup and whenever the language changes; repeating the same labels sends nothing.
   */
  setTrayLabels(labels: TrayLabels): void
  /**
   * In the mini window's own page: calls `listener` with the card id each time the main window
   * opens the mini window for another card while it is open, so the page switches to that card
   * (the `?card=` of its URL is the first one). Returns the function that unsubscribes.
   */
  onMiniCard(listener: (cardId: string) => void): () => void
  /**
   * Development builds of the desktop app only: prints `[smoke] <time> <message>` on the shell's
   * output, which `scripts/smoke-desktop.mjs` reads. Does nothing in production and on the web.
   */
  smokeMark(message: string): void
}

/** The desktop code: each service's module (`./desktop`). */
export type Desktop = typeof DesktopModule

/** Loads the desktop code; tests may pass fakes. */
export interface TauriModules {
  readonly desktop: () => Promise<Desktop>
  /** Null in production builds, which have no smoke hook (the import is left out of the build). */
  readonly smoke: (() => Promise<typeof SmokeModule>) | null
}

/** The real code, in lazily loaded chunks. */
export const TAURI_MODULES: TauriModules = {
  desktop: () => import('./desktop'),
  smoke: import.meta.env.DEV ? () => import('./smoke') : null,
}

/** Loads one service's module of the desktop code (once: the import is cached). */
type Load<K extends keyof Desktop> = () => Promise<Desktop[K]>

/** The services {@link createTauriServices} replaces in the platform. */
export type TauriServices = Pick<
  Platform,
  | 'accent'
  | 'notifications'
  | 'windows'
  | 'hotkeys'
  | 'autostart'
  | 'updater'
  | 'activity'
  | 'opener'
  | 'shell'
>

const noop = (): void => undefined

/** A service's connection to what does its work (see {@link link}). */
interface Link<T> {
  /** Whether a failure turned the service off. */
  readonly off: boolean
  /**
   * Runs `task` on the loaded implementation. Resolves to `fallback` when the service is off, and
   * when loading or the task fails, which turns the service off with one warning. Never rejects.
   */
  run<R>(task: (implementation: T) => R | Promise<R>, fallback: R): Promise<R>
}

/** Connects the service `name` (for the warning) to what `load` loads, once, on first use. */
function link<T>(name: string, load: () => Promise<T>): Link<T> {
  let loading: Promise<T> | undefined
  let off = false
  return {
    get off() {
      return off
    },
    async run(task, fallback) {
      if (off) return fallback
      try {
        return await task(await (loading ??= load()))
      } catch (error) {
        if (!off) {
          off = true
          console.warn(`Timer App: the desktop ${name} failed and is off from now on`, error)
        }
        return fallback
      }
    },
  }
}

/** Calls an unlisten function, ignoring its failure (Tauri's return a promise despite the type). */
function disconnect(unlisten: () => unknown): void {
  try {
    void Promise.resolve(unlisten()).catch(noop)
  } catch {
    // The shell is gone; nothing listens any more.
  }
}

/** A set of listeners: `add` subscribes (a listener added twice is called twice), `emit` calls them. */
function listenerSet<T>(): {
  readonly emit: (value: T) => void
  readonly add: (listener: (value: T) => void) => () => void
} {
  const listeners = new Set<(value: T) => void>()
  return {
    emit(value) {
      for (const listener of [...listeners]) listener(value)
    },
    add(listener) {
      const entry = (value: T): void => {
        listener(value)
      }
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
  }
}

/**
 * The subscribe function of something the shell reports: the first listener connects (`connect`
 * resolves to the function that disconnects, and never rejects), the last one to leave
 * disconnects.
 */
function subscribers<T>(
  connect: (emit: (value: T) => void) => Promise<() => unknown>,
): (listener: (value: T) => void) => () => void {
  const listeners = listenerSet<T>()
  let count = 0
  let connection: Promise<() => unknown> | null = null
  return (listener) => {
    const remove = listeners.add(listener)
    count += 1
    connection ??= connect(listeners.emit)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      remove()
      count -= 1
      if (count > 0 || connection === null) return
      void connection.then(disconnect)
      connection = null
    }
  }
}

function createAccent(load: Load<'accent'>): AccentSource {
  const shell = link('accent color', load)
  return {
    get: () => shell.run((module) => module.accentColor(), null),
    onChange: subscribers<string>((emit) =>
      shell.run((module) => module.onAccentChanged(emit), noop),
    ),
  }
}

/**
 * The permission as the plugin's stand-in for the web `Notification` reports it (the plugin
 * replaces `window.Notification` in the webview and settles it at startup), or null without one.
 */
function pluginPermission(): NotificationPermissionState | null {
  const value = (globalThis as { Notification?: { permission?: unknown } }).Notification?.permission
  return value === 'granted' || value === 'denied' || value === 'default' ? value : null
}

function createNotifier(load: Load<'notifications'>): Notifier {
  const shell = link('notifications', () =>
    load().then((module) => module.createNotificationSender()),
  )
  /** The answer of the last {@link Notifier.request}, which wins over the plugin's stand-in. */
  let answered: NotificationPermissionState | null = null
  const permission = (): NotificationPermissionState =>
    shell.off ? 'unsupported' : (answered ?? pluginPermission() ?? 'default')
  return {
    get supported() {
      return !shell.off
    },
    permission,
    request: () =>
      shell.run(async (sender) => {
        answered = await sender.request()
        return answered === 'granted'
      }, false),
    show(request) {
      if (permission() !== 'granted') return null
      let open = true
      const { onClick } = request
      // A click that arrives after `close` does nothing, even before the sender forgot it.
      const clicked = onClick && ((): void => void (open && onClick()))
      const shown = shell.run(
        (sender) => sender.show({ ...request, onClick: clicked }, () => open),
        () => Promise.resolve(),
      )
      return {
        close() {
          if (!open) return
          open = false
          void shell.run(async () => (await shown)(), undefined)
        },
      }
    },
  }
}

function createMiniWindow(load: Load<'miniWindow'>): MiniWindowController {
  const changes = listenerSet<boolean>()
  let open = false
  const setOpen = (next: boolean): void => {
    if (next === open) return
    open = next
    changes.emit(next)
  }
  // Loading starts following the window: its closing, and whether it is open already.
  const shell = link('mini window', async () => {
    const module = await load()
    await module.trackMini(setOpen)
    return module
  })
  return {
    get supported() {
      return !shell.off
    },
    isOpen: () => open,
    // The shell's mini window renders the `/mini` page itself, so `render` is not needed here.
    open: (cardId, _render, options) =>
      shell.run(async (module) => {
        await module.openMini(cardId, options?.alwaysOnTop ?? true)
        setOpen(true)
      }, undefined),
    close: () =>
      shell.run(async (module) => {
        await module.closeMini()
        setOpen(false)
      }, undefined),
    setAlwaysOnTop: (alwaysOnTop) =>
      shell.run((module) => module.setMiniAlwaysOnTop(alwaysOnTop), undefined),
    onChange(listener) {
      void shell.run(noop, undefined)
      return changes.add(listener)
    },
  }
}

function createHotkeys(load: Load<'hotkeys'>): GlobalHotkeys {
  const presses = listenerSet<HotkeyId>()
  const shell = link('global hotkeys', () =>
    load().then((module) => module.createHotkeyBinder(presses.emit)),
  )
  return {
    get supported() {
      return !shell.off
    },
    set: (id, combo) => shell.run((binder) => binder.set(id, combo), 'unsupported'),
    onPressed: presses.add,
  }
}

function createAutostart(load: Load<'autostart'>): Autostart {
  const shell = link('launch at login', load)
  return {
    get supported() {
      return !shell.off
    },
    // Not known when the OS cannot be asked: the setting stays as it is.
    isEnabled: () => shell.run<boolean | null>((module) => module.isEnabled(), null),
    // A failed change leaves the state it had, which the switch springs back to.
    setEnabled: (enabled) => shell.run((module) => module.setEnabled(enabled), !enabled),
  }
}

function createUpdater(load: Load<'updater'>): Updater {
  const shell = link('updater', () => load().then((module) => module.createUpdater()))
  const configured = (): Promise<boolean> => shell.run((updater) => updater.configured(), false)
  return {
    get supported() {
      return !shell.off
    },
    configured,
    check: async () =>
      (await configured()) ? shell.run<UpdateCheck>((updater) => updater.check(), 'failed') : null,
    install: (onProgress) => shell.run((updater) => updater.install(onProgress), false),
    restart: () => shell.run((updater) => updater.restart(), undefined),
  }
}

function createActivity(load: Load<'activity'>): ActivityReporter {
  const shell = link('shell connection', () => load().then((module) => module.createReports()))
  const toggles = link('tray connection', load)
  return {
    get supported() {
      return !shell.off
    },
    setRunning(running) {
      void shell.run((reports) => reports.setRunning(running), undefined)
    },
    setCloseBehavior(behavior) {
      void shell.run((reports) => reports.setCloseBehavior(behavior), undefined)
    },
    onToggleLast: subscribers<undefined>((emit) =>
      toggles.run(
        (module) =>
          module.onToggleLast(() => {
            emit(undefined)
          }),
        noop,
      ),
    ),
  }
}

function createOpener(load: Load<'opener'>): Opener {
  const shell = link('browser opener', load)
  return {
    get supported() {
      return !shell.off
    },
    open(url) {
      if (!isWebUrl(url)) {
        console.warn('Timer App: not opening a URL that is not http(s):', url)
        return Promise.resolve(false)
      }
      // A refusal is about this URL (the capability's scope), not the opener: the next one may
      // open. Only a plugin that fails to load turns it off.
      return shell.run(async (module) => {
        try {
          await module.openUrl(url)
          return true
        } catch (error) {
          console.warn('Timer App: the system browser did not open', url, error)
          return false
        }
      }, false)
    },
  }
}

function createShell(
  activity: Load<'activity'>,
  miniWindow: Load<'miniWindow'>,
  modules: TauriModules,
): DesktopShell {
  const tray = link('tray menu', () => activity().then((module) => module.createReports()))
  const mini = link('mini window page', miniWindow)
  const smoke = modules.smoke && link('smoke hook', modules.smoke)
  return {
    supported: true,
    setTrayLabels(labels) {
      void tray.run((reports) => reports.setTrayLabels(labels), undefined)
    },
    onMiniCard: subscribers<string>((emit) => mini.run((module) => module.onMiniCard(emit), noop)),
    smokeMark(message) {
      void smoke?.run((module) => module.smokeMark(message), undefined)
    },
  }
}

/**
 * The desktop services, each loading its module on first use. Synchronous and free of side
 * effects, like `createPlatform`.
 */
export function createTauriServices(modules: TauriModules = TAURI_MODULES): TauriServices {
  const part =
    <K extends keyof Desktop>(key: K): Load<K> =>
    () =>
      modules.desktop().then((desktop) => desktop[key])
  return {
    accent: createAccent(part('accent')),
    notifications: createNotifier(part('notifications')),
    windows: createMiniWindow(part('miniWindow')),
    hotkeys: createHotkeys(part('hotkeys')),
    autostart: createAutostart(part('autostart')),
    updater: createUpdater(part('updater')),
    activity: createActivity(part('activity')),
    opener: createOpener(part('opener')),
    shell: createShell(part('activity'), part('miniWindow'), modules),
  }
}

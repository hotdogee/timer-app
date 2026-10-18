/**
 * The settings store: every setting the app reads, as reactive snapshots that follow the TinyBase
 * stores (spec › Settings). Device settings (appearance, language), the desktop settings and the
 * desktop sign-in's bearer token live in the device store, and synced settings (behavior, keymap)
 * in the synced store; nothing else in the app reads or writes either store's values.
 *
 * Writes go to the stores, and the snapshots follow through values listeners, so a change made in
 * another tab (or, in M4, on another device) shows up exactly like a local one. Every update is
 * validated by `settings.migrateDeviceSettings` / `settings.migrateSyncedSettings`, and only the
 * values that changed are written, in one transaction. A snapshot is replaced only when its
 * content changed, and its `keymap` and `quickAdd` objects keep their identity while their content
 * does, so `bindings` (and the keymap's per-bindings cache) stay put.
 *
 * Methods read the snapshots untracked and write state, so call them from event handlers and
 * effects, never from a template expression or `$derived`.
 */
import { untrack } from 'svelte'

import { keymap, settings } from '../core'
import {
  AUTH_VALUE_IDS,
  SCHEMA_VERSION,
  changedValues,
  desktopSettingsToValues,
  deviceAuthToValues,
  deviceSettingsToValues,
  syncedSettingsToValues,
  valuesToDesktopSettings,
  valuesToDeviceAuth,
  valuesToDeviceSettings,
  valuesToSyncedSettings,
} from '../sync/schema'
import { appStores, type AppStores } from '../sync/stores'

/** The settings and the actions on them. Every getter is reactive. */
export interface SettingsStore {
  /** Appearance and language, for this device. Replaced whole, never mutated. */
  readonly device: settings.DeviceSettings
  /** Behavior and the keymap, synced across devices. Replaced whole, never mutated. */
  readonly synced: settings.SyncedSettings
  /**
   * The desktop app's settings (Settings › Desktop), for this machine; the defaults on the web,
   * which never changes them. Replaced whole, never mutated; `hotkeys` keeps its identity while
   * its content does.
   */
  readonly desktop: settings.DesktopSettings
  /**
   * The desktop sign-in's bearer token, for this machine, or null when there is none (always on
   * the web, which signs in with a cookie). It may have expired: compare `expiresAt` with the
   * current time before using it.
   */
  readonly auth: settings.DeviceAuth | null
  /** The effective shortcuts: the defaults with `synced.keymap` applied. */
  readonly bindings: keymap.Bindings
  /**
   * Changes some device settings. Invalid values fall back and out-of-range numbers are clamped,
   * as in `settings.migrateDeviceSettings`; a change that leaves everything as it was writes
   * nothing.
   */
  updateDevice(partial: Partial<settings.DeviceSettings>): void
  /** Changes some synced settings, as {@link updateDevice} does. */
  updateSynced(partial: Partial<settings.SyncedSettings>): void
  /**
   * Changes some desktop settings, as {@link updateDevice} does; `hotkeys` changes only the
   * hotkeys it names (`{ hotkeys: { showApp: null } }` unbinds one and keeps the other). A combo
   * that does not parse unbinds that hotkey.
   */
  updateDesktop(update: settings.DesktopSettingsUpdate): void
  /**
   * Restores every device setting to its default (Settings › Appearance › Reset). The desktop
   * settings and the bearer token stay.
   */
  resetDevice(): void
  /** Restores every desktop setting to its default (Settings › Desktop › Reset). */
  resetDesktop(): void
  /**
   * Stores the bearer token of a desktop sign-in, or removes it (signing out) when `auth` is null.
   * An invalid token (see `settings.migrateDeviceAuth`) removes it too.
   */
  setAuth(auth: settings.DeviceAuth | null): void
  /**
   * Restores every synced setting except the keymap to its default (Settings › Behavior ›
   * Reset; the keyboard shortcuts have their own).
   */
  resetBehavior(): void
  /** Gives every shortcut its default back (Settings › Keyboard › Reset all). */
  resetKeymap(): void
}

/** A settings store bound to stores of its own, which can be unbound (tests, isolated data). */
export interface BoundSettingsStore extends SettingsStore {
  /** Stops following the stores. The snapshots keep their last content. */
  destroy(): void
}

/**
 * Creates a settings store that follows `stores` (their values as they are now, then every change)
 * until destroyed.
 */
export function createSettingsStore(stores: AppStores): BoundSettingsStore {
  const { synced: syncedStore, device: deviceStore } = stores
  let device = $state.raw(valuesToDeviceSettings(deviceStore.getValues()))
  let desktop = $state.raw(valuesToDesktopSettings(deviceStore.getValues()))
  let auth = $state.raw(valuesToDeviceAuth(deviceStore.getValues()))
  let synced = $state.raw(valuesToSyncedSettings(syncedStore.getValues()))
  const bindings = $derived(settings.bindingsWith(synced.keymap))

  const deviceListener = deviceStore.addValuesListener(() => {
    const values = deviceStore.getValues()
    device = valuesToDeviceSettings(
      values,
      untrack(() => device),
    )
    desktop = valuesToDesktopSettings(
      values,
      untrack(() => desktop),
    )
    auth = valuesToDeviceAuth(
      values,
      untrack(() => auth),
    )
  })
  const syncedListener = syncedStore.addValuesListener(() => {
    synced = valuesToSyncedSettings(
      syncedStore.getValues(),
      untrack(() => synced),
    )
  })

  function writeDevice(next: settings.DeviceSettings): void {
    const changed = changedValues(
      deviceSettingsToValues(untrack(() => device)),
      deviceSettingsToValues(next),
    )
    if (changed === null) return
    deviceStore.setPartialValues(
      deviceStore.hasValue('schemaVersion')
        ? changed
        : { ...changed, schemaVersion: SCHEMA_VERSION },
    )
  }

  function writeDesktop(next: settings.DesktopSettings): void {
    const changed = changedValues(
      desktopSettingsToValues(untrack(() => desktop)),
      desktopSettingsToValues(next),
    )
    if (changed === null) return
    deviceStore.setPartialValues(
      deviceStore.hasValue('schemaVersion')
        ? changed
        : { ...changed, schemaVersion: SCHEMA_VERSION },
    )
  }

  function writeAuth(next: settings.DeviceAuth | null): void {
    if (next === null) {
      // Delete the values rather than blank them, so no trace of the token stays in storage.
      deviceStore.transaction(() => {
        for (const id of AUTH_VALUE_IDS) deviceStore.delValue(id)
      })
      return
    }
    const current = untrack(() => auth)
    const changed =
      current === null
        ? deviceAuthToValues(next)
        : changedValues(deviceAuthToValues(current), deviceAuthToValues(next))
    if (changed === null) return
    deviceStore.setPartialValues(
      deviceStore.hasValue('schemaVersion')
        ? changed
        : { ...changed, schemaVersion: SCHEMA_VERSION },
    )
  }

  function writeSynced(next: settings.SyncedSettings): void {
    const changed = changedValues(
      syncedSettingsToValues(untrack(() => synced)),
      syncedSettingsToValues(next),
    )
    if (changed === null) return
    syncedStore.setPartialValues(
      syncedStore.hasValue('schemaVersion')
        ? changed
        : { ...changed, schemaVersion: SCHEMA_VERSION },
    )
  }

  return {
    get device() {
      return device
    },
    get synced() {
      return synced
    },
    get desktop() {
      return desktop
    },
    get auth() {
      return auth
    },
    get bindings() {
      return bindings
    },
    updateDevice(partial) {
      writeDevice(settings.migrateDeviceSettings({ ...untrack(() => device), ...partial }))
    },
    updateSynced(partial) {
      writeSynced(settings.migrateSyncedSettings({ ...untrack(() => synced), ...partial }))
    },
    updateDesktop(update) {
      writeDesktop(
        settings.updateDesktopSettings(
          untrack(() => desktop),
          update,
        ),
      )
    },
    resetDevice() {
      writeDevice(settings.DEVICE_DEFAULTS)
    },
    resetDesktop() {
      writeDesktop(settings.DESKTOP_DEFAULTS)
    },
    setAuth(next) {
      writeAuth(next === null ? null : settings.migrateDeviceAuth(next))
    },
    resetBehavior() {
      writeSynced({ ...settings.SYNCED_DEFAULTS, keymap: untrack(() => synced).keymap })
    },
    resetKeymap() {
      writeSynced({ ...untrack(() => synced), keymap: settings.SYNCED_DEFAULTS.keymap })
    },
    destroy() {
      deviceStore.delListener(deviceListener)
      syncedStore.delListener(syncedListener)
    },
  }
}

/**
 * The app's settings. They follow the app's stores from the start: defaults until `startAppData`
 * loads the saved ones, then whatever the stores hold.
 */
export const settingsStore: SettingsStore = createSettingsStore(appStores)

<!--
  @component
  Settings › Desktop (spec › Settings › Desktop; the desktop app only): launch at login, what
  closing the window does, whether the mini window stays on top, and the two global hotkeys
  ("Start or pause the last card", "Show or hide Timer App"), which work while another app has the
  focus and are unbound until set here. Every change applies at once; Reset restores the defaults
  (no autostart, Q11's close behavior, on top, no hotkeys) and undoes them in the OS too.

  Launch at login follows the OS: the section reads the real state when it opens and keeps the
  setting in step (unless the OS cannot say), and a change the OS refuses springs back with a note,
  which is announced; once the OS has refused, the switch is unavailable the next time the section
  opens. A global hotkey is recorded like a keyboard shortcut (`ShortcutRecorder`), but needs Ctrl,
  Alt or Meta, may not be the other hotkey's, and is saved only once the OS has registered it; when
  another app holds the combo, the row says so and the previous combo stays. A combo another app
  held when the app started shows that error as soon as the section opens, which tries it again.
  While recording, both hotkeys are released (a registered one never reaches the page) and
  registered again afterwards. The tray is called the menu bar on a Mac.

  `services` are the platform's; tests pass fakes.

  ```svelte
  <DesktopSection {settingsStore} platform="other" />
  ```
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { keymap, settings } from '../../core'
  import { m } from '../../i18n'
  import { platform as appPlatform, type Platform } from '../../platform'
  import { bindHotkey, hotkeyStatus } from '../../state/hotkey-status.svelte'
  import type { SettingsStore } from '../../state/settings.svelte'
  import { announce } from '../announce.svelte'
  import KeyLabel from '../KeyLabel.svelte'
  import Icon from '../primitives/Icon.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import Select from '../primitives/Select.svelte'
  import Switch from '../primitives/Switch.svelte'
  import {
    CLOSE_BEHAVIOR_LABELS,
    HOTKEY_LABELS,
    classifyHotkey,
    hotkeyLabel,
    hotkeyResultMessage,
    needsModifierMessage,
  } from './desktop'
  import SectionHeader from './SectionHeader.svelte'
  import SettingRow from './SettingRow.svelte'
  import ShortcutRecorder from './ShortcutRecorder.svelte'
  import type { ControlIds } from './types'

  type HotkeyId = settings.HotkeyId

  interface Props {
    settingsStore: SettingsStore
    /** The modifier convention for key labels and recording (`Mod` is Cmd on `'mac'`). */
    platform: keymap.Platform
    /** Launch at login, the global hotkeys and the mini window; the platform's by default. */
    services?: Pick<Platform, 'autostart' | 'hotkeys' | 'windows'>
  }

  let { settingsStore, platform, services = appPlatform }: Props = $props()

  const uid = $props.id()
  const hotkeysHeadingId = `${uid}-hotkeys`
  const hotkeysDescriptionId = `${uid}-hotkeys-description`

  const desktop = $derived(settingsStore.desktop)
  const mac = $derived(platform === 'mac')
  const closeOptions = $derived(
    settings.CLOSE_BEHAVIORS.map((value) => ({
      value,
      label: CLOSE_BEHAVIOR_LABELS[value](platform),
    })),
  )

  // ── Launch at login ──────────────────────────────────────────────────────────────────────
  /** What the switch shows: the setting, or the user's choice while the OS is asked. */
  let launchChecked = $derived(desktop.launchAtLogin)
  /** The OS refused the last change. */
  let launchFailed = $state(false)
  /**
   * Whether the switch can be used: as the section opens (a refusal turns the service off; the
   * switch is not disabled under the user's hands, which would drop the focus).
   */
  let launchAvailable = $state(untrack(() => services.autostart.supported))

  // The OS has the last word (the user may have removed the entry there): read it on opening.
  $effect(() => {
    const { autostart } = services
    if (!autostart.supported) return
    let current = true
    void autostart.isEnabled().then((enabled) => {
      if (!current) return
      launchAvailable = autostart.supported
      // Unknown (the OS could not be asked): keep the setting.
      if (enabled === null) return
      if (enabled !== untrack(() => settingsStore.desktop.launchAtLogin)) {
        settingsStore.updateDesktop({ launchAtLogin: enabled })
      }
    })
    return () => {
      current = false
    }
  })

  async function setLaunch(enabled: boolean) {
    launchFailed = false
    const actual = await services.autostart.setEnabled(enabled)
    settingsStore.updateDesktop({ launchAtLogin: actual })
    launchChecked = actual
    launchFailed = actual !== enabled
    // The note under the switch is not read out when it changes; the switch springs back.
    if (launchFailed) announce(m.desktop_launch_at_login_failed())
  }

  function setOnTop(alwaysOnTop: boolean) {
    settingsStore.updateDesktop({ miniAlwaysOnTop: alwaysOnTop })
    void services.windows.setAlwaysOnTop(alwaysOnTop)
  }

  // ── Global hotkeys ───────────────────────────────────────────────────────────────────────
  /** The hotkey whose recorder is open, and what was wrong with its last key press. */
  let recording = $state<HotkeyId | null>(null)
  let recordError = $state<string | undefined>(undefined)
  /** What a stored hotkey's last registration came to, as its row's error, if it failed. */
  function statusError(id: HotkeyId): string | undefined {
    const status = hotkeyStatus[id]
    const stored = settingsStore.desktop.hotkeys[id]
    if (status === null || status.result === 'ok' || status.combo !== stored) return undefined
    return hotkeyResultMessage(status.result, hotkeyLabel(stored, platform) ?? stored)
  }

  /**
   * Each hotkey's registration problem, under its row: at first, what the launch registration (or
   * an earlier visit) came to.
   */
  let errors = $state<Partial<Record<HotkeyId, string>>>(
    untrack(() => Object.fromEntries(settings.HOTKEY_IDS.map((id) => [id, statusError(id)]))),
  )

  // A combo another app held may be free by now: try it again as the section opens.
  $effect(() => {
    untrack(() => {
      for (const id of settings.HOTKEY_IDS) {
        const stored = settingsStore.desktop.hotkeys[id]
        if (stored === null || hotkeyStatus[id]?.result !== 'taken') continue
        void bindHotkey(services.hotkeys, id, stored).then(() => {
          if (recording !== id) setError(id, statusError(id))
        })
      }
    })
  })
  /** Releasing the hotkeys for a recording, so binding again waits for it. */
  let released: Promise<unknown> = Promise.resolve()

  let root = $state<HTMLElement>()

  function focusRow(id: HotkeyId) {
    void tick().then(() => {
      root?.querySelector<HTMLElement>(`[data-hotkey="${id}"] [data-part="change"]`)?.focus()
    })
  }

  function setError(id: HotkeyId, message: string | undefined) {
    errors = { ...errors, [id]: message }
  }

  function startRecording(id: HotkeyId) {
    recordError = undefined
    setError(id, undefined)
    recording = id
    // A registered hotkey goes to the OS, never to the page: release both while recording.
    released = Promise.all(
      settings.HOTKEY_IDS.map((each) => bindHotkey(services.hotkeys, each, null)),
    )
  }

  /**
   * Registers every hotkey again after a recording: `id` with `next` when one was recorded (saved
   * once the OS takes it; the previous combo comes back when not), the others as stored.
   */
  async function bindAgain(id: HotkeyId, next: { text: string; label: string } | null) {
    await released
    for (const each of settings.HOTKEY_IDS) {
      const stored = untrack(() => settingsStore.desktop.hotkeys[each])
      if (each === id && next !== null) {
        const result = await bindHotkey(services.hotkeys, each, next.text)
        if (result === 'ok') {
          settingsStore.updateDesktop({ hotkeys: { [each]: next.text } })
          setError(each, undefined)
          announce(m.desktop_hotkey_set({ action: HOTKEY_LABELS[each](), key: next.label }))
          continue
        }
        setError(each, hotkeyResultMessage(result, next.label))
        if (stored !== null) await bindHotkey(services.hotkeys, each, stored)
        continue
      }
      if (stored === null) continue
      const result = await bindHotkey(services.hotkeys, each, stored)
      if (result !== 'ok') {
        setError(each, hotkeyResultMessage(result, hotkeyLabel(stored, platform) ?? stored))
      }
    }
  }

  function record(id: HotkeyId, combo: keymap.KeyCombo) {
    const result = classifyHotkey(
      untrack(() => settingsStore.desktop.hotkeys),
      id,
      combo,
      platform,
    )
    switch (result.kind) {
      case 'reserved':
        recordError = m.shortcut_reserved({ key: result.label })
        return
      case 'needs-modifier':
        recordError = needsModifierMessage(platform)
        return
      case 'conflict':
        recordError = m.shortcut_conflict({
          key: result.label,
          action: HOTKEY_LABELS[result.other](),
        })
        return
      case 'ok':
        recording = null
        recordError = undefined
        void bindAgain(id, { text: result.text, label: result.label })
        focusRow(id)
    }
  }

  function stopRecording(id: HotkeyId, reason: 'escape' | 'blur') {
    if (recording !== id) return
    recording = null
    recordError = undefined
    void bindAgain(id, null)
    if (reason === 'escape') focusRow(id)
  }

  async function remove(id: HotkeyId) {
    const label = hotkeyLabel(desktop.hotkeys[id], platform)
    await bindHotkey(services.hotkeys, id, null)
    settingsStore.updateDesktop({ hotkeys: { [id]: null } })
    setError(id, undefined)
    if (label !== null) announce(m.desktop_hotkey_removed({ action: HOTKEY_LABELS[id]() }))
    focusRow(id)
  }

  // Closing the dialog mid-recording must not leave the hotkeys released.
  $effect(() => () => {
    const open = untrack(() => recording)
    if (open !== null) void bindAgain(open, null)
  })

  // ── Reset ────────────────────────────────────────────────────────────────────────────────
  function reset() {
    const before = untrack(() => settingsStore.desktop)
    recording = null
    recordError = undefined
    errors = {}
    launchFailed = false
    settingsStore.resetDesktop()
    launchChecked = settings.DESKTOP_DEFAULTS.launchAtLogin
    if (before.launchAtLogin) void services.autostart.setEnabled(false)
    for (const id of settings.HOTKEY_IDS) {
      if (before.hotkeys[id] !== null) void bindHotkey(services.hotkeys, id, null)
    }
    if (!before.miniAlwaysOnTop) void services.windows.setAlwaysOnTop(true)
    announce(m.settings_reset_done({ section: m.settings_section_desktop() }))
  }
</script>

<div class="desktop" bind:this={root}>
  <SectionHeader
    title={m.settings_section_desktop()}
    resetLabel={m.settings_reset()}
    resetName={m.settings_reset_section({ section: m.settings_section_desktop() })}
    onreset={reset}
  />

  <SettingRow
    label={m.desktop_launch_at_login()}
    description={launchFailed
      ? m.desktop_launch_at_login_failed()
      : mac
        ? m.desktop_launch_at_login_description_mac()
        : m.desktop_launch_at_login_description()}
    warning={launchFailed}
    layout="inline"
  >
    {#snippet control(ids: ControlIds)}
      <Switch
        id={ids.id}
        aria-describedby={ids.descriptionId}
        checked={launchChecked}
        disabled={!launchAvailable}
        onchange={(enabled: boolean) => {
          launchChecked = enabled
          void setLaunch(enabled)
        }}
      />
    {/snippet}
  </SettingRow>

  <SettingRow
    label={m.desktop_close_behavior()}
    description={mac
      ? m.desktop_close_behavior_description_mac()
      : m.desktop_close_behavior_description()}
  >
    {#snippet control(ids: ControlIds)}
      <Select
        id={ids.id}
        aria-describedby={ids.descriptionId}
        value={desktop.closeBehavior}
        options={closeOptions}
        onchange={(closeBehavior: settings.CloseBehavior) => {
          settingsStore.updateDesktop({ closeBehavior })
        }}
      />
    {/snippet}
  </SettingRow>

  <SettingRow
    label={m.desktop_mini_on_top()}
    description={m.desktop_mini_on_top_description()}
    layout="inline"
  >
    {#snippet control(ids: ControlIds)}
      <Switch
        id={ids.id}
        aria-describedby={ids.descriptionId}
        checked={desktop.miniAlwaysOnTop}
        onchange={setOnTop}
      />
    {/snippet}
  </SettingRow>

  <section
    class="hotkeys"
    aria-labelledby={hotkeysHeadingId}
    aria-describedby={hotkeysDescriptionId}
  >
    <h4 id={hotkeysHeadingId}>{m.desktop_hotkeys()}</h4>
    <p class="description" id={hotkeysDescriptionId}>{m.desktop_hotkeys_description()}</p>
    <ul>
      {#each settings.HOTKEY_IDS as id (id)}
        {@const name = HOTKEY_LABELS[id]()}
        {@const label = hotkeyLabel(desktop.hotkeys[id], platform)}
        {@const error = errors[id]}
        {@const errorId = `${uid}-${id}-error`}
        <li class="hotkey" data-hotkey={id}>
          <div class="main">
            <span class="name" id={`${uid}-${id}`}>{name}</span>
            <div class="keys">
              {#if recording === id}
                <ShortcutRecorder
                  actionName={name}
                  {platform}
                  error={recordError}
                  onrecord={(combo: keymap.KeyCombo) => {
                    record(id, combo)
                  }}
                  oncancel={(reason: 'escape' | 'blur') => {
                    stopRecording(id, reason)
                  }}
                />
              {:else if label !== null}
                <span class="key">
                  <kbd><KeyLabel {label} /></kbd>
                  <button
                    type="button"
                    class="remove"
                    aria-label={m.shortcut_remove_label({ key: label, action: name })}
                    title={m.shortcut_remove_label({ key: label, action: name })}
                    onclick={() => {
                      void remove(id)
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              {:else}
                <span class="none">{m.shortcut_none()}</span>
              {/if}
            </div>
          </div>
          {#if recording !== id}
            <div class="buttons">
              <IconButton
                icon="edit"
                label={m.shortcut_change_label({ action: name })}
                data-part="change"
                aria-describedby={error === undefined ? undefined : errorId}
                onclick={() => {
                  startRecording(id)
                }}
              />
            </div>
          {/if}
          <p class="error" id={errorId} role="alert">{error ?? ''}</p>
        </li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .hotkeys {
    margin-block-start: var(--space-4);
  }

  h4 {
    margin: 0;
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00714em;
  }

  .description {
    margin: var(--space-1) 0 var(--space-1);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* As a row of Settings › Keyboard: the name and its key, the edit button, an error under them. */
  .hotkey {
    display: grid;
    grid-template-areas: 'main buttons' 'error error';
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    min-block-size: 3.5rem;
    padding-block: var(--space-1);
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  .hotkey:not(:has(> .buttons)) {
    grid-template-areas: 'main' 'error';
    grid-template-columns: minmax(0, 1fr);
  }

  .hotkey:last-child {
    border-block-end: none;
  }

  .main {
    display: flex;
    grid-area: main;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    min-inline-size: 0;
  }

  .name {
    flex: 1 1 auto;
    min-inline-size: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .keys {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  .buttons {
    display: flex;
    grid-area: buttons;
    margin-inline-end: calc(-1 * var(--space-2));
  }

  .key {
    display: inline-flex;
    align-items: center;
    block-size: 2rem;
    padding-inline: 0.625rem 0.125rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
  }

  kbd {
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    line-height: 1.25rem;
    white-space: nowrap;
  }

  .remove {
    position: relative;
    display: inline-grid;
    place-items: center;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    margin-inline-start: 0.125rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 1.125rem;
    cursor: pointer;
  }

  /* Invisible hit-area extension up to the touch target. */
  .remove::after {
    content: '';
    position: absolute;
    inset: min(0px, calc((100% - var(--touch-target, 44px)) / 2));
  }

  .remove::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
  }

  .remove:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .remove:focus-visible::before,
  .remove:active::before {
    opacity: var(--state-focus, 0.1);
  }

  .none {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  .error {
    grid-area: error;
    margin: 0 0 var(--space-1);
    color: var(--md-sys-color-error);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .error:empty {
    display: none;
  }

  @media (forced-colors: active) {
    .key {
      border-color: CanvasText;
    }

    .remove::before {
      display: none;
    }
  }
</style>

<!--
  @component
  Settings › Behavior (spec › Settings, Time's up): time format, clock format, the quick-add chips,
  the alarm (sound, volume, loop, auto-stop, overtime), notifications and confirm-before-delete.
  These sync with the account. Every change applies at once; Reset restores them all (the
  keyboard shortcuts have their own Reset). Turning notifications on asks the browser for
  permission, and says so when the browser blocks them.

  ```svelte
  <BehaviorSection {settingsStore} notifier={platform.notifications}
    previewSound={(sound, volume) => platform.audio.preview(sound, volume)} />
  ```
-->
<script lang="ts">
  import { settings, type Ms } from '../../core'
  import { localeState, m } from '../../i18n'
  import type { Notifier, NotificationPermissionState } from '../../platform'
  import type { SettingsStore } from '../../state/settings.svelte'
  import Button from '../primitives/Button.svelte'
  import SegmentedButtons from '../primitives/SegmentedButtons.svelte'
  import Select from '../primitives/Select.svelte'
  import Slider from '../primitives/Slider.svelte'
  import Switch from '../primitives/Switch.svelte'
  import DurationField from './DurationField.svelte'
  import SectionHeader from './SectionHeader.svelte'
  import SettingRow from './SettingRow.svelte'
  import type { ControlIds } from './types'
  import { announce } from '../announce.svelte'
  import { autoStopChoices, autoStopLabel, percentText, timeStyleDescription } from './values'

  interface Props {
    settingsStore: SettingsStore
    /** Asks for and reports the notification permission. */
    notifier: Pick<Notifier, 'permission' | 'request'>
    /** Plays a sound once at a volume, for the Preview button. */
    previewSound: (sound: settings.SoundId, volume: number) => void
  }

  let { settingsStore, notifier, previewSound }: Props = $props()

  const uid = $props.id()
  const quickAddHintId = `${uid}-quick-add-hint`

  const synced = $derived(settingsStore.synced)
  const ranges = settings.SETTING_RANGES
  const quickAddRange = { min: ranges.quickAdd.min, max: ranges.quickAdd.max }

  const TIME_STYLE_LABELS: Readonly<Record<settings.TimeStyle, () => string>> = {
    compact: m.settings_time_style_compact,
    fixed: m.settings_time_style_fixed,
  }
  const HOUR_CYCLE_LABELS: Readonly<Record<settings.HourCycle, () => string>> = {
    auto: m.settings_hour_cycle_auto,
    h12: m.settings_hour_cycle_h12,
    h23: m.settings_hour_cycle_h23,
  }
  const SOUND_LABELS: Readonly<Record<settings.SoundId, () => string>> = {
    chime: m.settings_sound_chime,
    bell: m.settings_sound_bell,
    beep: m.settings_sound_beep,
  }

  const timeStyleOptions = $derived(
    settings.TIME_STYLES.map((value) => ({ value, label: TIME_STYLE_LABELS[value]() })),
  )
  const hourCycleOptions = $derived(
    settings.HOUR_CYCLES.map((value) => ({ value, label: HOUR_CYCLE_LABELS[value]() })),
  )
  const soundOptions = $derived(
    settings.SOUND_IDS.map((value) => ({ value, label: SOUND_LABELS[value]() })),
  )
  const autoStopOptions = $derived(
    autoStopChoices(synced.autoStopMinutes).map((minutes) => ({
      value: String(minutes),
      label: autoStopLabel(minutes),
    })),
  )

  /** Bumped after asking, so the permission is read again. */
  let asked = $state(0)
  const permission = $derived.by((): NotificationPermissionState => {
    void asked
    return notifier.permission()
  })

  function setChip(index: 0 | 1 | 2, duration: Ms) {
    const quickAdd = [...synced.quickAdd] as [Ms, Ms, Ms]
    quickAdd[index] = duration
    settingsStore.updateSynced({ quickAdd })
  }

  async function setNotifications(on: boolean) {
    settingsStore.updateSynced({ notifications: on })
    if (!on) return
    // Inside the click: the browser only asks from a user gesture.
    await notifier.request()
    asked++
  }

  const CHIPS = [0, 1, 2] as const
</script>

<SectionHeader
  title={m.settings_section_behavior()}
  resetLabel={m.settings_reset()}
  resetName={m.settings_reset_section({ section: m.settings_section_behavior() })}
  onreset={() => {
    settingsStore.resetBehavior()
    announce(m.settings_reset_done({ section: m.settings_section_behavior() }))
  }}
/>

<SettingRow label={m.settings_time_style()} description={timeStyleDescription()}>
  {#snippet control(ids: ControlIds)}
    <SegmentedButtons
      aria-labelledby={ids.labelId}
      aria-describedby={ids.descriptionId}
      value={synced.timeStyle}
      options={timeStyleOptions}
      onchange={(timeStyle: settings.TimeStyle) => {
        settingsStore.updateSynced({ timeStyle })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_hour_cycle()} description={m.settings_hour_cycle_description()}>
  {#snippet control(ids: ControlIds)}
    <SegmentedButtons
      aria-labelledby={ids.labelId}
      aria-describedby={ids.descriptionId}
      value={synced.hourCycle}
      options={hourCycleOptions}
      onchange={(hourCycle: settings.HourCycle) => {
        settingsStore.updateSynced({ hourCycle })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow
  label={m.settings_quick_add()}
  description={m.settings_quick_add_description()}
  layout="block"
>
  {#snippet control(ids: ControlIds)}
    <div class="chips" role="group" aria-labelledby={ids.labelId}>
      {#each CHIPS as index (index)}
        <DurationField
          label={m.settings_quick_add_chip({ number: index + 1 })}
          value={synced.quickAdd[index]}
          range={quickAddRange}
          timeStyle={synced.timeStyle}
          aria-describedby={[ids.descriptionId, quickAddHintId].filter(Boolean).join(' ')}
          onchange={(duration: Ms) => {
            setChip(index, duration)
          }}
        />
      {/each}
    </div>
    <p class="hint" id={quickAddHintId}>{m.duration_hint()}</p>
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_sound()}>
  {#snippet control(ids: ControlIds)}
    <Select
      id={ids.id}
      value={synced.sound}
      options={soundOptions}
      onchange={(sound: settings.SoundId) => {
        settingsStore.updateSynced({ sound })
      }}
    />
    <Button
      variant="text"
      icon="play_arrow"
      label={m.settings_sound_preview()}
      onclick={() => {
        previewSound(synced.sound, synced.volume)
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_volume()}>
  {#snippet control(ids: ControlIds)}
    <Slider
      id={ids.id}
      min={ranges.volume.min}
      max={ranges.volume.max}
      step={ranges.volume.step}
      value={synced.volume}
      valueText={(volume: number) => percentText(volume, localeState.current)}
      onchange={(volume: number) => {
        // On release (or a key press), not on every step of a drag: each write is synced to
        // every tab (and in M4 every device) and saved.
        settingsStore.updateSynced({ volume })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_loop()} description={m.settings_loop_description()} layout="inline">
  {#snippet control(ids: ControlIds)}
    <Switch
      id={ids.id}
      aria-describedby={ids.descriptionId}
      checked={synced.loop}
      onchange={(loop: boolean) => {
        settingsStore.updateSynced({ loop })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_auto_stop()} description={m.settings_auto_stop_description()}>
  {#snippet control(ids: ControlIds)}
    <Select
      id={ids.id}
      aria-describedby={ids.descriptionId}
      value={String(synced.autoStopMinutes)}
      options={autoStopOptions}
      onchange={(minutes: string) => {
        settingsStore.updateSynced({ autoStopMinutes: Number(minutes) })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow
  label={m.settings_show_overtime()}
  description={m.settings_show_overtime_description()}
  layout="inline"
>
  {#snippet control(ids: ControlIds)}
    <Switch
      id={ids.id}
      aria-describedby={ids.descriptionId}
      checked={synced.showOvertime}
      onchange={(showOvertime: boolean) => {
        settingsStore.updateSynced({ showOvertime })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow
  label={m.settings_notifications()}
  description={synced.notifications && permission === 'denied'
    ? m.settings_notifications_blocked()
    : m.settings_notifications_description()}
  warning={synced.notifications && permission === 'denied'}
  layout="inline"
>
  {#snippet control(ids: ControlIds)}
    <Switch
      id={ids.id}
      aria-describedby={ids.descriptionId}
      checked={synced.notifications}
      onchange={(on: boolean) => {
        void setNotifications(on)
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow
  label={m.settings_confirm_delete()}
  description={m.settings_confirm_delete_description()}
  layout="inline"
>
  {#snippet control(ids: ControlIds)}
    <Switch
      id={ids.id}
      aria-describedby={ids.descriptionId}
      checked={synced.confirmDelete}
      onchange={(confirmDelete: boolean) => {
        settingsStore.updateSynced({ confirmDelete })
      }}
    />
  {/snippet}
</SettingRow>

<style>
  .chips {
    display: grid;
    flex: 1 1 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    padding-block-start: var(--space-2);
  }

  .hint {
    flex: 1 1 100%;
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  @container settings-panel (max-width: 16rem) {
    .chips {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>

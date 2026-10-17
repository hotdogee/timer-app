<!--
  @component
  Settings › Appearance (spec › Settings): theme, seed color, font, digit weight and size, ring
  thickness, card density and language. These are device settings: they stay on this device.
  Every change applies at once (the app themes itself from `settingsStore.device`); sliders and
  the color picker apply while they move. Reset restores every appearance default.

  ```svelte
  <AppearanceSection {settingsStore} />
  ```
-->
<script lang="ts">
  import { settings } from '../../core'
  import { LOCALES, LOCALE_NAMES, localeState, m } from '../../i18n'
  import type { SettingsStore } from '../../state/settings.svelte'
  import { announce } from '../announce.svelte'
  import Button from '../primitives/Button.svelte'
  import SegmentedButtons from '../primitives/SegmentedButtons.svelte'
  import Select from '../primitives/Select.svelte'
  import Slider from '../primitives/Slider.svelte'
  import { DEFAULT_SEED } from '../theme/seed'
  import SectionHeader from './SectionHeader.svelte'
  import SettingRow from './SettingRow.svelte'
  import type { ControlIds } from './types'
  import { percentText } from './values'

  interface Props {
    settingsStore: SettingsStore
  }

  let { settingsStore }: Props = $props()

  const device = $derived(settingsStore.device)
  const ranges = settings.SETTING_RANGES

  const THEME_LABELS: Readonly<Record<settings.ThemeMode, () => string>> = {
    system: m.settings_theme_mode_system,
    light: m.settings_theme_mode_light,
    dark: m.settings_theme_mode_dark,
  }
  const FONT_LABELS: Readonly<Record<settings.FontId, () => string>> = {
    'roboto-flex': m.settings_font_roboto_flex,
    inter: m.settings_font_inter,
    system: m.settings_font_system,
  }
  const DENSITY_LABELS: Readonly<Record<settings.Density, () => string>> = {
    comfortable: m.settings_density_comfortable,
    compact: m.settings_density_compact,
  }

  const themeOptions = $derived(
    settings.THEME_MODES.map((value) => ({ value, label: THEME_LABELS[value]() })),
  )
  const fontOptions = $derived(
    settings.FONT_IDS.map((value) => ({ value, label: FONT_LABELS[value]() })),
  )
  const densityOptions = $derived(
    settings.DENSITIES.map((value) => ({ value, label: DENSITY_LABELS[value]() })),
  )
  const languageOptions = $derived([
    { value: 'auto' as const, label: m.settings_language_auto() },
    ...LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value], lang: value })),
  ])

  const percent = (value: number) => percentText(value, localeState.current)

  /** The color the picker shows: the seed, or the default seed when none is set. */
  const seedColor = $derived(device.seed === '' ? DEFAULT_SEED.toLowerCase() : device.seed)

  let seedInput = $state<HTMLInputElement>()
  let pendingSeed: string | null = null
  let seedFrame = 0

  /** Applies a picked color at most once per frame while the picker is dragged. */
  function previewSeed(color: string) {
    pendingSeed = color
    if (seedFrame !== 0) return
    seedFrame = requestAnimationFrame(() => {
      seedFrame = 0
      if (pendingSeed !== null) settingsStore.updateDevice({ seed: pendingSeed })
      pendingSeed = null
    })
  }

  function commitSeed(color: string) {
    if (seedFrame !== 0) cancelAnimationFrame(seedFrame)
    seedFrame = 0
    pendingSeed = null
    settingsStore.updateDevice({ seed: color })
  }

  function defaultSeed() {
    settingsStore.updateDevice({ seed: '' })
    // The button goes away; keep focus on the color.
    seedInput?.focus()
  }

  $effect(() => () => {
    if (seedFrame !== 0) cancelAnimationFrame(seedFrame)
  })
</script>

<SectionHeader
  title={m.settings_section_appearance()}
  resetLabel={m.settings_reset()}
  resetName={m.settings_reset_section({ section: m.settings_section_appearance() })}
  onreset={() => {
    settingsStore.resetDevice()
    announce(m.settings_reset_done({ section: m.settings_section_appearance() }))
  }}
/>

<SettingRow label={m.settings_theme_mode()}>
  {#snippet control(ids: ControlIds)}
    <SegmentedButtons
      aria-labelledby={ids.labelId}
      value={device.themeMode}
      options={themeOptions}
      onchange={(themeMode: settings.ThemeMode) => {
        settingsStore.updateDevice({ themeMode })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_seed()} description={m.settings_seed_description()} layout="inline">
  {#snippet control(ids: ControlIds)}
    {#if device.seed !== ''}
      <Button variant="text" label={m.settings_seed_default()} onclick={defaultSeed} />
    {/if}
    <input
      bind:this={seedInput}
      class="seed"
      type="color"
      id={ids.id}
      value={seedColor}
      title={m.settings_seed_pick()}
      aria-describedby={ids.descriptionId}
      oninput={(event) => {
        previewSeed(event.currentTarget.value)
      }}
      onchange={(event) => {
        commitSeed(event.currentTarget.value)
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_font()}>
  {#snippet control(ids: ControlIds)}
    <Select
      id={ids.id}
      value={device.font}
      options={fontOptions}
      onchange={(font: settings.FontId) => {
        settingsStore.updateDevice({ font })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_font_weight()}>
  {#snippet control(ids: ControlIds)}
    <Slider
      id={ids.id}
      min={ranges.fontWeight.min}
      max={ranges.fontWeight.max}
      step={ranges.fontWeight.step}
      value={device.fontWeight}
      oninput={(fontWeight: number) => {
        settingsStore.updateDevice({ fontWeight })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_digit_scale()}>
  {#snippet control(ids: ControlIds)}
    <Slider
      id={ids.id}
      min={ranges.digitScale.min}
      max={ranges.digitScale.max}
      step={ranges.digitScale.step}
      value={device.digitScale}
      valueText={percent}
      oninput={(digitScale: number) => {
        settingsStore.updateDevice({ digitScale })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_ring_scale()}>
  {#snippet control(ids: ControlIds)}
    <Slider
      id={ids.id}
      min={ranges.ringScale.min}
      max={ranges.ringScale.max}
      step={ranges.ringScale.step}
      value={device.ringScale}
      valueText={percent}
      oninput={(ringScale: number) => {
        settingsStore.updateDevice({ ringScale })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_density()}>
  {#snippet control(ids: ControlIds)}
    <SegmentedButtons
      aria-labelledby={ids.labelId}
      value={device.density}
      options={densityOptions}
      onchange={(density: settings.Density) => {
        settingsStore.updateDevice({ density })
      }}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.settings_language()} description={m.settings_language_description()}>
  {#snippet control(ids: ControlIds)}
    <Select
      id={ids.id}
      aria-describedby={ids.descriptionId}
      value={device.locale}
      options={languageOptions}
      onchange={(locale: settings.Locale | 'auto') => {
        settingsStore.updateDevice({ locale })
      }}
    />
  {/snippet}
</SettingRow>

<style>
  /* The native color picker as a round swatch. */
  .seed {
    flex: none;
    inline-size: var(--touch-target, 44px);
    block-size: var(--touch-target, 44px);
    padding: 0;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .seed::-webkit-color-swatch-wrapper {
    padding: 0.25rem;
  }

  .seed::-webkit-color-swatch {
    border: none;
    border-radius: 50%;
  }

  .seed::-moz-color-swatch {
    border: none;
    border-radius: 50%;
  }
</style>

<!--
  @component
  Settings › Presets: what presets are for, how durations are typed, and the editor. Presets are
  the user's data rather than settings with defaults, so this section has no Reset.

  ```svelte
  <PresetsSection {presetStore} timeStyle={settingsStore.synced.timeStyle} />
  ```
-->
<script lang="ts">
  import type { TimeStyle } from '../../core'
  import { m } from '../../i18n'
  import type { PresetStore } from '../../state/presets.svelte'
  import PresetsEditor from './PresetsEditor.svelte'
  import SectionHeader from './SectionHeader.svelte'

  interface Props {
    presetStore: PresetStore
    timeStyle: TimeStyle
  }

  let { presetStore, timeStyle }: Props = $props()

  const uid = $props.id()
  const hintId = `${uid}-hint`
</script>

<SectionHeader title={m.settings_section_presets()} description={m.presets_description()} />
<p class="hint" id={hintId}>{m.duration_hint()}</p>
<PresetsEditor {presetStore} {timeStyle} {hintId} />

<style>
  .hint {
    margin: 0 0 var(--space-3);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }
</style>

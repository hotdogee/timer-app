<!--
  @component
  The action bar's "+ Timer" button and its menu: a default 5:00 timer and the presets (Tea 3:00,
  Pomodoro 25:00, …). Picking one adds that timer card and selects it. `open` is bindable so the
  Presets shortcut (P) can open the menu from the keyboard; the menu then focuses its first item.
-->
<script lang="ts">
  import { cards, formatCountdown } from '../../core'
  import { cardStore } from '../../state/cards.svelte'
  import { BUILTIN_PRESETS, findPreset } from '../../state/presets'
  import { Button, Icon, Menu, type MenuItem } from '../primitives'

  interface Props {
    /** Whether the menu is shown. Bindable. */
    open?: boolean
    /** Narrow screens: icon only. */
    compact?: boolean
  }

  let { open = $bindable(false), compact = false }: Props = $props()

  const MENU_ID = 'new-timer-menu'
  const DEFAULT_ITEM = 'default'
  const PRESET_PREFIX = 'preset:'

  const items: readonly MenuItem[] = [
    {
      id: DEFAULT_ITEM,
      label: cards.DEFAULT_NAMES.timer,
      hint: formatCountdown(cards.DEFAULT_TIMER_DURATION),
    },
    ...BUILTIN_PRESETS.map((preset) => ({
      id: PRESET_PREFIX + preset.id,
      label: preset.name,
      hint: formatCountdown(preset.duration),
    })),
  ]

  let trigger = $state<HTMLButtonElement>()

  function create(item: MenuItem): void {
    if (item.id === DEFAULT_ITEM) {
      cardStore.addTimer()
      return
    }
    const preset = findPreset(item.id.slice(PRESET_PREFIX.length))
    if (preset) cardStore.addTimer(preset.duration, preset.name)
  }
</script>

{#snippet compactIcon()}
  <span class="combo"><Icon name="add" /><Icon name="hourglass_top" /></span>
{/snippet}

<Button
  bind:element={trigger}
  variant="text"
  label={compact ? 'New timer' : 'Timer'}
  aria-label={compact ? undefined : 'New timer'}
  hideLabel={compact}
  icon={compact ? compactIcon : 'add'}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-controls={MENU_ID}
  onclick={() => {
    open = !open
  }}
/>
<Menu
  id={MENU_ID}
  bind:open
  anchor={trigger}
  {items}
  label="New timer"
  placement="above"
  align="end"
  onselect={create}
/>

<style>
  .combo {
    display: inline-flex;
    align-items: center;
    gap: 0.05em;
  }
</style>

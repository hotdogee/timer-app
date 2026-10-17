<!--
  @component
  A duration typed like a timer card (spec › Digit entry): focusing the field shows the duration as
  `HH:MM:SS` with everything selected, so typing replaces it; digits shift in from the right and
  Backspace removes the last one, and the field shows exactly what was typed (`00:00:90`). Enter
  or leaving the field commits it, with the overflow normalized (`90` seconds is 1:30), through
  `onchange`. A duration outside `range` is not committed: the field says which durations work and
  keeps what was typed. Esc puts back the saved duration (and only then lets the dialog close).
  Without focus the field shows the duration in the user's time style (`3:00`).

  ```svelte
  <DurationField label="Chip 1" value={30_000} range={{ min: 1000, max: 86_400_000 }}
    timeStyle="compact" onchange={(ms) => setChip(0, ms)} />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import type { DigitBuffer, Ms, TimeStyle } from '../../core'
  import { m } from '../../i18n'
  import TextField from '../primitives/TextField.svelte'
  import {
    bufferDuration,
    bufferFromDuration,
    bufferFromText,
    durationText,
    inRange,
    typedText,
    type DurationRange,
  } from './duration'

  interface Props {
    /** The saved duration. */
    value: Ms
    /** The durations the field accepts. */
    range: DurationRange
    /** How the saved duration reads while the field is not being edited. */
    timeStyle: TimeStyle
    /** The field's name, shown as its label unless `hideLabel`. */
    label: string
    hideLabel?: boolean
    'aria-describedby'?: string | undefined
    /** Runs with a new duration inside `range` when the user commits it. */
    onchange: (value: Ms) => void
    /** The rendered `<input>`. */
    element?: HTMLInputElement | undefined
    id?: string | undefined
    class?: string | undefined
  }

  let {
    value,
    range,
    timeStyle,
    label,
    hideLabel = false,
    'aria-describedby': describedBy,
    onchange,
    element = $bindable(),
    id,
    class: className,
  }: Props = $props()

  /** What is being typed, or `null` while the field just shows the saved duration. */
  let buffer = $state<DigitBuffer | null>(null)
  let error = $state<string | undefined>(undefined)

  const shown = $derived(buffer === null ? durationText(value, timeStyle) : typedText(buffer))

  /** Whether the field holds something other than the saved duration. */
  function pending(): boolean {
    return buffer !== null && buffer !== bufferFromDuration(value)
  }

  function rangeError(): string {
    return m.duration_range({
      min: durationText(range.min, timeStyle),
      max: durationText(range.max, timeStyle),
    })
  }

  /** Commits what was typed; false when it is outside the range (the error then shows). */
  function commit(): boolean {
    if (buffer === null || !pending()) {
      error = undefined
      return true
    }
    const duration = bufferDuration(buffer)
    if (!inRange(duration, range)) {
      error = rangeError()
      return false
    }
    error = undefined
    if (duration !== value) onchange(duration)
    return true
  }

  function handleFocus(event: FocusEvent & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget
    buffer ??= bufferFromDuration(value)
    // Select once the field shows HH:MM:SS, so the first digit typed replaces the duration.
    void tick().then(() => {
      if (document.activeElement === input) input.select()
    })
  }

  function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget
    buffer = bufferFromText(input.value)
    const text = typedText(buffer)
    // Write it back at once: what was typed is shown in the fixed HH:MM:SS shape.
    input.value = text
    input.setSelectionRange(text.length, text.length)
    error = undefined
  }

  function handleBlur() {
    if (commit()) buffer = null
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      // Show the committed duration normalized (00:00:90 becomes 00:01:30), still editing. Not
      // from `value`: a parent that passes an `{#each}` item's field updates it only on the next
      // flush, and leaving the field would then commit the old duration again.
      const typed = buffer === null ? value : bufferDuration(buffer)
      if (commit()) buffer = bufferFromDuration(typed)
    } else if (event.key === 'Escape' && (pending() || error !== undefined)) {
      // Put the saved duration back; the dialog stays open.
      event.preventDefault()
      event.stopPropagation()
      buffer = bufferFromDuration(value)
      error = undefined
    }
  }
</script>

<TextField
  bind:element
  class={['duration-field', { editing: buffer !== null }, className]}
  {id}
  {label}
  {hideLabel}
  value={shown}
  {error}
  aria-describedby={describedBy}
  inputmode="numeric"
  autocomplete="off"
  spellcheck={false}
  enterkeyhint="done"
  onfocus={handleFocus}
  oninput={handleInput}
  onblur={handleBlur}
  onkeydown={handleKeydown}
/>

<style>
  /* Typed digits show in the primary color, as on a card. */
  :global(.duration-field.editing input) {
    color: var(--md-sys-color-primary);
  }
</style>

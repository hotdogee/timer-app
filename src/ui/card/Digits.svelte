<!--
  @component
  The card's big time readout (`role="timer"`, never announced on its own: state changes go through
  the app's live region). Sized from the face's `--dial` length: 17% of the ring, times the digit
  size setting (`--digit-scale`), shrunk for long strings so `1:00:05.43` still fits inside the
  ring; drawn at the digit weight setting (`--digit-weight`). Digits stay left-to-right in RTL
  layouts.

  `tone="typing"` shows typed digits in the primary color; `underline` adds the editable-duration
  rule of an idle timer. `id` lets the card point `aria-describedby` at the readout (the text
  alone, not what `above` and `below` add).

  `above` and `below` draw extra rows over and under the text, such as an idle timer's steppers.
  They are rendered inside the readout, which is their containing block (position them
  absolutely, so the readout keeps its size) and gives them its font: text in them lines up with
  the digits. Without them the readout is the text alone.

  ```svelte
  <Digits text="5:00" underline />
  ```
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    text: string
    tone?: 'default' | 'typing'
    /** The 1px rule under an idle timer's duration (a hint that it can be typed over). */
    underline?: boolean
    id?: string | undefined
    /** A row over the text, positioned against the readout (an idle timer's ▲ steppers). */
    above?: Snippet | undefined
    /** A row under the text and its rule, positioned against the readout (the ▼ steppers). */
    below?: Snippet | undefined
  }

  let { text, tone = 'default', underline = false, id, above, below }: Props = $props()

  // A plain string, derived apart from `text`: the per-frame text update then rebuilds nothing else.
  const classes = $derived(underline ? `digits ${tone} underline` : `digits ${tone}`)
</script>

<span class={classes} style:--chars={text.length}
  >{@render above?.()}<span {id} class="text" role="timer" aria-live="off" aria-atomic="true"
    >{text}</span
  >{@render below?.()}</span
>

<style>
  .digits {
    position: relative;
    display: block;
    /*
     * 17% of the ring (--digit-ratio), at least 1.5rem, times the size setting; long strings
     * shrink to fit the ring whatever the setting.
     */
    font-size: min(
      calc(
        max(1.5rem, calc(var(--dial, 12rem) * var(--digit-ratio, 0.17))) * var(--digit-scale, 1)
      ),
      calc(var(--dial, 12rem) * 1.3 / var(--chars, 4))
    );
    font-family: var(--font-digits);
    font-weight: var(--digit-weight, 400);
    /*
     * Roboto Flex's optical size axis would pick a condensed, thin display cut at these sizes; the
     * reference digits are the text cut (opsz 14), wider with sturdier strokes. Fonts without the
     * axis (Inter) are unaffected.
     */
    font-optical-sizing: none;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    letter-spacing: 0;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface);
    direction: ltr;
    unicode-bidi: isolate;
  }

  .text {
    display: block;
  }

  .typing {
    color: var(--md-sys-color-primary);
  }

  .underline .text {
    padding-block-end: 0.22em;
    padding-inline: 0.33em;
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  @media (forced-colors: active) {
    .underline .text {
      border-color: CanvasText;
    }

    .typing {
      color: Highlight;
    }
  }
</style>

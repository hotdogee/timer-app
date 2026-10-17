<!--
  @component
  The card's big time readout (`role="timer"`, never announced on its own: state changes go through
  the app's live region). Sized from the face's `--dial` length: 17% of the ring, shrunk for long
  strings so `1:00:05.43` still fits inside the ring. Digits stay left-to-right in RTL layouts.

  `tone="typing"` shows typed digits in the primary color; `underline` adds the editable-duration
  rule of an idle timer. `id` lets the card point `aria-describedby` at the readout.

  ```svelte
  <Digits text="5:00" underline />
  ```
-->
<script lang="ts">
  interface Props {
    text: string
    tone?: 'default' | 'typing'
    /** The 1px rule under an idle timer's duration (a hint that it can be typed over). */
    underline?: boolean
    id?: string | undefined
  }

  let { text, tone = 'default', underline = false, id }: Props = $props()

  // A plain string, derived apart from `text`: the per-frame text update then rebuilds nothing else.
  const classes = $derived(underline ? `digits ${tone} underline` : `digits ${tone}`)
</script>

<span
  {id}
  class={classes}
  role="timer"
  aria-live="off"
  aria-atomic="true"
  style:--chars={text.length}>{text}</span
>

<style>
  .digits {
    display: block;
    /* 17% of the ring (--digit-ratio), at least 1.5rem; long strings shrink to fit the ring. */
    font-size: min(
      max(1.5rem, calc(var(--dial, 12rem) * var(--digit-ratio, 0.17))),
      calc(var(--dial, 12rem) * 1.3 / var(--chars, 4))
    );
    font-family: var(--font-digits);
    font-weight: 400;
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

  .typing {
    color: var(--md-sys-color-primary);
  }

  .underline {
    padding-block-end: 0.22em;
    padding-inline: 0.33em;
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  @media (forced-colors: active) {
    .underline {
      border-color: CanvasText;
    }

    .typing {
      color: Highlight;
    }
  }
</style>

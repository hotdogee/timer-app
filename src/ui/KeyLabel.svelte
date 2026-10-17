<!--
  @component
  A key combo's label inside a key cap (`<kbd>`): the text as it is, with the arrow keys drawn as
  icons so all four have one size (see `key-label.ts`). Screen readers and text searches still
  get the arrow characters.

  ```svelte
  <kbd><KeyLabel label="Ctrl+↑" /></kbd>
  ```
-->
<script lang="ts">
  import Icon from './primitives/Icon.svelte'
  import { keyLabelParts } from './key-label'

  interface Props {
    /** The display label, as `keymap.formatCombo` gives it. */
    label: string
  }

  let { label }: Props = $props()

  const parts = $derived(keyLabelParts(label))
</script>

<!-- A flex row, so the template's whitespace between parts never shows. -->
<span class="key-label">
  {#each parts as part, index (index)}
    {#if part.arrow}
      <span class="arrow"
        ><Icon name={part.arrow} /><span class="visually-hidden">{part.text}</span></span
      >
    {:else}
      <span>{part.text}</span>
    {/if}
  {/each}
</span>

<style>
  .key-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: bottom;
  }

  .arrow {
    display: inline-flex;
    font-size: 1.15em;
  }
</style>

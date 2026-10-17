<!--
  @component
  What the grid shows with no cards: a short line and buttons for a new timer or stopwatch. When
  it replaces the grid under the keyboard (the last card was deleted), focus would fall to the
  page; it goes to "New timer" instead.
-->
<script lang="ts">
  import { m } from '../../i18n'
  import { cardStore } from '../../state/cards.svelte'
  import { Button, Icon } from '../primitives'

  let newTimer = $state<HTMLButtonElement>()

  $effect(() => {
    const active = document.activeElement
    if (active === null || active === document.body) newTimer?.focus()
  })
</script>

<section class="empty" aria-labelledby="empty-title" data-empty-state>
  <span class="art"><Icon name="hourglass_top" /></span>
  <h2 id="empty-title" class="title">{m.empty_title()}</h2>
  <p class="hint">{m.empty_hint()}</p>
  <div class="actions">
    <Button
      bind:element={newTimer}
      label={m.empty_new_timer()}
      icon="add"
      onclick={() => {
        cardStore.addTimer()
      }}
    />
    <Button
      variant="tonal"
      label={m.empty_new_stopwatch()}
      icon="add"
      onclick={() => {
        cardStore.addStopwatch()
      }}
    />
  </div>
</section>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3, 0.75rem);
    max-inline-size: 28rem;
    margin-inline: auto;
    padding-block: min(20vh, 10rem) var(--space-6, 2rem);
    text-align: center;
  }

  .art {
    display: inline-flex;
    font-size: 3rem;
    color: var(--md-sys-color-primary);
  }

  .title {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 500;
  }

  .hint {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2, 0.5rem);
    margin-block-start: var(--space-3, 0.75rem);
  }
</style>

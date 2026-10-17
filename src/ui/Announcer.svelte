<!--
  @component
  The app's polite live region (spec › Accessibility): call `announce(text)` from
  `announce.svelte.ts` anywhere to have screen readers speak `text`. The app renders it once; a
  modal dialog and a natively fullscreen card, which make the rest of the page inert, render a
  copy inside themselves. Only the copy outside the inert part of the page is exposed, so a
  message is spoken once.

  ```svelte
  <script>
    import Announcer from './ui/Announcer.svelte'
    import { announce } from './ui/announce.svelte'
    announce('Tea started')
  </script>
  <Announcer />
  ```
-->
<script lang="ts">
  import { currentAnnouncement } from './announce.svelte'
</script>

<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
  {currentAnnouncement()}
</div>

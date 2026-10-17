<!--
  @component
  An icon for the settings dialog: any name of the app's icon set or of the settings set
  (`icons.ts`), drawn like `Icon` (1em, `currentColor`, decorative).

  ```svelte
  <Glyph name="palette" />
  ```
-->
<script lang="ts">
  import { ICON_VIEW_BOX } from '../primitives/icons'
  import { glyphPath, type GlyphName } from './icons'

  interface Props {
    name: GlyphName
  }

  let { name }: Props = $props()
</script>

<svg
  class="glyph"
  viewBox={ICON_VIEW_BOX}
  width="1em"
  height="1em"
  fill="currentColor"
  focusable="false"
  aria-hidden="true"
>
  <path d={glyphPath(name)} />
</svg>

<style>
  .glyph {
    display: inline-block;
    flex: none;
    inline-size: 1em;
    block-size: 1em;
    vertical-align: -0.125em;
  }
</style>

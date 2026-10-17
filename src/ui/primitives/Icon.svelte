<!--
  @component
  A Material Symbol, sized to the surrounding text (1em) and drawn in `currentColor`.
  Decorative (`aria-hidden`) unless `label` is given, in which case it is an image with that name.

  ```svelte
  <Icon name="pause" />
  <Icon name="notifications" label="Alarm" />
  ```
-->
<script lang="ts">
  import { ICON_VIEW_BOX, iconPath, type IconName } from './icons'

  interface Props {
    /** Which icon to draw. */
    name: IconName
    /** Accessible name. Leave it out when the icon sits next to text that already says it. */
    label?: string
  }

  let { name, label }: Props = $props()

  /** An empty label counts as none: the icon is then decorative. */
  const accessibleName = $derived(label === '' ? undefined : label)
</script>

<svg
  class="icon"
  viewBox={ICON_VIEW_BOX}
  width="1em"
  height="1em"
  fill="currentColor"
  focusable="false"
  aria-hidden={accessibleName ? undefined : 'true'}
  role={accessibleName ? 'img' : undefined}
  aria-label={accessibleName}
>
  <path d={iconPath(name)} />
</svg>

<style>
  .icon {
    display: inline-block;
    flex: none;
    inline-size: 1em;
    block-size: 1em;
    vertical-align: -0.125em;
  }
</style>

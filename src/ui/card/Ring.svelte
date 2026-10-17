<!--
  @component
  The card's progress ring: a track circle, an optional arc for a timer's elapsed fraction (growing
  clockwise from 12 o'clock) and an optional dot for a stopwatch (one turn per minute). Decorative:
  the digits carry the information.

  Sized by the face's `--dial` length. The arc moves every frame without a transition; only a
  backward jump (Restart, a chip extending a running timer) animates. `pulse` fades the ring in and
  out gently for time's up, except with reduced motion.

  ```svelte
  <Ring progress={0.25} />
  <Ring dot={0.5} />
  ```
-->
<script lang="ts">
  import { isRewind } from './display'

  interface Props {
    /** Elapsed fraction, 0 to 1, drawn as an arc. Leave it out for no arc. */
    progress?: number | undefined
    /** The dot's position: a fraction of a turn clockwise from 12 o'clock. Leave it out for no dot. */
    dot?: number | undefined
    /** Pulse gently (time's up). */
    pulse?: boolean
  }

  let { progress, dot, pulse = false }: Props = $props()

  // Booleans for the {#if} blocks: they change only when the arc or dot comes or goes, so the
  // per-frame `progress` and `dot` updates do not re-run the blocks.
  const hasArc = $derived(progress !== undefined)
  const hasDot = $derived(dot !== undefined)

  /** How long the arc animates a backward jump; matches --duration-medium. */
  const REWIND_MS = 300

  let rewinding = $state(false)
  let shown = 0
  let timeout: ReturnType<typeof setTimeout> | undefined

  // Backward jumps animate; the class stays on for the whole transition, because removing it
  // early would cancel the transition midway. (This runs every frame, so no per-run cleanup.)
  $effect.pre(() => {
    const next = progress ?? 0
    const jumped = isRewind(shown, next)
    shown = next
    if (!jumped) return
    rewinding = true
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      rewinding = false
    }, REWIND_MS)
  })

  $effect(() => () => {
    clearTimeout(timeout)
  })
</script>

<svg class={pulse ? 'ring pulse' : 'ring'} aria-hidden="true" focusable="false">
  <circle class="track" cx="50%" cy="50%" />
  {#if hasArc}
    <circle
      class={rewinding ? 'arc rewinding' : 'arc'}
      cx="50%"
      cy="50%"
      pathLength="1"
      stroke-dasharray="1 1"
      stroke-dashoffset={1 - (progress ?? 0)}
    />
  {/if}
  {#if hasDot}
    <g class="dot" style:transform="rotate({dot ?? 0}turn)">
      <circle class="knob" cx="50%" />
    </g>
  {/if}
</svg>

<style>
  .ring {
    /* The stroke is 2.5% of the ring (7px on a 660px card, as in the reference), never under 4px. */
    --stroke: max(4px, calc(var(--dial, 12rem) * 0.025));
    display: block;
    inline-size: var(--dial, 12rem);
    block-size: var(--dial, 12rem);
    overflow: visible;
  }

  circle {
    fill: none;
    stroke-width: var(--stroke);
    r: calc(50% - var(--stroke) / 2);
  }

  .track {
    stroke: var(--card-tonal, var(--md-sys-color-surface-container-highest));
  }

  .arc {
    stroke: var(--md-sys-color-primary);
    stroke-linecap: butt;
    /* SVG circles start at 3 o'clock and run clockwise; turn the start to 12 o'clock. */
    transform: rotate(-90deg);
    transform-origin: 50% 50%;
    transform-box: view-box;
  }

  .arc.rewinding {
    transition: stroke-dashoffset var(--duration-medium, 300ms) var(--easing-standard, ease);
  }

  .dot {
    transform-origin: 50% 50%;
    transform-box: view-box;
  }

  .knob {
    cy: calc(var(--stroke) / 2);
    r: calc(var(--stroke) * 1.5);
    fill: var(--md-sys-color-primary);
    stroke: none;
  }

  .pulse {
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }

  @media (forced-colors: active) {
    .ring {
      forced-color-adjust: none;
    }

    /* A thin track in the text color: the arc stands out by weight, not only by hue. */
    .track {
      stroke: CanvasText;
      stroke-width: calc(var(--stroke) / 3);
    }

    .arc {
      stroke: Highlight;
    }

    .knob {
      fill: Highlight;
    }
  }
</style>

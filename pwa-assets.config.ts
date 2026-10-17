/**
 * Generates the PWA icons and the favicon from `public/icon.svg` (`pnpm icons`). The PNGs and
 * `favicon.ico` are committed; run it again after changing the drawing. `public/favicon.svg` is a
 * copy of the same drawing.
 *
 * The maskable and Apple icons are full bleed: no padding, and the drawing's transparent corners are
 * filled with its own blue, so the launcher's mask (a circle, squircle or rounded square) cuts a
 * plain blue shape. The ring and dot stay inside the maskable safe zone (the centered circle of 80%
 * of the width), so no mask clips them.
 */
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/** The icon's background, `fill` of the rounded square in public/icon.svg. */
const ICON_BLUE = '#0b57d0'

export default defineConfig({
  headLinkOptions: {
    preset: '2023',
    // index.html links the copy, public/favicon.svg.
    resolveSvgName: () => 'favicon.svg',
  },
  preset: {
    ...minimal2023Preset,
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0,
      resizeOptions: { fit: 'contain', background: ICON_BLUE },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0,
      resizeOptions: { fit: 'contain', background: ICON_BLUE },
    },
  },
  images: ['public/icon.svg'],
})

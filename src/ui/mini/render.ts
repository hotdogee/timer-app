/**
 * The web mini window's card: what the Picture-in-Picture window (`platform.windows` on the web)
 * draws, through the platform's `render` callback, since the platform layer cannot import
 * components. It mounts {@link MiniCard} into the window's document, against the app's own state,
 * with that window's frames and keys; the window's own close button and the card's close the
 * window. The desktop window draws its own page instead (`page.ts`).
 */
import { mount, unmount } from 'svelte'

import { platform, type MiniWindowRender } from '../../platform'
import MiniCard from './MiniCard.svelte'

/** Draws card `cardId` into `target` (in the Picture-in-Picture window); returns the cleanup. */
export const renderMiniCard: MiniWindowRender = (target, cardId) => {
  const view = target.ownerDocument.defaultView ?? window
  const card = mount(MiniCard, {
    target,
    props: {
      cardId,
      view,
      onclose: () => {
        void platform.windows.close()
      },
    },
  })
  return () => {
    void unmount(card)
  }
}

/**
 * Keeps every open tab's synced store in step over a `BroadcastChannel` (spec › Persistence and
 * instances): a timer started in one tab runs in all of them within milliseconds. The merge is
 * TinyBase's (per cell, newest wins), so tabs converge whatever order changes arrive in.
 *
 * The synchronizer is TinyBase's own protocol (`createCustomSynchronizer`) over the same message
 * envelope as its `createBroadcastChannelSynchronizer`, but with a longer request timeout. The
 * stock one gives a peer 10 ms to answer each request; a tab that is busy (starting up, mounting,
 * animating many cards) can take longer, and a new tab whose first exchange times out never gets
 * the content the others already had. Changes still flow at once in both directions; only a lone
 * tab's first exchange waits for the timeout before it gives up.
 *
 * This is one {@link Connection} among the ones the app opens on the synced store; M4 adds a
 * WebSocket connection to the sync server beside it. Neither the state modules nor the card
 * bridge know about connections: changes from any of them land in the store and reach the app
 * through the store's listeners, like a change from another tab does.
 */
import { getUniqueId, type Id, type IdOrNull } from 'tinybase/with-schemas'
import {
  createCustomSynchronizer,
  type Message,
  type Synchronizer,
} from 'tinybase/synchronizers/with-schemas'

import type { SyncedSchemas } from './schema'
import type { SyncedStore } from './stores'

/** The channel every tab of the app joins. */
export const TAB_CHANNEL = 'timer-app'

/** How long a tab waits for another tab to answer one request of the sync protocol. */
export const TAB_REQUEST_TIMEOUT_SECONDS = 0.5

/** A running exchange of changes between the synced store and its peers. */
export interface Connection {
  /**
   * Settles once the first exchange is done: content fetched from a peer that answered, or the
   * request timeout passed when none did (a lone tab). Never rejects. Nothing needs to wait for
   * it: changes flow both ways from the start.
   */
  readonly ready: Promise<void>
  /** Stops exchanging changes and closes the channel. */
  stop(): Promise<void>
}

/** A connection that does nothing, for hosts without the channel. */
const NO_CONNECTION: Connection = Object.freeze({
  ready: Promise.resolve(),
  stop: () => Promise.resolve(),
})

/** The message envelope of TinyBase's BroadcastChannel synchronizer. */
type Envelope = [from: Id, to: IdOrNull, requestId: IdOrNull, message: Message, body: unknown]

function isEnvelope(data: unknown): data is Envelope {
  return (
    Array.isArray(data) &&
    data.length === 5 &&
    typeof data[0] === 'string' &&
    (data[1] === null || typeof data[1] === 'string')
  )
}

/** A synchronizer over a BroadcastChannel, and a way to give up its pending requests. */
interface TabSynchronizer {
  readonly synchronizer: Synchronizer<SyncedSchemas>
  /** Fails every request still waiting for an answer, so nothing waits for its timeout. */
  readonly abort: () => void
}

/** A synchronizer for `store` over BroadcastChannel `name`. */
function createTabSynchronizer(
  store: SyncedStore,
  name: string,
  timeoutSeconds: number,
): TabSynchronizer {
  const clientId = getUniqueId()
  const channel = new BroadcastChannel(name)
  let fail: ((error: Error) => void) | undefined
  const synchronizer = createCustomSynchronizer(
    store,
    (to, requestId, message, body: unknown) => {
      const envelope: Envelope = [clientId, to, requestId, message, body]
      channel.postMessage(envelope)
    },
    (receive, failRequests) => {
      fail = failRequests
      channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        // Malformed requests and bodies are TinyBase's to reject; only the envelope is checked.
        if (!isEnvelope(data)) return
        const [from, to, requestId, message, body] = data
        if (from !== clientId && (to === null || to === clientId)) {
          receive(from, requestId, message, body)
        }
      }
    },
    () => {
      channel.onmessage = null
      channel.close()
    },
    timeoutSeconds,
  )
  return {
    synchronizer,
    abort: () => {
      fail?.(new Error('Timer App: tab sync stopped'))
    },
  }
}

/**
 * Joins `channel` (the app's by default) and exchanges changes with the other tabs on it until
 * stopped. Without `BroadcastChannel` (no other tab can exist then), or when the channel cannot be
 * opened, it returns a connection that does nothing. A request no tab answers within `timeoutSeconds` is given up silently: that is
 * what a lone tab's first exchange does.
 */
export function startTabSync(
  store: SyncedStore,
  channel: string = TAB_CHANNEL,
  timeoutSeconds: number = TAB_REQUEST_TIMEOUT_SECONDS,
): Connection {
  if (typeof BroadcastChannel === 'undefined') return NO_CONNECTION
  let tab: TabSynchronizer
  try {
    tab = createTabSynchronizer(store, channel, timeoutSeconds)
  } catch (error) {
    // Some sandboxed origins refuse to open a channel; this tab then runs on its own.
    console.warn('Timer App: could not sync with other tabs', error)
    return NO_CONNECTION
  }
  const { synchronizer, abort } = tab
  const started = synchronizer.startSync().then(
    () => undefined,
    (error: unknown) => {
      console.warn('Timer App: could not sync with other tabs', error)
    },
  )
  return {
    ready: started,
    async stop() {
      // Destroying waits for the request in flight; failing it first ends that wait at once.
      abort()
      await synchronizer.destroy()
      await started
    },
  }
}

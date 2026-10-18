/**
 * The merge stamps (TinyBase HLCs) of the synced store, for the one write that must not simply be
 * stamped "now": a timer reaching its end.
 *
 * A running timer turns to ringing on every device by itself, when the time comes (the card store
 * settles it). Stamped now, a device that was closed while the timer ended would write that
 * ringing when it opens, newer than the dismiss, pause or reset another device made meanwhile, and
 * per-field last-writer-wins would bring the alarm back everywhere. So the card bridge writes a
 * settle with {@link nextStamp} of the running state it follows from: it beats that state and
 * loses to anything done after it, and every device derives the same stamp, so their settles agree.
 *
 * The store is small (a few dozen rows), so reading its stamps through `getMergeableContent()` on
 * these rare writes is cheap.
 */
import { getHlcFunctions, type Hlc } from 'tinybase/with-schemas'

import type { SyncedStore } from './stores'

const [, , encodeHlc, decodeHlc] = getHlcFunctions()

/** A stamp as `getMergeableContent()` holds it: `[thing, hlc, hash]`. */
type Stamped<Thing> = readonly [thing: Thing, hlc: Hlc, hash?: number]

/** The tables of a mergeable content, loosely typed (the schema's types do not matter here). */
type TablesStamp = Stamped<
  Record<string, Stamped<Record<string, Stamped<Record<string, Stamped<unknown>>>>>>
>

/** A cell value to write, or `null` to delete the cell. */
export type StampedCell = string | number | boolean | null

/** The stamps of the cells of row `rowId` in `tableId`, by cell id (deleted cells included). */
export function cellStamps(
  store: SyncedStore,
  tableId: string,
  rowId: string,
): ReadonlyMap<string, Hlc> {
  const [tables] = store.getMergeableContent() as unknown as [TablesStamp]
  const cells = tables[0][tableId]?.[0][rowId]?.[0] ?? {}
  return new Map(Object.entries(cells).map(([cellId, [, hlc]]) => [cellId, hlc]))
}

/** The newest stamp of any cell or value in `store` (deletions included), or '' when none. */
export function newestStamp(store: SyncedStore): Hlc {
  const [tables, values] = store.getMergeableContent() as unknown as [
    TablesStamp,
    Stamped<Record<string, Stamped<unknown>>>,
  ]
  let newest = ''
  for (const [rows] of Object.values(tables[0])) {
    for (const [cells] of Object.values(rows)) {
      for (const [, hlc] of Object.values(cells)) if (hlc > newest) newest = hlc
    }
  }
  for (const [, hlc] of Object.values(values[0])) if (hlc > newest) newest = hlc
  return newest
}

/** The newest of `stamps` (HLCs sort as strings), or '' when there are none. */
export function latestStamp(stamps: Iterable<Hlc>): Hlc {
  let latest = ''
  for (const hlc of stamps) if (hlc > latest) latest = hlc
  return latest
}

/** The logical time (epoch ms) of a stamp; 0 for the empty stamp. */
export function stampTime(hlc: Hlc): number {
  return hlc === '' ? 0 : decodeHlc(hlc)[0]
}

/**
 * The stamp right after `hlc`: the same time and client, the next counter. Deterministic, so two
 * devices that hold the same stamp derive the same next one. After the empty stamp: time 0.
 */
export function nextStamp(hlc: Hlc): Hlc {
  if (hlc === '') return encodeHlc(0, 1)
  const [time, counter] = decodeHlc(hlc)
  const next = counter + 1 < 2 ** 24 ? encodeHlc(time, counter + 1) : encodeHlc(time + 1, 0)
  // Time and counter are the first 11 characters; the rest names the client.
  return next.slice(0, 11) + hlc.slice(11)
}

/**
 * Writes `cells` of a row with the stamp `hlc` instead of the store's clock. Cells whose stamp is
 * already newer keep their value, as in any merge. The write is saved and synced like any change.
 */
export function writeStamped(
  store: SyncedStore,
  tableId: string,
  rowId: string,
  cells: Readonly<Record<string, StampedCell>>,
  hlc: Hlc,
): void {
  const stamped = Object.fromEntries(
    Object.entries(cells).map(([cellId, value]) => [cellId, [value ?? undefined, hlc]]),
  )
  const changes = [[{ [tableId]: [{ [rowId]: [stamped] }] }], [{}], 1]
  store.applyMergeableChanges(
    changes as unknown as Parameters<SyncedStore['applyMergeableChanges']>[0],
  )
}

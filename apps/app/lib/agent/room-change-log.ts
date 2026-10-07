import * as Y from "yjs"
import { createCanvasOps } from "@/lib/canvas/ops"
import { COLLECTION_KEYS, createRoomCollections } from "@/lib/yjs/schema"
import type { LayerFileData } from "@/lib/types"

/**
 * The Room Target chat's change log (the Coordinator's undo, #894). Every
 * canvas change a Room Target turn makes runs through {@link recordChange},
 * which keeps, per turn, each touched record as it was before the turn's
 * first change to it: the full record of anything removed, `null` for
 * anything created. {@link undoTurn} puts those records back, so a removed
 * frame, Group or document returns exactly as it was.
 *
 * The log lives in the Room doc under {@link CHANGE_LOG_KEY} so it survives
 * between turns and server instances. It is written by server-side room
 * mutations only, so a member's own ⌘Z (which tracks their local Canvas
 * Operations) never undoes it. There is no trash or history UI.
 */
export const CHANGE_LOG_KEY = "roomChanges"

/** Turns kept; older ones are dropped and can no longer be undone. */
export const MAX_LOGGED_TURNS = 20

/**
 * The collections a canvas arrangement can touch: frames, Groups, documents,
 * mockups, the document chats removed or created with them, and pages with
 * each member's view of them (#1843; a deleted page takes its Layers and
 * views along). Branches aren't tracked: arranging never removes a
 * Workspace, and undo must never rewind a Workspace's live status.
 */
const TRACKED = [
  COLLECTION_KEYS.iframeLayers,
  COLLECTION_KEYS.iframeLayerGroups,
  COLLECTION_KEYS.markdownLayers,
  COLLECTION_KEYS.mockupLayers,
  // The files those views show (#1883): titles and a Mockup's page state.
  COLLECTION_KEYS.layerFiles,
  COLLECTION_KEYS.chatSessions,
  COLLECTION_KEYS.pages,
  COLLECTION_KEYS.pageViews,
] as const
type TrackedKey = (typeof TRACKED)[number]

type RecordJson = Record<string, unknown>

export type RecordChange = {
  collection: TrackedKey
  id: string
  /** The record before the turn first changed it; `null` if the turn created it. */
  before: RecordJson | null
}

export type TurnChanges = {
  turnId: string
  /** Order the turn first changed the canvas in, across the log. */
  seq: number
  at: number
  /** One line per change, in the order they were made. */
  actions: string[]
  changes: RecordChange[]
  /** The turn that undid this one, once undone. */
  undoneBy?: string
}

type Snapshot = Record<TrackedKey, Record<string, RecordJson>>

function snapshot(doc: Y.Doc): Snapshot {
  const out = {} as Snapshot
  for (const key of TRACKED) {
    out[key] = doc.getMap(key).toJSON() as Record<string, RecordJson>
  }
  return out
}

function logMap(doc: Y.Doc): Y.Map<TurnChanges> {
  return doc.getMap<TurnChanges>(CHANGE_LOG_KEY)
}

/** Logged turns, newest first. */
export function listTurns(doc: Y.Doc): TurnChanges[] {
  return [...logMap(doc).values()].sort((a, b) => b.seq - a.seq)
}

/**
 * Run `change` (a write to `doc`, returning one line that describes it) and
 * log what it changed under `turnId`. A change that alters nothing logs
 * nothing. Returns the description.
 */
export function recordChange(
  doc: Y.Doc,
  turnId: string,
  change: () => string
): string {
  const before = snapshot(doc)
  const action = change()
  const after = snapshot(doc)

  const log = logMap(doc)
  const entry: TurnChanges = log.get(turnId) ?? {
    turnId,
    seq: (listTurns(doc)[0]?.seq ?? 0) + 1,
    at: Date.now(),
    actions: [],
    changes: [],
  }
  const seen = new Set(entry.changes.map((c) => `${c.collection}/${c.id}`))
  const changes: RecordChange[] = []
  for (const key of TRACKED) {
    const ids = new Set([
      ...Object.keys(before[key]),
      ...Object.keys(after[key]),
    ])
    for (const id of ids) {
      const was = before[key][id] ?? null
      const now = after[key][id] ?? null
      if (canonical(was) === canonical(now)) continue
      // Keep the earliest state: undo restores the canvas as the turn found it.
      if (seen.has(`${key}/${id}`)) continue
      changes.push({ collection: key, id, before: was })
    }
  }
  if (changes.length === 0) return action

  doc.transact(() => {
    log.set(turnId, {
      ...entry,
      // The first line names the change; any lines after it are ids.
      actions: [...entry.actions, action.split("\n")[0]!],
      changes: [...entry.changes, ...changes],
    })
    const turns = listTurns(doc)
    for (const old of turns.slice(MAX_LOGGED_TURNS)) log.delete(old.turnId)
  })
  return action
}

/**
 * Put back every record `turnId` changed, as it was before that turn. Run it
 * through {@link recordChange} under the current turn so an undo can itself be
 * undone. Returns the undone turn's actions, or an error message.
 */
export function undoTurn(
  doc: Y.Doc,
  turnId: string,
  undoneBy: string
): { ok: true; actions: string[] } | { ok: false; error: string } {
  const log = logMap(doc)
  const entry = log.get(turnId)
  if (!entry)
    return { ok: false, error: `No logged changes for turn ${turnId}.` }
  if (entry.undoneBy) {
    return { ok: false, error: `Turn ${turnId} was already undone.` }
  }

  const renames: { id: string; title: string }[] = []
  doc.transact(() => {
    // Records go back as they were stored: a view and its file separately
    // (#1883), so putting back one never rewrites the other.
    for (const { collection, id, before } of entry.changes) {
      const map = doc.getMap<Y.Map<unknown>>(collection)
      if (before === null) {
        map.delete(id)
        continue
      }
      if (collection === COLLECTION_KEYS.layerFiles) {
        const current = map.get(id)?.toJSON() as LayerFileData | undefined
        const was = before as LayerFileData
        if (was.kind === "document" && current && current.title !== was.title)
          renames.push({ id, title: was.title })
      }
      writeRecord(map, id, before)
    }
  })
  // A document's title also lives in its body's heading; a removed document's
  // body was never deleted, so only a rename needs the heading put back.
  const ops = createCanvasOps(createRoomCollections(doc))
  for (const { id, title } of renames) ops.renameDocument(id, title)

  doc.transact(() => {
    const latest = log.get(turnId)
    if (latest) log.set(turnId, { ...latest, undoneBy })
  })
  return { ok: true, actions: entry.actions }
}

/** Replaces one stored record with `value`'s fields. */
function writeRecord(
  map: Y.Map<Y.Map<unknown>>,
  id: string,
  value: RecordJson
) {
  let inner = map.get(id)
  if (!inner) {
    inner = new Y.Map()
    map.set(id, inner)
  }
  const stale = new Set(inner.keys())
  for (const [k, v] of Object.entries(value)) {
    inner.set(k, v)
    stale.delete(k)
  }
  for (const k of stale) inner.delete(k)
}

/** JSON with sorted keys, so two equal records compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as RecordJson).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : v
  )
}

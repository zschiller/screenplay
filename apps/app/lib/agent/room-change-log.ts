import type * as Y from "yjs"
import { createCanvasOps } from "@/lib/canvas/ops"
import { COLLECTION_KEYS, createRoomCollections } from "@/lib/yjs/schema"
import type { MarkdownLayerData } from "@/lib/types"

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
 * The collections a canvas arrangement can touch: frames, Groups, documents
 * and the document chats removed or created with them. Branches aren't
 * tracked: arranging never removes a Workspace, and undo must never rewind a
 * Workspace's live status.
 */
const TRACKED = [
  COLLECTION_KEYS.iframeLayers,
  COLLECTION_KEYS.iframeLayerGroups,
  COLLECTION_KEYS.markdownLayers,
  COLLECTION_KEYS.chatSessions,
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
      actions: [...entry.actions, action],
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

  const collections = createRoomCollections(doc)
  const renames: { id: string; title: string }[] = []
  doc.transact(() => {
    for (const { collection, id, before } of entry.changes) {
      const map = collections[collection]
      if (before === null) {
        map.delete(id)
        continue
      }
      if (collection === COLLECTION_KEYS.markdownLayers) {
        const current = map.get(id) as MarkdownLayerData | undefined
        const title = (before as MarkdownLayerData).title
        if (current && current.title !== title) renames.push({ id, title })
      }
      ;(map as { set(id: string, value: RecordJson): void }).set(id, before)
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

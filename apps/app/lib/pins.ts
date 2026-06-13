import "server-only"

import { and, asc, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { appendPosition } from "@/lib/pin-order"

// Server-only CRUD over the `pin` table, mirroring `lib/folders`. Pins are
// per-user (PRD #507): every query is scoped by `userId`, so one user's pins are
// invisible to another — pinning a shared Room never touches a collaborator's
// sidebar. The `pin` table lives in the core schema half, so this works
// unchanged on the local PGlite (desktop) build, where the single seeded local
// user owns every pin.

export type PinKind = "room" | "folder"

// A pin resolved to its polymorphic target. The DB stores the target as one of
// two nullable FK columns under an exactly-one CHECK; this collapses that into a
// `kind` + `targetId` pair so callers never juggle the two columns.
export type PinRecord = {
  id: string
  userId: string
  kind: PinKind
  targetId: string
  position: number
  createdAt: number
}

function toPin(row: typeof schema.pin.$inferSelect): PinRecord {
  // The CHECK constraint guarantees exactly one target column is set, so this
  // branch is total — a row always resolves to one kind.
  const kind: PinKind = row.roomId !== null ? "room" : "folder"
  const targetId = row.roomId ?? row.folderId
  if (targetId === null) throw new Error("Pin row has no target")
  return {
    id: row.id,
    userId: row.userId,
    kind,
    targetId,
    position: row.position,
    createdAt: row.createdAt.getTime(),
  }
}

// Every pin the user owns, ordered by their dense `position` so the sidebar
// renders them in pin order. The pure layer (`lib/pin-order`) owns re-packing;
// persistence stays a flat owner-scoped fetch.
export async function listPinsForUser(userId: string): Promise<PinRecord[]> {
  const rows = await db
    .select()
    .from(schema.pin)
    .where(eq(schema.pin.userId, userId))
    .orderBy(asc(schema.pin.position))
  return rows.map(toPin)
}

// Pin a Room to the end of the user's list. Idempotent: re-pinning a Room the
// user already pinned returns the existing pin untouched rather than inserting a
// duplicate (the per-user unique index would reject it anyway). The new pin's
// position is computed from the user's current pins via the pure helper.
export async function pinRoom(opts: {
  id: string
  userId: string
  roomId: string
}): Promise<PinRecord> {
  const existing = await db
    .select()
    .from(schema.pin)
    .where(
      and(
        eq(schema.pin.userId, opts.userId),
        eq(schema.pin.roomId, opts.roomId)
      )
    )
    .limit(1)
  if (existing[0]) return toPin(existing[0])

  const pins = await listPinsForUser(opts.userId)
  const position = appendPosition(pins.map((p) => p.position))
  const [row] = await db
    .insert(schema.pin)
    .values({
      id: opts.id,
      userId: opts.userId,
      roomId: opts.roomId,
      position,
    })
    .returning()
  if (!row) throw new Error("Failed to pin room")
  return toPin(row)
}

// Remove the user's pin for a target. Scoped by `userId`, so a stray call can
// never unpin another user's pin; a no-op when the target isn't pinned. The
// target column is chosen by `kind` so a Room id can't accidentally match a
// Folder pin.
export async function unpin(opts: {
  userId: string
  kind: PinKind
  targetId: string
}): Promise<void> {
  const targetColumn =
    opts.kind === "room" ? schema.pin.roomId : schema.pin.folderId
  await db
    .delete(schema.pin)
    .where(
      and(eq(schema.pin.userId, opts.userId), eq(targetColumn, opts.targetId))
    )
}

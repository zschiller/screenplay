import "server-only"

import { and, asc, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"

/**
 * A persisted terminal tab (#258). Mirrors the client-side `TerminalTabData`
 * (see `lib/types.ts`) but is the server-of-record row: only tab identity and
 * metadata, never scrollback or conversation content. `branch` is the Branch
 * (agent) id the terminal runs against; `createdAt` is epoch millis (ordering
 * key for the tab strip).
 */
export type TerminalTabRecord = {
  id: string
  userId: string
  roomId: string
  branch: string
  label: string
  createdAt: number
}

function toRecord(
  row: typeof schema.terminalTab.$inferSelect,
): TerminalTabRecord {
  return {
    id: row.id,
    userId: row.userId,
    roomId: row.roomId,
    branch: row.branch,
    label: row.label,
    createdAt: row.createdAt.getTime(),
  }
}

/**
 * List a User's terminal tabs in a room, oldest-first. Pass `branch` to scope
 * to a single Branch; omit it to hydrate every Branch's tabs in one round-trip
 * (so switching Branches is instant). Always filtered by `userId`, so a
 * collaborator's tabs can never leak into the result.
 */
export async function listTerminalTabs(opts: {
  userId: string
  roomId: string
  branch?: string
}): Promise<TerminalTabRecord[]> {
  const filters = [
    eq(schema.terminalTab.userId, opts.userId),
    eq(schema.terminalTab.roomId, opts.roomId),
  ]
  if (opts.branch !== undefined) {
    filters.push(eq(schema.terminalTab.branch, opts.branch))
  }
  const rows = await db
    .select()
    .from(schema.terminalTab)
    .where(and(...filters))
    .orderBy(asc(schema.terminalTab.createdAt))
  return rows.map(toRecord)
}

/**
 * Persist a new terminal tab. `id` is the client-generated tab id (which also
 * doubles as the shared live-view `terminalSessionId`). `createdAt` defaults to
 * now when omitted.
 */
export async function insertTerminalTab(opts: {
  id: string
  userId: string
  roomId: string
  branch: string
  label: string
  createdAt?: Date
}): Promise<TerminalTabRecord> {
  const [row] = await db
    .insert(schema.terminalTab)
    .values({
      id: opts.id,
      userId: opts.userId,
      roomId: opts.roomId,
      branch: opts.branch,
      label: opts.label,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning()
  return toRecord(row)
}

/**
 * Permanently delete a terminal tab. Scoped to `userId` as well as `id`, so a
 * User can only ever delete their own tab — closing a tab removes its row for
 * good (a reload alone never deletes a tab).
 */
export async function deleteTerminalTab(opts: {
  id: string
  userId: string
}): Promise<void> {
  await db
    .delete(schema.terminalTab)
    .where(
      and(
        eq(schema.terminalTab.id, opts.id),
        eq(schema.terminalTab.userId, opts.userId),
      ),
    )
}

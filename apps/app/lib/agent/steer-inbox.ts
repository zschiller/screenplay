import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db as defaultDb } from "@/lib/db"
import type { DB } from "@/lib/db"
import { agentRun, agentSteer } from "@/lib/db/schema"

/**
 * A Steer (#1190): a user message sent into a Chat Session while its run is
 * `running`. It joins that run instead of starting a new one, and is pending
 * until the Engine takes it at a step boundary.
 */
export interface Steer {
  id: string
  message: string
  /** Who sent it; null for a message nobody typed. */
  userId: string | null
}

/**
 * The Steer inbox, kept in the database because the Engine runs in a different
 * server invocation from the one that receives the send. Every write that ends
 * a Steer's pending life is atomic on the row (`taken_at IS NULL`), so a Steer
 * is taken, handed back, or started as the next turn exactly once however the
 * Engine, Turn Launch and a stop race.
 */
export interface SteerInbox {
  /** Record a pending Steer on a run. */
  add(input: {
    runId: string
    chatId: string
    message: string
    userId: string | null
  }): Promise<Steer>
  /**
   * Take every pending Steer on a run, oldest first, marking them taken. Takes
   * nothing once the run has stopped being `running`, so a stop that landed
   * before the Engine noticed leaves its Steers pending for the sender.
   */
  take(runId: string): Promise<Steer[]>
  /** Remove every Steer the run never took, oldest first. */
  drain(runId: string): Promise<Steer[]>
  /** Remove one Steer if it is still pending; false when it no longer is. */
  reclaim(id: string): Promise<boolean>
}

const byCreatedAt = (
  a: { createdAt: Date; id: string },
  b: { createdAt: Date; id: string }
) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)

function toSteer(row: {
  id: string
  message: string
  userId: string | null
}): Steer {
  return { id: row.id, message: row.message, userId: row.userId }
}

export function createSteerInbox(database: DB = defaultDb): SteerInbox {
  const returning = {
    id: agentSteer.id,
    message: agentSteer.message,
    userId: agentSteer.userId,
    createdAt: agentSteer.createdAt,
  }
  return {
    async add({ runId, chatId, message, userId }) {
      const id = nanoid()
      await database
        .insert(agentSteer)
        .values({ id, runId, chatId, message, userId })
      return { id, message, userId }
    },
    async take(runId) {
      const rows = await database
        .update(agentSteer)
        .set({ takenAt: new Date() })
        .where(
          and(
            eq(agentSteer.runId, runId),
            isNull(agentSteer.takenAt),
            sql`exists (select 1 from ${agentRun} where ${agentRun.id} = ${agentSteer.runId} and ${agentRun.status} = 'running')`
          )
        )
        .returning(returning)
      return rows.sort(byCreatedAt).map(toSteer)
    },
    async drain(runId) {
      const rows = await database
        .delete(agentSteer)
        .where(and(eq(agentSteer.runId, runId), isNull(agentSteer.takenAt)))
        .returning(returning)
      return rows.sort(byCreatedAt).map(toSteer)
    },
    async reclaim(id) {
      const rows = await database
        .delete(agentSteer)
        .where(and(eq(agentSteer.id, id), isNull(agentSteer.takenAt)))
        .returning({ id: agentSteer.id })
      return rows.length > 0
    },
  }
}

/** The inbox over the live database. */
export const steerInbox = createSteerInbox()

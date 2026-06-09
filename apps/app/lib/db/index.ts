import "server-only"

import { createNeonDb } from "./neon"
import { createPgliteDb } from "./pglite"
import * as schema from "./schema"
import type { DB } from "./types"

export type { DB } from "./types"

function selectDb(): { db: DB; ready: Promise<void> } {
  // Build-time switch over the db seam. The desktop build sets
  // `SCREENPLAY_DB=pglite` to resolve the embedded-Postgres handle against a
  // local data dir; the hosted deployment leaves it unset and keeps the
  // neon-http client unchanged. This mirrors the env-switched factory the
  // sibling seams (sandbox, blob, yjs-host) already anticipate.
  if (process.env.SCREENPLAY_DB === "pglite") {
    const dataDir = process.env.PGLITE_DATA_DIR ?? "./.pglite"
    return createPgliteDb(dataDir)
  }
  return { db: createNeonDb(), ready: Promise.resolve() }
}

const handle = selectDb()

/** The configured database handle — neon-http when hosted, PGlite on desktop. */
export const db = handle.db

/**
 * Resolves once the selected backend is ready to serve queries. Immediate for
 * neon; for PGlite it awaits migration-on-boot. The server boot path
 * (`instrumentation.ts`) awaits this before serving traffic.
 */
export const dbReady = handle.ready

export { schema }

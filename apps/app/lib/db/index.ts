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

// PGlite must open its data dir exactly once per process — two clients on one
// dir corrupt it (issue #418). This module is NOT a reliable once-per-process
// singleton on its own: Next.js evaluates it in several independent Turbopack
// module registries within the same sidecar process (the instrumentation hook,
// the RSC/server layer, and the SSR layer are separate graphs, each with its
// own module-level state), so a bare `selectDb()` here can open the same dir
// twice. The data-dir lock can't catch that — both openers share one pid, so it
// reads the lock as self-owned and allows the second open. `globalThis` is the
// one thing every module instance in the process shares, so pin the handle to
// it: the first evaluator opens the db, every other reuses that handle.
const globalForDb = globalThis as typeof globalThis & {
  __screenplayDbHandle?: ReturnType<typeof selectDb>
}

// Opened on first USE, not at import. `next dev` evaluates dynamic routes'
// static params in a forked jest-worker child whose import of the page graph
// reaches this module; an eager `selectDb()` there is a second OS process
// opening the single-process PGlite dir, and the data-dir lock (correctly)
// refuses it — every dynamic page 500s in dev. The worker only imports, it
// never queries (no `generateStaticParams` touches the db), so deferring the
// open to first access keeps it out of the lock's way entirely. The packaged
// sidecar is unaffected: `instrumentation.ts` awaits `dbReady` on boot, which
// opens the db before the first request either way.
function handle(): ReturnType<typeof selectDb> {
  return (globalForDb.__screenplayDbHandle ??= selectDb())
}

/** The configured database handle — neon-http when hosted, PGlite on desktop. */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = handle().db as unknown as Record<PropertyKey, unknown>
    const value = real[prop]
    return typeof value === "function" ? value.bind(real) : value
  },
  has(_target, prop) {
    return prop in handle().db
  },
})

/**
 * Resolves once the selected backend is ready to serve queries. Immediate for
 * neon; for PGlite it awaits migration-on-boot. The server boot path
 * (`instrumentation.ts`) awaits this before serving traffic. A lazy thenable so
 * importing this module doesn't open the db (see `handle` above).
 */
export const dbReady: PromiseLike<void> = {
  then(onfulfilled, onrejected) {
    return handle().ready.then(onfulfilled, onrejected)
  },
}

export { schema }

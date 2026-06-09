import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as schema from "./schema"
import type { DB } from "./types"

/**
 * A booted PGlite-backed handle. `db` is usable immediately (PGlite serializes
 * operations through one connection), but callers must `await ready` before
 * issuing application queries so the schema exists. `ready` resolves once the
 * drizzle migrations have run.
 */
export interface PgliteHandle {
  db: DB
  ready: Promise<void>
  /** Close the underlying PGlite connection and release the data dir. */
  close: () => Promise<void>
}

// The desktop-only migration set drizzle-kit writes from `schema-core` (see
// drizzle.local.config.ts) — `drizzle/local`, NOT the full hosted `drizzle/`
// history. The multi-user surface (auth, room_member, comments) is excluded
// from the local build (PRD #404, issue #417), so those tables are never
// created on disk here. PGlite only ever runs in the local build, so this is
// always the right set. Resolved from this module so it works whether run from
// the app root (tests, `next dev`) or a bundled sidecar.
// `PGLITE_MIGRATIONS_DIR` overrides it when the packaged desktop build ships
// the SQL somewhere else.
//
// Built with `dirname`/`join` rather than `new URL("../../drizzle/local",
// import.meta.url)` on purpose: Turbopack statically intercepts the latter and
// tries to resolve the directory as a module at build time (it isn't one),
// which fails the hosted build even though this path is only read on desktop.
const MIGRATIONS_DIR =
  process.env.PGLITE_MIGRATIONS_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "../../drizzle/local")

/**
 * Build the local, embedded-Postgres sibling of {@link createNeonDb}. The same
 * drizzle schema and migrations run unchanged — PGlite is plain Postgres, so
 * jsonb columns, `now()`, the `->>` operators, `onConflict`, `RETURNING`, and FK
 * cascades all behave identically (verified by the #406 spike).
 *
 * Migrations are idempotent: drizzle records applied hashes in
 * `__drizzle_migrations`, so re-opening the same `dataDir` and migrating again
 * is a no-op and the schema stays stable across reboots.
 *
 * @param dataDir Filesystem directory PGlite persists to. Use `"memory://"`
 *   for an ephemeral in-memory database (handy in tests).
 */
export function createPgliteDb(dataDir: string): PgliteHandle {
  const client = new PGlite(dataDir)
  const db = drizzle(client, { schema })
  const ready = migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return { db, ready, close: () => client.close() }
}

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs"
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
  // Refuse to open a dir another live process already holds — see lockDataDir.
  const releaseLock = lockDataDir(dataDir)
  let client: PGlite
  try {
    client = new PGlite(dataDir)
  } catch (err) {
    releaseLock()
    throw err
  }
  const db = drizzle(client, { schema })
  const ready = migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  return {
    db,
    ready,
    close: async () => {
      try {
        await client.close()
      } finally {
        releaseLock()
      }
    },
  }
}

/**
 * Acquire an exclusive lock on a PGlite data dir, returning a release callback.
 *
 * **This is the load-bearing guarantee against database corruption.** PGlite
 * runs an in-WASM Postgres whose postmaster lock is *not* honored across separate
 * Node processes, so two openers of the same dir — a second app instance, or a
 * sidecar orphaned by a crash/hot-reload — write concurrently and corrupt the
 * files irrecoverably (and unrecoverably: the dir then aborts on every later
 * open). This makes the *second* opener fail loudly instead of writing.
 *
 * A sibling `<dir>.lock` holds the owner pid. A live foreign owner → throw; a
 * dead owner (a stale lock left by a hard kill) → reclaim. The atomic `wx`
 * create is the serialization point, so two processes racing to reclaim a stale
 * lock still converge to a single winner.
 */
export function lockDataDir(dataDir: string): () => void {
  // In-memory PGlite (tests) is per-process — nothing to lock.
  if (dataDir.startsWith("memory://")) return () => {}

  // `next build` collects page data across multiple worker processes, each of
  // which imports this module but never serves a query. They'd look like
  // concurrent openers and fail the build; skip the lock during the build phase.
  // (The single standalone server process at runtime still locks normally.)
  if (process.env.NEXT_PHASE === "phase-production-build") return () => {}

  const lockPath = `${dataDir}.lock`
  mkdirSync(dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const fd = openSync(lockPath, "wx") // atomic: fails if the file exists
      writeSync(fd, String(process.pid))
      closeSync(fd)

      let released = false
      const release = () => {
        if (released) return
        released = true
        try {
          // Only remove the lock if we still own it (don't clobber a reclaimer).
          if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
            unlinkSync(lockPath)
          }
        } catch {
          /* already gone */
        }
      }
      // Release on clean exit too, not only an explicit close().
      process.once("exit", release)
      return release
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err

      const owner = Number(readFileSync(lockPath, "utf8").trim() || "0")
      if (owner > 0 && isProcessAlive(owner)) {
        // A live owner — refuse, whether it's another process OR this one. The
        // same-pid case is a second opener inside one process (Next.js can
        // evaluate the db module in more than one Turbopack module registry per
        // process; see lib/db/index.ts). It's just as corrupting as a foreign
        // opener and must NOT be silently reclaimed — fail loudly so the caller
        // reuses the shared handle from "@/lib/db" instead.
        throw new Error(
          owner === process.pid
            ? `PGlite data dir "${dataDir}" is already open in THIS process ` +
                `(pid ${owner}). Refusing a second concurrent opener — import the ` +
                `shared handle from "@/lib/db" instead of calling createPgliteDb again.`
            : `PGlite data dir "${dataDir}" is already open in another live process ` +
                `(pid ${owner}). Refusing to open it concurrently — concurrent writers ` +
                `corrupt the database. Close the other instance first.`
        )
      }
      // Stale lock (owner gone): drop it and retry the atomic create.
      try {
        unlinkSync(lockPath)
      } catch {
        /* another process reclaimed it first; the retry will re-check */
      }
    }
  }
  throw new Error(`could not acquire the PGlite data dir lock at ${lockPath}`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0) // signal 0 only probes existence
    return true
  } catch {
    return false
  }
}

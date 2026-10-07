import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type * as schema from "./schema"

// The shared shape every backend behind the `createNeonDb()` seam satisfies.
// Both the hosted neon-http handle (`NeonHttpDatabase`) and the local desktop
// handle (`PgliteDatabase`) extend `PgDatabase`, so this base is exactly their
// common surface: `select`/`insert`/`update`/`delete`, `$with`, and a typed
// `transaction()`.
//
// That `transaction()` is only typed: neon-http throws on it (see `neon.ts`),
// so app code never calls it (ESLint bans it) and does an atomic multi-row
// write as one statement with data-modifying CTEs instead (`lib/comments.ts`,
// `lib/agent/run-state.ts`). The base also leaves out neon-http's `.batch()`,
// which PGlite lacks, so a `.batch([...])` call is a compile error.
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>

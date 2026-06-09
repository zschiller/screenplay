import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type * as schema from "./schema"

// The shared shape every backend behind the `createNeonDb()` seam satisfies.
// Both the hosted neon-http handle (`NeonHttpDatabase`) and the local desktop
// handle (`PgliteDatabase`) extend `PgDatabase`, so this base is exactly their
// common surface: `select`/`insert`/`update`/`delete` plus interactive
// `transaction()`.
//
// Crucially it does NOT expose neon-http's `.batch()`. That primitive existed
// only because neon-http rejects `transaction()`; PGlite has no `.batch()` but
// does support interactive `transaction()`. Typing `DB` at this base makes any
// remaining `.batch([...])` call a compile error, which is what forced the two
// atomic writes in `run-state.ts` onto `transaction()` (see #406 spike).
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>

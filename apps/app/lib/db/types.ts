import type { NeonHttpDatabase } from "drizzle-orm/neon-http"
import type * as schema from "./schema"

// The concrete neon-http handle (what `createNeonDb` returns). It extends the
// generic `PgDatabase`, so every existing consumer keeps working, and it also
// exposes `batch([...])` — the driver's only atomic primitive, since neon-http
// rejects interactive `transaction()`.
export type DB = NeonHttpDatabase<typeof schema>

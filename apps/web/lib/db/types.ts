import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type * as schema from "./schema"

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>

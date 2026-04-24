import { createNeonDb } from "./neon"
import * as schema from "./schema"

export type { DB } from "./types"
export const db = createNeonDb()
export { schema }

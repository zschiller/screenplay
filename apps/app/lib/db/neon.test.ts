import { afterEach, describe, expect, it, vi } from "vitest"

import { createNeonDb } from "./neon"

// The hosted driver rejects `transaction()` before touching the network, which
// is what the shared test handle (`test/pglite.ts`) mirrors (#1899).
describe("createNeonDb", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("rejects transaction()", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@127.0.0.1:1/db")
    const db = createNeonDb()

    await expect(db.transaction(async () => {})).rejects.toThrow(
      "No transactions support in neon-http driver"
    )
  })
})

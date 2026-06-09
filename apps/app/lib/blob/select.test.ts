import { describe, expect, it } from "vitest"

import { blobStoreChoiceFromEnv, BLOB_STORE_ENV_VAR } from "./select"

describe("blobStoreChoiceFromEnv", () => {
  it("defaults to vercel when the var is unset", () => {
    expect(blobStoreChoiceFromEnv({})).toBe("vercel")
  })

  it("selects local-fs only on the explicit value", () => {
    expect(blobStoreChoiceFromEnv({ [BLOB_STORE_ENV_VAR]: "local-fs" })).toBe(
      "local-fs"
    )
  })

  it("stays on vercel for an empty or unrecognised value (no silent swap)", () => {
    expect(blobStoreChoiceFromEnv({ [BLOB_STORE_ENV_VAR]: "" })).toBe("vercel")
    expect(blobStoreChoiceFromEnv({ [BLOB_STORE_ENV_VAR]: "s3" })).toBe(
      "vercel"
    )
    expect(blobStoreChoiceFromEnv({ [BLOB_STORE_ENV_VAR]: "Local-FS" })).toBe(
      "vercel"
    )
  })
})

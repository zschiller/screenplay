import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { markSvg } from "@workspace/ui/lib/brand"

/**
 * The docs favicon is a static file: Next drops the `/docs` basePath from the
 * link it emits for a generated `icon.ts`. Keep the file in step with the one
 * source of the mark (`@workspace/ui/lib/brand`).
 */
describe("brand mark", () => {
  it("docs favicon matches markSvg()", () => {
    const file = fileURLToPath(
      new URL("../../docs/app/icon.svg", import.meta.url)
    )
    expect(readFileSync(file, "utf8").trim()).toBe(markSvg())
  })
})

// The committed template pages must match what the source builds, so an edit
// to a component, the tokens or the sample data can't skip the build.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { MARKER } from "../lib/page.ts"
import { templates } from "../templates.ts"

const pkg = fileURLToPath(new URL("../", import.meta.url))
const root = fileURLToPath(new URL("../../../", import.meta.url))

describe("skill templates", () => {
  it("are built from the current source", () => {
    // A child process, so the build runs as `pnpm build` does, outside Vitest
    expect(() =>
      execFileSync("node", ["scripts/build.ts", "--check"], {
        cwd: pkg,
        stdio: "pipe",
      })
    ).not.toThrow()
  }, 120_000)

  it.each(templates)("$name keeps the part agents read short", (t) => {
    const top = readFileSync(root + t.out, "utf8").split(MARKER)[0]!
    expect(top.split("\n").length).toBeLessThan(120)
  })
})

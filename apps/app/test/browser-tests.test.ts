import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * CI runs tests that need a real browser stack (Chrome, Xvfb, ffmpeg) in a job
 * of their own, picked by the `*.browser.test.ts` name; the sharded unit jobs
 * skip that name and don't install the stack. A browser test under any other
 * name would land in a unit shard and skip itself there, dropping out of CI
 * without a failure. Xvfb is the tell: only a browser test needs it.
 */

const appRoot = fileURLToPath(new URL("..", import.meta.url))

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return ["node_modules", ".next"].includes(entry.name)
        ? []
        : testFiles(full)
    }
    return /\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe("browser tests", () => {
  it("are named *.browser.test.ts so CI runs them in the browser job", () => {
    const misnamed = testFiles(appRoot)
      .filter((file) => !/\.browser\.test\.tsx?$/.test(file))
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => readFileSync(file, "utf8").includes("Xvfb"))
      .map((file) => path.relative(appRoot, file))
    expect(misnamed).toEqual([])
  })
})

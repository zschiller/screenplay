import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Every GitHub API call is built from `githubAccess.apiUrl` (#1925), so a fork
 * on GitHub Enterprise changes one place. Only `lib/github-access` may name
 * the github.com API host; tests and fixtures are exempt.
 */

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const SOURCE_DIRS = ["app", "components", "hooks", "lib"]
const ALLOWED = path.join(appRoot, "lib", "github-access") + path.sep

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(file)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      yield file
  }
}

describe("GitHub API host", () => {
  it("is named only in lib/github-access", () => {
    const offenders: string[] = []
    for (const dir of SOURCE_DIRS) {
      for (const file of sourceFiles(path.join(appRoot, dir))) {
        if (file.startsWith(ALLOWED)) continue
        if (readFileSync(file, "utf8").includes("api.github.com")) {
          offenders.push(path.relative(appRoot, file))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

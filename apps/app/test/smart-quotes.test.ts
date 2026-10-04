import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { copyFiles, scan } from "@workspace/smart-quotes"
import { describe, expect, it } from "vitest"

/**
 * UI copy uses curly apostrophes and quotes (’ “ ” ‘), never straight ' and ".
 * This checks JSX text, prose attributes (`alt`, `title`, `aria-label`, …) and
 * apostrophes inside words in any other string, which covers toasts, errors
 * and agent prompts. Fix with `pnpm --filter app exec smart-quotes --fix app
 * components hooks lib`.
 */

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const SOURCE_DIRS = ["app", "components", "hooks", "lib"]

describe("UI copy", () => {
  it("uses curly apostrophes and quotes", () => {
    const found = SOURCE_DIRS.flatMap((dir) =>
      [...copyFiles(path.join(appRoot, dir))].flatMap((file) => {
        const src = readFileSync(file, "utf8")
        return scan(src, file).map(
          (e) =>
            `${path.relative(appRoot, file)}:${e.line}: ${src.slice(e.start, e.end)} should be ${e.text}`
        )
      })
    )
    expect(found).toEqual([])
  })
})

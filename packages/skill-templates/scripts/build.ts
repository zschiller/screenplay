// Builds every template into its outputs (lib/build.ts) and writes them: the
// repo skill's self-contained page, and the App Skill's data page and
// runtime. `--check` writes nothing and fails when a committed file is out
// of date (the package's test runs it).

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { render } from "../lib/build.ts"
import { templates } from "../templates.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const check = process.argv.includes("--check")
let stale = 0
for (const t of templates) {
  for (const { path, content } of await render(t)) {
    if (check) {
      let now = ""
      try {
        now = readFileSync(root + path, "utf8")
      } catch {}
      if (now !== content) {
        stale++
        console.error(
          `${path} is out of date: run pnpm --filter @workspace/skill-templates build`
        )
      }
    } else {
      writeFileSync(root + path, content)
      console.log(`${path} (${Math.round(content.length / 1024)} KB)`)
    }
  }
}
if (stale) process.exit(1)

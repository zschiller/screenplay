// Builds every template into one self-contained HTML page and writes it into
// its skill folder. `--check` writes nothing and fails when a committed page
// is out of date (the package's test runs it).

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { render } from "../lib/build.ts"
import { templates } from "../templates.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const check = process.argv.includes("--check")
let stale = 0
for (const t of templates) {
  const html = await render(t)
  const path = root + t.out
  if (check) {
    let now = ""
    try {
      now = readFileSync(path, "utf8")
    } catch {}
    if (now !== html) {
      stale++
      console.error(`${t.out} is out of date: run pnpm --filter @workspace/skill-templates build`)
    }
  } else {
    writeFileSync(path, html)
    console.log(`${t.out} (${Math.round(html.length / 1024)} KB)`)
  }
}
if (stale) process.exit(1)

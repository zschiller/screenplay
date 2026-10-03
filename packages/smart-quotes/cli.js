#!/usr/bin/env node
/**
 * smart-quotes [--fix] <file or folder>...
 *
 * Lists every straight quote in the copy of the given MDX, TSX and TS files
 * (folders are searched) and exits 1 if there are any. `--fix` writes the
 * curly characters in instead.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { applyEdits, scan } from "./index.js"

const args = process.argv.slice(2)
const fix = args.includes("--fix")
const roots = args.filter((a) => a !== "--fix")
if (roots.length === 0) {
  console.error("usage: smart-quotes [--fix] <file or folder>...")
  process.exit(2)
}

const SKIP = new Set(["node_modules", ".next", "public"])
function* files(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!SKIP.has(name) && !name.startsWith("."))
        yield* files(join(path, name))
    }
  } else if (/\.(mdx?|tsx?)$/.test(path) && !path.endsWith(".d.ts")) {
    yield path
  }
}

let found = 0
for (const root of roots) {
  for (const file of files(root)) {
    const src = readFileSync(file, "utf8")
    const edits = scan(src, file)
    if (edits.length === 0) continue
    found += edits.length
    if (fix) {
      writeFileSync(file, applyEdits(src, edits))
      console.log(`${relative(".", file)}: ${edits.length} fixed`)
    } else {
      for (const e of edits) {
        console.log(
          `${relative(".", file)}:${e.line}: ${JSON.stringify(src.slice(e.start, e.end))} should be ${e.text}`
        )
      }
    }
  }
}

if (found > 0 && !fix) {
  console.error(
    `\n${found} straight quote${found === 1 ? "" : "s"} in copy. Use ’ “ ” ‘ instead, or run this again with --fix.`
  )
  process.exit(1)
}

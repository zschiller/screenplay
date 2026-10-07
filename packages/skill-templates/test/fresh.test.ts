// The committed template pages must match what the source builds, so an edit
// to a component, the tokens or the sample data can't skip the build.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { MARKER } from "../lib/page.ts"
import { appOutputs, templates } from "../templates.ts"

const pkg = fileURLToPath(new URL("../", import.meta.url))
const root = fileURLToPath(new URL("../../../", import.meta.url))
const read = (path: string) => readFileSync(root + path, "utf8")

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
    for (const path of [t.out, appOutputs(t).page]) {
      const top = read(path).split(MARKER)[0]!
      expect(top.split("\n").length).toBeLessThan(120)
    }
  })

  it.each(templates)(
    "$name as a Mockup holds its data and a reference, not the bundle",
    (t) => {
      const { page, ref } = appOutputs(t)
      const html = read(page)
      const data = readFileSync(`${pkg}src/${t.name}/data.js`, "utf8")
      expect(html.split(MARKER)[1]).toContain(`<script src="${ref}"></script>`)
      // A few KB around the data: the title, the tokens and the reference
      expect(html.length - data.length).toBeLessThan(4 * 1024)
    }
  )

  it.each(templates)("$name paints its own page over a host's", (t) => {
    // An Artifact wraps the page in an unlayered `body` rule (cream, dark
    // text, a system font) that beats anything in a cascade layer
    const bundle = read(t.out).split(MARKER)[1]!
    expect(bundle).toContain(
      "html body{background-color:var(--background);color:var(--foreground);font:inherit}"
    )
  })
})

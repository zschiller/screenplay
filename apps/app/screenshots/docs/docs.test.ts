import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { readSource, WORKSPACE_EDITS } from "./demo-site"
import { detailRegion } from "./frame"
import { DOCS_SCREENS } from "./screens"
import { buildDocsWorld, DOCS_WORKSPACES, docsPreviews } from "./world"

const DOCS_CONTENT = resolve(__dirname, "../../../docs/content")
const README = resolve(__dirname, "../../../../README.md")

function mdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return mdxFiles(path)
    return path.endsWith(".mdx") ? [path] : []
  })
}

/** Every `<Screenshot name="…">` the docs embed. */
function embeddedNames(): Set<string> {
  const names = new Set<string>()
  for (const file of mdxFiles(DOCS_CONTENT)) {
    // Code samples that show the component aren't embeds.
    const prose = readFileSync(file, "utf8")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]*`/g, "")
    for (const match of prose.matchAll(/<Screenshot\s+name="([^"]+)"/g)) {
      names.add(match[1]!)
    }
  }
  return names
}

describe("the docs screen list", () => {
  it("has a screen for every screenshot the docs embed, and nothing else", () => {
    const listed = DOCS_SCREENS.map((s) => s.name).sort()
    expect(listed).toEqual([...embeddedNames()].sort())
  })

  it("has a screen for every docs screenshot the root README shows", () => {
    // The README reuses the docs' images so they refresh with the docs.
    const readme = readFileSync(README, "utf8")
    const shown = [
      ...readme.matchAll(
        /apps\/docs\/public\/screenshots\/([\w-]+)\.(?:light|dark)\.webp/g
      ),
    ].map((match) => match[1]!)
    const listed = new Set(DOCS_SCREENS.map((s) => s.name))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.filter((name) => !listed.has(name))).toEqual([])
  })

  it("names each screen once", () => {
    const names = DOCS_SCREENS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("the demo site's Workspace edits", () => {
  it("each apply to the source as it reads on main", async () => {
    for (const edits of Object.values(WORKSPACE_EDITS)) {
      for (const edit of edits) {
        expect(await readSource(edit.path), edit.path).toContain(edit.find)
      }
    }
  })
})

describe("the docs world", () => {
  it("gives every Workspace a preview", async () => {
    const previews = docsPreviews(5000)
    const world = await buildDocsWorld({
      now: 0,
      previewOrigins: Object.fromEntries(
        previews.map((p) => [p.sandboxName, `http://127.0.0.1:${p.port}`])
      ),
    })
    const sandboxes = world.rooms.flatMap((room) =>
      (room.doc?.branches ?? []).map((b) => b.sandboxName)
    )
    expect(sandboxes.sort()).toEqual([...DOCS_WORKSPACES].sort())
  })
})

describe("a detail's region", () => {
  const viewport = { width: 1280, height: 800 }

  it("reaches the window's top-left corner when it lands near it", () => {
    // A sidebar row menu: centring leaves the crop 52px in, slicing labels.
    expect(detailRegion([208, 152, 249, 352], viewport)).toEqual([
      0, 0, 613, 568,
    ])
  })

  it("stays centred on a dialog away from the corner", () => {
    const [x, y, w, h] = detailRegion([440, 200, 400, 420], viewport)
    expect(x + w / 2).toBe(640)
    expect(y + h / 2).toBe(410)
  })

  it("keeps the focus wholly inside", () => {
    const [x, y, w, h] = detailRegion([1184, 756, 24, 24], viewport)
    expect(x <= 1184 && y <= 756).toBe(true)
    expect(x + w >= 1208 && y + h >= 780).toBe(true)
  })
})

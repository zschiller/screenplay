import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { readSource, WORKSPACE_EDITS } from "./demo-site"
import { DOCS_SCREENS } from "./screens"
import { buildDocsWorld, DOCS_WORKSPACES, docsPreviews } from "./world"

const DOCS_CONTENT = resolve(__dirname, "../../../docs/content")

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

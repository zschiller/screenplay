import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
  canvasShortcutGroups,
  DUPLICATE_KEYS,
  SHORTCUT_SHEET_KEY,
  ZOOM_SHORTCUTS,
} from "@/lib/canvas/shortcuts"

/**
 * `Kbd` is for keys only, one cap per key. A mouse action (“Click”, “Drag”,
 * “Scroll”) is never a key cap: the shortcut sheet prints it as plain text
 * after the caps (`CanvasShortcut.gesture`). This checks the shortcut
 * catalogue the sheet and menus print, and every literal `<Kbd>` child and
 * `shortcut` prop in the app's source.
 */

const MOUSE_WORD =
  /\b(click|drag|scroll|hover|wheel|tap|pinch|swipe|mouse|trackpad)\b/i

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const SOURCE_DIRS = ["app", "components", "hooks", "lib"]

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* sourceFiles(file)
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name))
      yield file
  }
}

/** The literal key text in `src`: `<Kbd …>text</Kbd>` and `shortcut="…"`. */
function literalKeys(src: string): string[] {
  const keys: string[] = []
  for (const m of src.matchAll(/<Kbd\b[^>]*>([^<{]+)<\/Kbd>/g))
    keys.push(m[1]!.trim())
  for (const m of src.matchAll(/\bshortcut=(?:\{\s*)?["'`]([^"'`]+)["'`]/g))
    keys.push(m[1]!)
  return keys
}

describe("Kbd", () => {
  it("flags a mouse word", () => {
    for (const word of ["Click", "Drag", "Scroll", "Double-click"])
      expect(word).toMatch(MOUSE_WORD)
    expect(literalKeys(`<Kbd className="x">Click</Kbd>`)).toEqual(["Click"])
    expect(literalKeys(`<IconButton shortcut="Scroll" />`)).toEqual(["Scroll"])
  })

  it("holds keys only in the shortcut catalogue", () => {
    const caps = [
      ...[true, false].flatMap((comments) =>
        canvasShortcutGroups({ comments }).flatMap((group) =>
          group.shortcuts.flatMap((shortcut) => shortcut.keys)
        )
      ),
      ...Object.values(ZOOM_SHORTCUTS).flat(),
      ...DUPLICATE_KEYS,
      SHORTCUT_SHEET_KEY,
    ]
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.filter((cap) => MOUSE_WORD.test(cap))).toEqual([])
  })

  it("holds keys only in the app's source", () => {
    const found = SOURCE_DIRS.flatMap((dir) =>
      [...sourceFiles(path.join(appRoot, dir))].flatMap((file) =>
        literalKeys(readFileSync(file, "utf8"))
          .filter((key) => MOUSE_WORD.test(key))
          .map((key) => `${path.relative(appRoot, file)}: ${key}`)
      )
    )
    expect(found).toEqual([])
  })
})

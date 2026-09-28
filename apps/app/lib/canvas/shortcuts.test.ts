import { describe, expect, it } from "vitest"

import {
  canvasShortcutGroups,
  matchCanvasShortcut,
} from "@/lib/canvas/shortcuts"

const key = (
  k: string,
  code: string,
  mods: Partial<{
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    shiftKey: boolean
  }> = {}
) => ({
  key: k,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe("matchCanvasShortcut", () => {
  it("matches ⌘= / ⌘+ / ⌘- / ⌘0 with either Cmd or Ctrl", () => {
    expect(
      matchCanvasShortcut(key("=", "Equal", { metaKey: true }), false)
    ).toBe("zoom-in")
    expect(
      matchCanvasShortcut(
        key("+", "Equal", { ctrlKey: true, shiftKey: true }),
        false
      )
    ).toBe("zoom-in")
    expect(
      matchCanvasShortcut(key("-", "Minus", { ctrlKey: true }), false)
    ).toBe("zoom-out")
    expect(
      matchCanvasShortcut(key("0", "Digit0", { metaKey: true }), false)
    ).toBe("zoom-to-100")
  })

  it("keeps the ⌘ zoom keys working while typing in a field", () => {
    expect(
      matchCanvasShortcut(key("=", "Equal", { metaKey: true }), true)
    ).toBe("zoom-in")
  })

  it("matches ⇧1 for fit and ? for the sheet, but not while typing", () => {
    expect(
      matchCanvasShortcut(key("!", "Digit1", { shiftKey: true }), false)
    ).toBe("zoom-to-fit")
    expect(
      matchCanvasShortcut(key("?", "Slash", { shiftKey: true }), false)
    ).toBe("shortcut-sheet")
    expect(
      matchCanvasShortcut(key("!", "Digit1", { shiftKey: true }), true)
    ).toBeNull()
    expect(
      matchCanvasShortcut(key("?", "Slash", { shiftKey: true }), true)
    ).toBeNull()
  })

  it("ignores plain keys, Alt chords and other ⌘ keys", () => {
    expect(matchCanvasShortcut(key("1", "Digit1"), false)).toBeNull()
    expect(matchCanvasShortcut(key("/", "Slash"), false)).toBeNull()
    expect(
      matchCanvasShortcut(
        key("=", "Equal", { metaKey: true, altKey: true }),
        false
      )
    ).toBeNull()
    expect(
      matchCanvasShortcut(key("b", "KeyB", { metaKey: true }), false)
    ).toBeNull()
  })
})

describe("canvasShortcutGroups", () => {
  it("lists the zoom keys the matcher handles", () => {
    const view = canvasShortcutGroups({ comments: true }).find(
      (g) => g.title === "View"
    )
    expect(view?.shortcuts.map((s) => s.label)).toEqual(
      expect.arrayContaining([
        "Zoom in",
        "Zoom out",
        "Zoom to 100%",
        "Zoom to fit",
      ])
    )
  })

  it("drops the Comment tool when comments are off", () => {
    const labels = (comments: boolean) =>
      canvasShortcutGroups({ comments })
        .flatMap((g) => g.shortcuts)
        .map((s) => s.label)
    expect(labels(true)).toContain("Comment")
    expect(labels(false)).not.toContain("Comment")
    expect(labels(true)).toContain("Next comment")
    expect(labels(false)).not.toContain("Next comment")
  })
})

describe("canvas shortcut key caps", () => {
  it("keeps pointer actions out of the key caps", () => {
    const shortcuts = canvasShortcutGroups({ comments: true }).flatMap(
      (g) => g.shortcuts
    )
    for (const { keys } of shortcuts) {
      for (const key of keys) {
        expect(key).not.toMatch(/click|drag|scroll/i)
      }
    }
    expect(shortcuts.find((s) => s.label === "Rename a title")).toEqual({
      label: "Rename a title",
      keys: [],
      gesture: "Double-click",
    })
  })
})

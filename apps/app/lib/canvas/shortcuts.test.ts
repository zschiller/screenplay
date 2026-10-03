import { describe, expect, it } from "vitest"

import type { KeyTarget } from "@/lib/canvas/key-target"
import {
  CANVAS_KEYS,
  canvasShortcutGroups,
  matchCanvasKey,
  sheetActions,
  type CanvasKeyAction,
  type KeyLike,
} from "@/lib/canvas/shortcuts"

type Mods = Partial<
  Pick<
    KeyLike,
    | "code"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "repeat"
    | "defaultPrevented"
  >
>

const key = (k: string, mods: Mods = {}): KeyLike => ({
  key: k,
  code: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  ...mods,
})

const at = (where: Partial<KeyTarget> = {}): KeyTarget => ({
  textEntry: false,
  composer: false,
  overlay: false,
  keyboardControl: false,
  ...where,
})

const canvas = at()
const field = at({ textEntry: true })
const composer = at({ textEntry: true, composer: true })
const menu = at({ overlay: true })
const focusedButton = at({ keyboardControl: true })

const cmd = { metaKey: true }
const ctrl = { ctrlKey: true }

// [what, event, where it landed, expected action]
const CASES: [string, KeyLike, KeyTarget, CanvasKeyAction | null][] = [
  // Escape
  ["Esc on the canvas", key("Escape"), canvas, "escape"],
  ["Esc in a field", key("Escape"), field, "escape"],
  ["Esc in a menu", key("Escape"), menu, "escape"],
  [
    "Esc a menu already took",
    key("Escape", { defaultPrevented: true }),
    canvas,
    null,
  ],
  // Tools
  ["V", key("v"), canvas, "tool-select"],
  ["C", key("c"), canvas, "tool-comment"],
  ["D", key("d"), canvas, "tool-document"],
  ["F", key("f"), canvas, "tool-frame"],
  ["M", key("m"), canvas, "tool-mockup"],
  ["⌘V is paste, not Select", key("v", cmd), canvas, null],
  [
    "Ctrl+D duplicates, not Document",
    key("d", ctrl),
    canvas,
    "duplicate-selection",
  ],
  ["F typed in a field", key("f"), field, null],
  ["V in a menu", key("v"), menu, null],
  ["/", key("/", { code: "Slash" }), canvas, "cursor-chat"],
  ["/ typed in a field", key("/"), field, null],
  ["⌥/", key("/", { altKey: true }), canvas, null],
  // View
  ["⌘=", key("=", { ...cmd, code: "Equal" }), canvas, "zoom-in"],
  [
    "Ctrl+⇧+",
    key("+", { ...ctrl, shiftKey: true, code: "Equal" }),
    canvas,
    "zoom-in",
  ],
  ["⌘= in a field", key("=", { ...cmd, code: "Equal" }), field, "zoom-in"],
  ["⌥⌘=", key("=", { ...cmd, altKey: true, code: "Equal" }), canvas, null],
  ["Ctrl+-", key("-", { ...ctrl, code: "Minus" }), canvas, "zoom-out"],
  ["⌘0", key("0", { ...cmd, code: "Digit0" }), canvas, "zoom-to-100"],
  ["⌘⇧0", key(")", { ...cmd, shiftKey: true, code: "Digit0" }), canvas, null],
  ["⌘= in a menu", key("=", { ...cmd, code: "Equal" }), menu, null],
  ["⇧1", key("!", { shiftKey: true, code: "Digit1" }), canvas, "zoom-to-fit"],
  [
    "⇧1 typed in a field",
    key("!", { shiftKey: true, code: "Digit1" }),
    field,
    null,
  ],
  ["1", key("1", { code: "Digit1" }), canvas, null],
  ["Space", key(" "), canvas, "pan"],
  ["Space held (repeat)", key(" ", { repeat: true }), canvas, null],
  ["Space in a field", key(" "), field, null],
  ["Space on a keyboard-focused button", key(" "), focusedButton, null],
  // Panels
  ["⌘B", key("b", cmd), canvas, "toggle-sidebar"],
  ["Ctrl+B", key("b", ctrl), canvas, "toggle-sidebar"],
  ["⌘B in a document is Bold", key("b", cmd), field, null],
  ["⌘B from the Composer", key("b", cmd), composer, null],
  ["⌘⇧B", key("B", { ...cmd, shiftKey: true }), canvas, null],
  ["⌘I", key("i", cmd), canvas, "toggle-chat"],
  ["⌘I in a document is Italic", key("i", cmd), field, null],
  ["⌘I from the Composer", key("i", cmd), composer, "toggle-chat"],
  ["Ctrl+I from the Composer", key("i", ctrl), composer, "toggle-chat"],
  ["⌘I in a menu", key("i", cmd), menu, null],
  ["⌥⌘I", key("i", { ...cmd, altKey: true }), canvas, null],
  ["⌘.", key(".", cmd), canvas, "toggle-panels"],
  ["⌘. in a field", key(".", cmd), field, null],
  ["?", key("?", { shiftKey: true, code: "Slash" }), canvas, "shortcut-sheet"],
  ["? typed in a field", key("?", { shiftKey: true }), field, null],
  // Edit
  ["⌫", key("Backspace"), canvas, "delete-selection"],
  ["Delete", key("Delete"), canvas, "delete-selection"],
  ["⌫ in a field", key("Backspace"), field, null],
  ["⌫ inside a menu", key("Backspace"), menu, null],
  ["⌘D", key("d", cmd), canvas, "duplicate-selection"],
  ["⌘D in a field", key("d", cmd), field, null],
  ["⌘D in a menu", key("d", cmd), menu, null],
  ["⌘⇧D", key("D", { ...cmd, shiftKey: true }), canvas, null],
  ["⌘Z", key("z", cmd), canvas, "undo"],
  ["Ctrl+Z", key("z", ctrl), canvas, "undo"],
  ["⌘Z in a field", key("z", cmd), field, null],
  ["⌘Z in a dialog", key("z", cmd), menu, null],
  ["⌘⇧Z", key("z", { ...cmd, shiftKey: true }), canvas, "redo"],
  [
    "Ctrl+⇧Z's capital Z",
    key("Z", { ...ctrl, shiftKey: true }),
    canvas,
    "redo",
  ],
  ["Z", key("z"), canvas, null],
]

describe("matchCanvasKey", () => {
  it.each(CASES)("%s", (_, e, target, expected) => {
    expect(matchCanvasKey(e, target, { comments: true })).toBe(expected)
  })

  it("covers every Canvas key", () => {
    const covered = new Set(CASES.map(([, , , action]) => action))
    for (const { action } of CANVAS_KEYS) expect(covered).toContain(action)
  })

  it("leaves C inert without comments (the local build)", () => {
    expect(matchCanvasKey(key("c"), canvas, { comments: false })).toBeNull()
  })

  it("never matches one keydown to two rows", () => {
    for (const [, e] of CASES) {
      const hits = CANVAS_KEYS.filter((row) => row.match(e))
      expect(hits.length).toBeLessThanOrEqual(1)
    }
  })
})

describe("canvasShortcutGroups", () => {
  it("lists exactly the Canvas keys that work, each once", () => {
    const listed = sheetActions()
    expect([...listed].sort()).toEqual(
      CANVAS_KEYS.map((row) => row.action).sort()
    )
  })

  it("prints each Canvas key with the caps its row matches", () => {
    const lines = canvasShortcutGroups({ comments: true }).flatMap(
      (g) => g.shortcuts
    )
    expect(lines.find((s) => s.label === "Zoom to fit")?.keys).toEqual([
      "⇧",
      "1",
    ])
    expect(lines.find((s) => s.label === "Show or hide chat")?.keys).toEqual([
      "⌘",
      "I",
    ])
    expect(lines.find((s) => s.label === "Pan")).toEqual({
      label: "Pan",
      keys: ["Space"],
      gesture: "Drag",
    })
  })

  it("drops the Comment tool and the Comments keys when comments are off", () => {
    const labels = (comments: boolean) =>
      canvasShortcutGroups({ comments })
        .flatMap((g) => g.shortcuts)
        .map((s) => s.label)
    expect(labels(true)).toContain("Comment")
    expect(labels(false)).not.toContain("Comment")
    expect(labels(true)).toContain("Next comment")
    expect(labels(false)).not.toContain("Next comment")
    expect(
      canvasShortcutGroups({ comments: false }).map((g) => g.title)
    ).not.toContain("Comments")
  })

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

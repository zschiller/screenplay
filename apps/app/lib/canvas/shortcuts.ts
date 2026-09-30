import { hasModKey as mod, type KeyTarget } from "@/lib/canvas/key-target"

/**
 * Canvas Shortcuts — the one table of the canvas's keyboard shortcuts, the
 * React-free matcher over it, and the `?` sheet built from it.
 *
 * Each row of {@link CANVAS_KEYS} is one shortcut: the key caps it prints, the
 * key it matches, and where it is allowed (in text entry, in the Composer, in
 * an open overlay). {@link matchCanvasKey} walks the table, so the keyboard
 * controller (`useCanvasKeyboard`) and the player only map an action to a verb;
 * the zoom menu and the sheet read their key caps from the same rows, so the
 * key a menu advertises and the key that works can't drift apart.
 */

/** Everything a Canvas key can ask for. */
export type CanvasKeyAction =
  | "escape"
  | "tool-select"
  | "tool-frame"
  | "tool-document"
  | "tool-comment"
  | "cursor-chat"
  | "zoom-in"
  | "zoom-out"
  | "zoom-to-100"
  | "zoom-to-fit"
  | "pan"
  | "toggle-sidebar"
  | "toggle-chat"
  | "toggle-panels"
  | "shortcut-sheet"
  | "delete-selection"
  | "undo"
  | "redo"

export type KeyLike = Pick<
  KeyboardEvent,
  | "key"
  | "code"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "defaultPrevented"
>

export interface CanvasKeyBinding {
  action: CanvasKeyAction
  /** Each entry renders as one key cap, e.g. `["⌘", "⇧", "Z"]`. */
  caps: readonly string[]
  /** Whether the keydown is this shortcut's key, wherever it landed. */
  match: (e: KeyLike) => boolean
  /** Fires while typing in an input, textarea or contenteditable. */
  inText?: boolean
  /**
   * Fires from the Composer though it is text entry: chat is plain text, so
   * it has no Bold or Italic for the key to mean instead.
   */
  inComposer?: boolean
  /** Fires with focus inside an open menu, dialog or listbox. */
  inOverlay?: boolean
  /** Holds off on a control focused from the keyboard, where the key presses it. */
  notOnControl?: boolean
  /** Only where there are comments (not the local build). */
  comments?: boolean
}

/** A bare letter: no ⌘ or Ctrl (Alt and Shift change the key itself). */
const plain = (key: string) => (e: KeyLike) => e.key === key && !mod(e)
/** ⌘ or Ctrl with the letter, and neither Alt nor Shift. */
const modKey =
  (...keys: string[]) =>
  (e: KeyLike) =>
    keys.includes(e.key) && mod(e) && !e.altKey && !e.shiftKey

/**
 * Every Canvas key, in match order (the first row that matches wins; no two
 * rows match the same keydown). Escape is one action here: which exit it takes
 * is the pure precedence in `lib/canvas/escape.ts`.
 */
export const CANVAS_KEYS: readonly CanvasKeyBinding[] = [
  {
    action: "escape",
    caps: ["Esc"],
    match: (e) => e.key === "Escape",
    inText: true,
    inOverlay: true,
  },
  // The ⌘ zoom keys still zoom the canvas from a field: they type nothing,
  // and would otherwise zoom the whole page.
  {
    action: "zoom-in",
    caps: ["⌘", "="],
    match: (e) =>
      mod(e) &&
      !e.altKey &&
      (e.key === "=" || e.key === "+" || e.code === "Equal"),
    inText: true,
  },
  {
    action: "zoom-out",
    caps: ["⌘", "-"],
    match: (e) =>
      mod(e) &&
      !e.altKey &&
      (e.key === "-" || e.key === "_" || e.code === "Minus"),
    inText: true,
  },
  {
    action: "zoom-to-100",
    caps: ["⌘", "0"],
    match: (e) =>
      mod(e) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key === "0" || e.code === "Digit0"),
    inText: true,
  },
  {
    action: "zoom-to-fit",
    caps: ["⇧", "1"],
    match: (e) => !mod(e) && !e.altKey && e.shiftKey && e.code === "Digit1",
  },
  {
    action: "shortcut-sheet",
    caps: ["?"],
    match: (e) => !mod(e) && !e.altKey && e.key === "?",
  },
  // The draw tools each dispatch one Tool Mode intent.
  { action: "tool-select", caps: ["V"], match: plain("v") },
  { action: "tool-comment", caps: ["C"], match: plain("c"), comments: true },
  { action: "tool-document", caps: ["D"], match: plain("d") },
  { action: "tool-frame", caps: ["F"], match: plain("f") },
  {
    action: "cursor-chat",
    caps: ["/"],
    match: (e) => e.key === "/" && !mod(e) && !e.altKey,
  },
  // In a document ⌘B is Bold and ⌘I Italic, so the panel keys leave text
  // alone. The Composer has neither, so ⌘I still closes the chat from it.
  { action: "toggle-sidebar", caps: ["⌘", "B"], match: modKey("b", "B") },
  {
    action: "toggle-chat",
    caps: ["⌘", "I"],
    match: modKey("i", "I"),
    inComposer: true,
  },
  { action: "toggle-panels", caps: ["⌘", "."], match: modKey(".") },
  {
    action: "pan",
    caps: ["Space"],
    match: (e) => e.key === " " && !e.repeat,
    notOnControl: true,
  },
  {
    action: "delete-selection",
    caps: ["⌫"],
    match: (e) => e.key === "Delete" || e.key === "Backspace",
  },
  {
    action: "undo",
    caps: ["⌘", "Z"],
    match: (e) => e.key === "z" && mod(e) && !e.shiftKey,
  },
  {
    action: "redo",
    caps: ["⌘", "⇧", "Z"],
    match: (e) => (e.key === "z" || e.key === "Z") && mod(e) && e.shiftKey,
  },
]

/**
 * The Canvas action a keydown asks for, or `null`: the first row of
 * {@link CANVAS_KEYS} whose key matches and that is allowed where the key
 * landed. A key something else already handled (`defaultPrevented`) is never
 * the canvas's. `comments` is off in the local build, which has no comment
 * tool.
 */
export function matchCanvasKey(
  e: KeyLike,
  target: KeyTarget,
  { comments }: { comments: boolean }
): CanvasKeyAction | null {
  if (e.defaultPrevented) return null
  for (const row of CANVAS_KEYS) {
    if (row.comments && !comments) continue
    // With a menu, dialog or popover open, focus sits inside it and every key
    // is its own: Backspace there must not delete the frame behind it.
    if (target.overlay && !row.inOverlay) continue
    if (target.textEntry && !row.inText && !(row.inComposer && target.composer))
      continue
    if (row.notOnControl && target.keyboardControl) continue
    if (row.match(e)) return row.action
  }
  return null
}

function capsOf(action: CanvasKeyAction): readonly string[] {
  return CANVAS_KEYS.find((row) => row.action === action)!.caps
}

/** The zoom keys, one entry per key cap, as the zoom menu and the sheet print them. */
export const ZOOM_SHORTCUTS = {
  zoomIn: capsOf("zoom-in"),
  zoomOut: capsOf("zoom-out"),
  zoomTo100: capsOf("zoom-to-100"),
  zoomToFit: capsOf("zoom-to-fit"),
}

export const SHORTCUT_SHEET_KEY = capsOf("shortcut-sheet")[0]!

export interface CanvasShortcut {
  label: string
  /** Each entry renders as one key cap, e.g. `["⌘", "⇧", "Z"]`. */
  keys: string[]
  /** A pointer action that completes the shortcut ("Click", "Drag"). It
   *  renders as plain text after the key caps, never as a key cap. */
  gesture?: string
}

export interface CanvasShortcutGroup {
  title: string
  shortcuts: CanvasShortcut[]
}

/**
 * A line on the sheet: a Canvas key from the table (its caps come from the
 * row), or a shortcut another surface handles, named by `handledBy`.
 */
type SheetLine = { label: string; gesture?: string } & (
  | { action: CanvasKeyAction }
  | {
      keys: string[]
      handledBy: "pointer" | "comments-panel" | "comment-composer" | "composer"
      comments?: boolean
    }
)

const SHEET: { title: string; lines: SheetLine[] }[] = [
  {
    title: "Tools",
    lines: [
      { label: "Select", action: "tool-select" },
      { label: "Frame", action: "tool-frame" },
      { label: "Document", action: "tool-document" },
      { label: "Comment", action: "tool-comment" },
      { label: "Cursor chat", action: "cursor-chat" },
    ],
  },
  {
    title: "View",
    lines: [
      { label: "Zoom in", action: "zoom-in" },
      { label: "Zoom out", action: "zoom-out" },
      { label: "Zoom to 100%", action: "zoom-to-100" },
      { label: "Zoom to fit", action: "zoom-to-fit" },
      {
        label: "Zoom with wheel",
        keys: ["⌘"],
        gesture: "Scroll",
        handledBy: "pointer",
      },
      { label: "Pan", action: "pan", gesture: "Drag" },
    ],
  },
  {
    title: "Panels",
    lines: [
      { label: "Toggle sidebar", action: "toggle-sidebar" },
      { label: "Toggle chat", action: "toggle-chat" },
      { label: "Toggle both panels", action: "toggle-panels" },
      { label: "Keyboard shortcuts", action: "shortcut-sheet" },
    ],
  },
  {
    title: "Comments",
    lines: [
      {
        label: "Post a comment or reply",
        keys: ["⌘", "↵"],
        handledBy: "comment-composer",
        comments: true,
      },
      {
        label: "Next comment",
        keys: ["J"],
        handledBy: "comments-panel",
        comments: true,
      },
      {
        label: "Previous comment",
        keys: ["K"],
        handledBy: "comments-panel",
        comments: true,
      },
      {
        label: "Resolve or reopen",
        keys: ["E"],
        handledBy: "comments-panel",
        comments: true,
      },
    ],
  },
  {
    title: "Edit",
    lines: [
      {
        label: "Rename a title",
        keys: [],
        gesture: "Double-click",
        handledBy: "pointer",
      },
      {
        label: "Edit a document",
        keys: [],
        gesture: "Double-click",
        handledBy: "pointer",
      },
      {
        label: "Add to selection",
        keys: ["⇧"],
        gesture: "Click",
        handledBy: "pointer",
      },
      { label: "Delete selection", action: "delete-selection" },
      { label: "Undo", action: "undo" },
      { label: "Redo", action: "redo" },
      { label: "Deselect or exit", action: "escape" },
    ],
  },
  {
    title: "Composer",
    lines: [
      { label: "Target an element", keys: ["⌘", "E"], handledBy: "composer" },
      { label: "Leave the composer", keys: ["Esc"], handledBy: "composer" },
    ],
  },
]

/**
 * Every canvas shortcut, grouped for the `?` sheet: the Canvas keys with the
 * caps their table rows match, plus the pointer, Comments and Composer
 * shortcuts other surfaces handle. `comments` is off in the local build, which
 * has no comment tool.
 */
export function canvasShortcutGroups({
  comments,
}: {
  comments: boolean
}): CanvasShortcutGroup[] {
  return SHEET.map(({ title, lines }) => ({
    title,
    shortcuts: lines.flatMap((line): CanvasShortcut[] => {
      const gesture = line.gesture ? { gesture: line.gesture } : {}
      if ("action" in line) {
        const row = CANVAS_KEYS.find((r) => r.action === line.action)!
        if (row.comments && !comments) return []
        return [{ label: line.label, keys: [...row.caps], ...gesture }]
      }
      if (line.comments && !comments) return []
      return [{ label: line.label, keys: line.keys, ...gesture }]
    }),
  })).filter((group) => group.shortcuts.length > 0)
}

/** The Canvas actions the sheet lists, for pinning it to the table. */
export function sheetActions(): CanvasKeyAction[] {
  return SHEET.flatMap(({ lines }) =>
    lines.flatMap((line) => ("action" in line ? [line.action] : []))
  )
}

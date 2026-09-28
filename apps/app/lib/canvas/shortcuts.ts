/**
 * Canvas Shortcuts — the one catalogue of the canvas's keyboard and pointer
 * shortcuts, plus the React-free matcher for the zoom keys.
 *
 * The keyboard controller (`useCanvasKeyboard`) dispatches on
 * {@link matchCanvasShortcut}; the zoom menu and the `?` shortcut sheet read
 * {@link ZOOM_SHORTCUTS} / {@link canvasShortcutGroups}, so the key a menu
 * advertises and the key that works can't drift apart.
 */

/** The zoom keys, one entry per key cap, as the zoom menu and the sheet print them. */
export const ZOOM_SHORTCUTS = {
  zoomIn: ["⌘", "="],
  zoomOut: ["⌘", "-"],
  zoomTo100: ["⌘", "0"],
  zoomToFit: ["⇧", "1"],
} as const satisfies Record<string, readonly string[]>

export const SHORTCUT_SHEET_KEY = "?"

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
 * Every canvas shortcut, grouped for the `?` sheet. `comments` is off in the
 * local build, which has no comment tool.
 */
export function canvasShortcutGroups({
  comments,
}: {
  comments: boolean
}): CanvasShortcutGroup[] {
  return [
    {
      title: "Tools",
      shortcuts: [
        { label: "Select", keys: ["V"] },
        { label: "Frame", keys: ["F"] },
        { label: "Document", keys: ["D"] },
        ...(comments ? [{ label: "Comment", keys: ["C"] }] : []),
        { label: "Cursor chat", keys: ["/"] },
      ],
    },
    {
      title: "View",
      shortcuts: [
        { label: "Zoom in", keys: [...ZOOM_SHORTCUTS.zoomIn] },
        { label: "Zoom out", keys: [...ZOOM_SHORTCUTS.zoomOut] },
        { label: "Zoom to 100%", keys: [...ZOOM_SHORTCUTS.zoomTo100] },
        { label: "Zoom to fit", keys: [...ZOOM_SHORTCUTS.zoomToFit] },
        { label: "Zoom with wheel", keys: ["⌘"], gesture: "Scroll" },
        { label: "Pan", keys: ["Space"], gesture: "Drag" },
      ],
    },
    {
      title: "Panels",
      shortcuts: [
        { label: "Toggle sidebar", keys: ["⌘", "B"] },
        { label: "Toggle chat", keys: ["⌘", "I"] },
        { label: "Toggle both panels", keys: ["⌘", "."] },
        { label: "Keyboard shortcuts", keys: [SHORTCUT_SHEET_KEY] },
      ],
    },
    ...(comments
      ? [
          {
            title: "Comments panel",
            shortcuts: [
              { label: "Next comment", keys: ["J"] },
              { label: "Previous comment", keys: ["K"] },
              { label: "Resolve or reopen", keys: ["E"] },
            ],
          },
        ]
      : []),
    {
      title: "Edit",
      shortcuts: [
        { label: "Rename a title", keys: [], gesture: "Double-click" },
        { label: "Edit a document", keys: [], gesture: "Double-click" },
        { label: "Add to selection", keys: ["⇧"], gesture: "Click" },
        { label: "Delete selection", keys: ["⌫"] },
        { label: "Undo", keys: ["⌘", "Z"] },
        { label: "Redo", keys: ["⌘", "⇧", "Z"] },
        { label: "Deselect or exit", keys: ["Esc"] },
      ],
    },
  ]
}

export type CanvasShortcutAction =
  | "zoom-in"
  | "zoom-out"
  | "zoom-to-100"
  | "zoom-to-fit"
  | "shortcut-sheet"

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>

/**
 * The zoom / sheet action a keydown asks for, or `null`. `editing` is true when
 * the key lands in an input, textarea or contenteditable: the ⌘ zoom keys still
 * zoom the canvas there (they type nothing, and would otherwise zoom the whole
 * page), while `⇧1` and `?` are left to type.
 */
export function matchCanvasShortcut(
  e: KeyLike,
  editing: boolean
): CanvasShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey
  if (e.altKey) return null
  if (mod) {
    if (e.key === "=" || e.key === "+" || e.code === "Equal") return "zoom-in"
    if (e.key === "-" || e.key === "_" || e.code === "Minus") return "zoom-out"
    if (!e.shiftKey && (e.key === "0" || e.code === "Digit0"))
      return "zoom-to-100"
    return null
  }
  if (editing) return null
  if (e.shiftKey && e.code === "Digit1") return "zoom-to-fit"
  if (e.key === SHORTCUT_SHEET_KEY) return "shortcut-sheet"
  return null
}

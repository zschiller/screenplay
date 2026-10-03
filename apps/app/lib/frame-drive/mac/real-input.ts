import type {
  DriveDone,
  DriveGesture,
  DriveModifiers,
  DriveResult,
} from "@/lib/frame-drive/contract"
import type {
  PageAnswer,
  PageAsk,
  PageCursor,
  PageLocated,
} from "@/lib/frame-drive/canvas/protocol"

/**
 * Real input on the Mac (#1385): the gestures the Sandbox Bridge can only fake
 * (focus, typing keys, Tab, rich text, hover styles, the clipboard, a file
 * picker) are played as real mouse and key events the desktop shell sends the
 * canvas window, the way a hosted frame's are played over CDP (#1396). The
 * frame's bridge still finds each target and reports what changed; the canvas
 * hands the frame the input for the moment the gesture lands
 * (`canvas/take-input.ts`).
 *
 * The shell delivers the events to the window's web view itself, so the
 * person's own pointer never moves and Screenplay never comes to the front.
 * The person's clipboard is set aside for a gesture that may use it and put
 * back after; the agent keeps what it copied for its own pastes. A file
 * picker the agent's click opens is answered with Workspace files, with no
 * panel shown; a person's own click still gets the Finder panel.
 *
 * A gesture whose point can't be hit (the frame is scrolled off the canvas,
 * covered, or the window is hidden) or that the shell can't take is played
 * through the bridge instead, gaps and all.
 */

/** One event for the canvas window, at a point in it (CSS px). */
export type NativeEvent =
  | { kind: "move"; x: number; y: number }
  | { kind: "down" | "up"; x: number; y: number; clickCount: number }
  /** A key as in `KeyboardEvent.key`; `text` is what it types, if anything. */
  | { kind: "key"; key: string; text?: string; modifiers?: DriveModifiers }
  /** An editing command, as the Edit menu runs it for ⌘C, ⌘X, ⌘V and ⌘A. */
  | { kind: "edit"; action: EditAction }

export type EditAction = "copy" | "cut" | "paste" | "selectAll"

/** The desktop shell's side: `apps/desktop/src-tauri/src/drive_input.rs`. */
export interface NativeInput {
  /** Deliver the events to the canvas window in order, without moving the
   *  person's pointer or bringing Screenplay to the front. */
  send(events: NativeEvent[]): Promise<void>
  /** Set the person's clipboard aside, with `text` on it meanwhile (the
   *  agent's own, for a paste) or nothing. */
  holdClipboard(text?: string): Promise<void>
  /** Put the person's clipboard back. The text the gesture copied, if any. */
  releaseClipboard(): Promise<string | null>
  /** Answer the next file picker the canvas opens with these files
   *  (absolute paths), with no panel shown. */
  offerFiles(paths: string[]): Promise<void>
  /** Stop offering them. Whether a picker took them. */
  withdrawFiles(): Promise<boolean>
}

/** One {@link PageAsk} of the canvas showing the frame. */
export type PageAsker = <A extends PageAsk>(
  ask: A
) => Promise<PageAnswer<A["kind"]>>

export interface RealInputDeps {
  page: PageAsker
  native: NativeInput
  /** The Workspace files a click names, as absolute paths; null when any
   *  isn't a file in the frame's Workspace. */
  files?: (paths: string[]) => Promise<string[] | null>
  /** What the agent last copied, for its pastes. */
  clipboard: { text: string | null }
  wait?: (ms: number) => Promise<void>
}

/** A page's own Copy button writes the clipboard a moment after the click. */
export const CLIPBOARD_SETTLE_MS = 150
/** At show pace, the longest a character takes, and a whole text. */
const SHOW_TYPE_MS = 90
const SHOW_TYPE_MAX_MS = 2500

const TAKEN = { status: "taken" } as const

/** Not played with real input: hand the gesture to the bridge. */
const BRIDGE = null

const EDIT_KEYS: Record<string, EditAction> = {
  c: "copy",
  x: "cut",
  v: "paste",
  a: "selectAll",
}

/**
 * Play one gesture with real input, or return null when it should go through
 * the bridge: a scroll, select or drag (the bridge's already do what a
 * person's would), or one the shell can't land.
 */
export async function runRealInput(
  op: DriveGesture,
  given: RealInputDeps
): Promise<DriveResult | null> {
  // Once any input has landed, the gesture can't be played again through the
  // bridge: a failure after that is the gesture's.
  let landed = false
  const deps: RealInputDeps = {
    ...given,
    native: {
      ...given.native,
      send: (events) => {
        landed = true
        return given.native.send(events)
      },
    },
  }
  try {
    switch (op.op) {
      case "click":
        return await click(op, deps)
      case "type":
        return await type(op, deps)
      case "key":
        return await key(op, deps)
      case "hover":
        return await hover(op, deps)
      default:
        return BRIDGE
    }
  } catch (err) {
    // The shell didn't take it (an older shell, or it went away): the
    // bridge plays it instead.
    if (!landed) return BRIDGE
    return {
      status: "failed",
      reason: `The Mac's input failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    await deps.page({ kind: "release" }).catch(() => null)
  }
}

type Op<K extends DriveGesture["op"]> = Extract<DriveGesture, { op: K }>

async function click(
  op: Op<"click">,
  deps: RealInputDeps
): Promise<DriveResult | null> {
  const { page, native } = deps
  const show = op.pace === "show"
  const at = await page({ kind: "locate", target: op.target, show })
  if (at === "taken") return TAKEN
  if (!at) return { status: "not-found", target: op.target }
  if (at.popup) return { status: "gap", gap: at.popup, target: at.target }
  let files: string[] | null = null
  if (at.file) {
    files = op.files?.length ? ((await deps.files?.(op.files)) ?? null) : null
    if (!files) return { status: "gap", gap: "file-picker", target: at.target }
  }
  if (await glide(op, at, deps)) return TAKEN
  const taken = await page({ kind: "take", at: { x: at.x, y: at.y } })
  if (taken === "taken") return TAKEN
  const p = taken?.window
  if (!p) return BRIDGE

  let picked = false
  if (files) await native.offerFiles(files)
  try {
    await native.holdClipboard()
    let copied: string | null
    try {
      await native.send([
        { kind: "move", x: p.x, y: p.y },
        { kind: "down", x: p.x, y: p.y, clickCount: 1 },
        { kind: "up", x: p.x, y: p.y, clickCount: 1 },
      ])
      await settle(deps)
    } finally {
      copied = await native.releaseClipboard()
    }
    if (copied !== null) deps.clipboard.text = copied
    if (files) picked = await native.withdrawFiles()
    return done(op, at.target, deps, {
      ...(copied !== null ? { copied } : {}),
      ...(picked ? { picked: op.files } : {}),
    })
  } finally {
    if (files && !picked) await native.withdrawFiles().catch(() => false)
  }
}

async function type(
  op: Op<"type">,
  deps: RealInputDeps
): Promise<DriveResult | null> {
  const { page, native } = deps
  const show = op.pace === "show"
  // The frame takes the keyboard first, so the bridge can focus the field.
  const taken = await page({ kind: "take" })
  if (taken === "taken") return TAKEN
  if (!taken) return BRIDGE
  const at = await page({
    kind: "locate",
    target: op.target,
    focus: "field",
    replace: !!op.replace,
    show,
  })
  if (at === "taken") return TAKEN
  if (!at) return { status: "not-found", target: op.target }
  if (at.field === false)
    return { status: "failed", reason: "the target isn't a text field" }
  if (await glide(op, at, deps)) return TAKEN

  const text = String(op.text ?? "")
  const keys: NativeEvent[] = [...text].map((ch) =>
    ch === "\n"
      ? { kind: "key", key: "Enter", text: "\r" }
      : { kind: "key", key: ch, text: ch }
  )
  // Replacing with nothing: the field's text is selected, so delete it.
  if (op.replace && keys.length === 0)
    keys.push({ kind: "key", key: "Backspace" })
  if (show) {
    const per = Math.min(
      SHOW_TYPE_MS,
      SHOW_TYPE_MAX_MS / Math.max(1, keys.length)
    )
    for (const event of keys) {
      await native.send([event])
      await (deps.wait ?? sleep)(per)
    }
  } else {
    await native.send(keys)
  }
  return done(op, at.target, deps, {}, at.target?.selector)
}

async function key(
  op: Op<"key">,
  deps: RealInputDeps
): Promise<DriveResult | null> {
  const { page, native } = deps
  const name = String(op.key ?? "").slice(0, 32)
  if (!name) return { status: "failed", reason: "missing key" }
  const show = op.pace === "show"
  const taken = await page({ kind: "take" })
  if (taken === "taken") return TAKEN
  if (!taken) return BRIDGE
  let at: PageLocated | null = null
  if (op.target) {
    const found = await page({
      kind: "locate",
      target: op.target,
      focus: "element",
      show,
    })
    if (found === "taken") return TAKEN
    if (!found) return { status: "not-found", target: op.target }
    at = found
  }
  if (await glide(op, at, deps, false)) return TAKEN

  const edit = editAction(name, op.modifiers)
  if (!edit) {
    const m = op.modifiers ?? {}
    const plain = !(m.altKey || m.ctrlKey || m.metaKey)
    const text =
      name === "Enter"
        ? "\r"
        : plain && [...name].length === 1
          ? m.shiftKey
            ? name.toUpperCase()
            : name
          : undefined
    await native.send([
      { kind: "key", key: name, text, modifiers: op.modifiers },
    ])
    return done(op, at?.target ?? null, deps)
  }

  // A paste gets the agent's own last copy, never the person's clipboard.
  await native.holdClipboard(
    edit === "paste" ? (deps.clipboard.text ?? "") : undefined
  )
  let copied: string | null
  try {
    await native.send([{ kind: "edit", action: edit }])
    await settle(deps)
  } finally {
    copied = await native.releaseClipboard()
  }
  if (copied !== null && edit !== "paste") deps.clipboard.text = copied
  return done(
    op,
    at?.target ?? null,
    deps,
    copied !== null && edit !== "paste" ? { copied } : {}
  )
}

async function hover(
  op: Op<"hover">,
  deps: RealInputDeps
): Promise<DriveResult | null> {
  const { page, native } = deps
  const at = await page({
    kind: "locate",
    target: op.target,
    show: op.pace === "show",
  })
  if (at === "taken") return TAKEN
  if (!at) return { status: "not-found", target: op.target }
  if (await glide(op, at, deps, false)) return TAKEN
  const taken = await page({ kind: "take", at: { x: at.x, y: at.y } })
  if (taken === "taken") return TAKEN
  const p = taken?.window
  if (!p) return BRIDGE
  await native.send([{ kind: "move", x: p.x, y: p.y }])
  return done(op, at.target, deps)
}

/** ⌘C, ⌘X, ⌘V and ⌘A (and nothing else held) run as editing commands. */
export function editAction(
  key: string,
  modifiers: DriveModifiers | undefined
): EditAction | null {
  const m = modifiers ?? {}
  if (!m.metaKey || m.ctrlKey || m.altKey || m.shiftKey) return null
  return EDIT_KEYS[key.toLowerCase()] ?? null
}

/**
 * At show pace, glide the agent's cursor to the target (or pause where it
 * is) and dip it for a press. True when someone took the frame meanwhile.
 */
async function glide(
  op: DriveGesture,
  at: PageLocated | null,
  deps: RealInputDeps,
  press = true
): Promise<boolean> {
  const cursor = (what: PageCursor) => deps.page({ kind: "cursor", what })
  if (op.pace !== "show") return (await cursor({ hide: true })) === "taken"
  if (
    (await cursor(at ? { to: { x: at.x, y: at.y } } : { pause: true })) ===
    "taken"
  )
    return true
  if (at && press) await cursor({ press: true })
  return false
}

/** Wait for what the gesture did to land and paint. */
async function settle(deps: RealInputDeps): Promise<void> {
  await deps.page({ kind: "state" })
  await (deps.wait ?? sleep)(CLIPBOARD_SETTLE_MS)
}

async function done(
  op: DriveGesture,
  target: PageLocated["target"],
  deps: RealInputDeps,
  extra: Partial<DriveDone> = {},
  selector?: string
): Promise<DriveResult> {
  const state = await deps.page({ kind: "state", selector })
  if (op.pace === "show")
    await deps.page({ kind: "cursor", what: { linger: true } })
  const value: DriveDone = {
    op: op.op,
    target: target ?? null,
    path: state && state !== "taken" ? state.path : "",
    ...extra,
  }
  if (state && state !== "taken" && state.value !== undefined)
    value.value = state.value
  return { status: "done", value }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

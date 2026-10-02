import type { CanvasView, CanvasViewItem } from "@/lib/agent/message-markers"

/**
 * Canvas View: what this member has selected and on screen, read once when
 * they send a chat message so the model can tell what "this" means (the
 * `Canvas view:` footer, `buildCanvasViewFooter`). The mounted Canvas
 * registers how to read it; a chat with no Canvas (a doc chat) reads `null`.
 * Nothing streams: the view is taken at send time, in the sender's browser.
 */
type CanvasViewSource = () => CanvasView | null

let source: CanvasViewSource | null = null

export const canvasViewSource = {
  /** The Canvas registers its reader on mount; the returned call unregisters. */
  register(read: CanvasViewSource): () => void {
    source = read
    return () => {
      if (source === read) source = null
    }
  },
  /** This member's view right now, or `null` with no Canvas mounted. */
  read(): CanvasView | null {
    try {
      return source?.() ?? null
    } catch {
      // The view is a hint for the model; a send never fails over it.
      return null
    }
  },
}

/** Most layers either list names, so a busy canvas can't swamp a message. */
export const CANVAS_VIEW_LIMIT = 12

/** A screen-space rectangle, as `getBoundingClientRect` gives it. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The layers on screen, largest share of the screen first. A layer counts when
 * at least a quarter of it is in view, or it fills at least a quarter of the
 * screen (a frame zoomed in past the edges): a sliver at the edge doesn't.
 */
export function layersOnScreen(
  layers: ReadonlyArray<{ id: string; rect: ScreenRect }>,
  screen: ScreenRect
): string[] {
  const screenArea = screen.width * screen.height
  if (screenArea <= 0) return []
  return layers
    .map(({ id, rect }) => {
      const area = rect.width * rect.height
      const shown = overlap(rect, screen)
      const counts =
        area > 0 && (shown / area >= 0.25 || shown / screenArea >= 0.25)
      return { id, shown: counts ? shown : 0 }
    })
    .filter((l) => l.shown > 0)
    .sort((a, b) => b.shown - a.shown)
    .map((l) => l.id)
}

function overlap(a: ScreenRect, b: ScreenRect): number {
  const w =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const h =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** The canvas records a view names its layers from. */
export interface CanvasViewRecords {
  frames: ReadonlyArray<{ id: string; label: string; branchId?: string }>
  documents: ReadonlyArray<{ id: string; title?: string }>
  mockups: ReadonlyArray<{ id: string; title?: string }>
  groups: ReadonlyArray<{ id: string; name?: string }>
  /** Workspace titles by id, for a frame's Workspace. */
  workspaceTitles: ReadonlyMap<string, string>
}

/**
 * Name the selected and on-screen ids as the footer's items: Groups first in
 * the selection, then layers in the order given. Ids no record knows (a layer
 * removed mid-send) drop out, and each list stops at {@link CANVAS_VIEW_LIMIT}.
 */
export function describeCanvasView(input: {
  sender?: string
  selectedGroupIds: Iterable<string>
  selectedLayerIds: Iterable<string>
  onScreenIds: Iterable<string>
  records: CanvasViewRecords
}): CanvasView {
  const { records } = input
  const item = (id: string): CanvasViewItem | null => {
    const frame = records.frames.find((f) => f.id === id)
    if (frame) {
      const workspace = frame.branchId
        ? records.workspaceTitles.get(frame.branchId)
        : undefined
      return {
        kind: "frame",
        id,
        name: frame.label,
        ...(workspace ? { workspace } : {}),
      }
    }
    const doc = records.documents.find((d) => d.id === id)
    if (doc) return { kind: "document", id, name: doc.title || "Untitled" }
    const mockup = records.mockups.find((m) => m.id === id)
    if (mockup) return { kind: "mockup", id, name: mockup.title || "Untitled" }
    return null
  }
  const groups = [...input.selectedGroupIds].flatMap((id) => {
    const group = records.groups.find((g) => g.id === id)
    return group
      ? [{ kind: "group" as const, id, name: group.name || "Group" }]
      : []
  })
  const named = (ids: Iterable<string>) =>
    [...new Set(ids)].map(item).filter((i): i is CanvasViewItem => i !== null)
  return {
    ...(input.sender ? { sender: input.sender } : {}),
    selected: [...groups, ...named(input.selectedLayerIds)].slice(
      0,
      CANVAS_VIEW_LIMIT
    ),
    onScreen: named(input.onScreenIds).slice(0, CANVAS_VIEW_LIMIT),
  }
}

/**
 * Comment Anchor (#785) — where a frame comment points, and the pure rules for
 * where (and whether) its pin shows for one viewer.
 *
 * A frame comment is anchored, most durable first, to:
 *
 * 1. the **Workspace** it was made in (the frame's `branchId`), so a comment
 *    outlives its frame when another frame shows the same Workspace;
 * 2. the **route** the frame was on;
 * 3. the **element**, as an {@link ElementAnchor}: id, test id, text
 *    fingerprint, then CSS path, tried in that order by the in-frame bridge;
 * 4. the **viewport** it was made in, plus a short text **snapshot** of the
 *    element, which is what a detached comment is listed with.
 *
 * Pin positions are computed per viewer from their own frame (route, scroll,
 * layout) and never written to shared state, so two viewers can't move each
 * other's pins. This module is React-, DOM- and Yjs-free: the canvas hook feeds
 * it what the bridge reported and renders what it decides.
 */

/** The element a frame comment points at, as captured by the bridge. */
export interface ElementAnchor {
  /** CSS path from the nearest id'd ancestor. The last resort. */
  path: string
  /** Lowercase tag name. A match by any other key must share it. */
  tag?: string
  /** The element's `id` attribute. */
  id?: string
  /** The element's test id (`data-testid` and friends). */
  testId?: string
  /** Whitespace-collapsed text content, cut to {@link TEXT_FINGERPRINT_MAX}. */
  text?: string
}

/** The frame's viewport size when the comment was made. */
export interface CommentViewport {
  width: number
  height: number
}

/** Longest text fingerprint the bridge captures and matches on. */
export const TEXT_FINGERPRINT_MAX = 80

/** Longest snapshot label stored with a comment. */
export const SNAPSHOT_MAX = 120

/**
 * A route's page identity: the pathname without its query, hash or trailing
 * slash. Two routes that differ only by query or hash are the same page for
 * pin placement, since the element a comment points at lives on the page.
 */
export function routePath(route: string | null | undefined): string {
  if (!route) return "/"
  let path = route
  const cut = path.search(/[?#]/)
  if (cut !== -1) path = path.slice(0, cut)
  if (!path.startsWith("/")) path = `/${path}`
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "")
  return path || "/"
}

export function sameRoute(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  return routePath(a) === routePath(b)
}

/**
 * The short label a comment is listed with once detached, from the element it
 * was made on: `button “Place order”`, or just `img` for an element with no
 * text.
 */
export function snapshotLabel(anchor: ElementAnchor | null): string | null {
  if (!anchor) return null
  const tag = anchor.tag ?? null
  const text = anchor.text?.trim() || null
  const label = text ? `${tag ?? "element"} “${text}”` : tag
  return label ? label.slice(0, SNAPSHOT_MAX) : null
}

/** The frame fields placement reads. */
export interface PlacementFrame {
  id: string
  /** The Workspace (branch) the frame shows. */
  branchId?: string
  width: number
  height: number
}

/** The thread fields placement reads. */
export interface PlacementThread {
  iframeLayerId: string | null
  workspaceId: string | null
  route: string | null
  selector: string | null
  anchor: ElementAnchor | null
  x: number | null
  y: number | null
  offsetX: number | null
  offsetY: number | null
}

/**
 * The frame a thread's pin belongs on: the frame it was made on while that
 * frame exists, otherwise the first frame showing the same Workspace. `null`
 * when neither exists.
 */
export function homeFrame<F extends PlacementFrame>(
  thread: Pick<PlacementThread, "iframeLayerId" | "workspaceId">,
  frames: ReadonlyMap<string, F>
): F | null {
  if (thread.iframeLayerId) {
    const own = frames.get(thread.iframeLayerId)
    if (own) return own
  }
  if (!thread.workspaceId) return null
  for (const frame of frames.values()) {
    if (frame.branchId === thread.workspaceId) return frame
  }
  return null
}

/** What one viewer's frame reported for a thread on the last check. */
export interface FrameView {
  /** The path this viewer's frame is showing. */
  path: string
  /** The anchored element's rect in the frame's viewport, or null if the
   *  bridge couldn't find it. */
  rect: { x: number; y: number; width: number; height: number } | null
}

/**
 * Why a comment is detached: its frame is gone, its element is gone, or it
 * never pointed at an element (a note from the retired play-mode feed, #789).
 */
export type DetachReason = "frame" | "element" | "unanchored"

/** The thread fields that say whether a thread belongs on a frame. */
export interface FrameThreadFields {
  iframeLayerId: string | null
  workspaceId: string | null
  documentId: string | null
}

/**
 * Whether a thread lives on a frame: it was made on one, or in the player on
 * one of the Workspace's pages (#789), which stores the Workspace but no frame.
 */
export function isFrameThread(t: FrameThreadFields): boolean {
  return !t.documentId && !!(t.iframeLayerId || t.workspaceId)
}

/**
 * Where one thread's pin goes for this viewer:
 *
 * - `pinned`: at `x`/`y`, local to `frameId`, with the element's box when
 *   it has one (for the open thread's outline);
 * - `offRoute`: its frame is on another route, so no pin shows; the comments
 *   menu says which route, and opening it navigates the frame there;
 * - `detached`: its frame or element is gone, so it's only listed;
 * - `pending`: nothing is known yet (frame still loading, or the element has
 *   been missing only briefly), so nothing shows.
 */
export type Placement =
  | {
      kind: "pinned"
      frameId: string
      x: number
      y: number
      element?: { x: number; y: number; width: number; height: number }
    }
  | { kind: "offRoute"; frameId: string; route: string }
  | { kind: "detached"; reason: DetachReason }
  | { kind: "pending" }

/**
 * How long an element may be missing on the right route before its comment is
 * called detached. Covers client-side rendering and hydration after a
 * navigation, when the page is up but the element isn't yet.
 */
export const DETACH_GRACE_MS = 1500

/**
 * Place one frame thread for this viewer.
 *
 * `view` is null until this viewer's frame has answered once. `missingSince` is
 * when the element was first reported missing on the right route (null while
 * it's found). Threads made before routes were stored (`route` null) show on
 * any route their element resolves on.
 */
export function placeFrameThread(input: {
  thread: PlacementThread
  frame: PlacementFrame | null
  view: FrameView | null
  missingSince: number | null
  now: number
}): Placement {
  const { thread, frame, view, missingSince, now } = input
  const tracked = !!(thread.anchor || thread.selector)
  if (!tracked) {
    // Neither an element nor a point: a note from the retired play-mode feed.
    if (thread.x === null || thread.y === null) {
      return { kind: "detached", reason: "unanchored" }
    }
    if (!frame) return { kind: "detached", reason: "frame" }
    // A click that resolved no element: a plain point on the frame.
    if (thread.route !== null) {
      if (!view) return { kind: "pending" }
      if (!sameRoute(view.path, thread.route)) {
        return { kind: "offRoute", frameId: frame.id, route: thread.route }
      }
    }
    return { kind: "pinned", frameId: frame.id, x: thread.x, y: thread.y }
  }

  if (!frame) return { kind: "detached", reason: "frame" }
  if (!view) return { kind: "pending" }
  if (thread.route !== null && !sameRoute(view.path, thread.route)) {
    return { kind: "offRoute", frameId: frame.id, route: thread.route }
  }
  if (!view.rect) {
    return missingSince !== null && now - missingSince >= DETACH_GRACE_MS
      ? { kind: "detached", reason: "element" }
      : { kind: "pending" }
  }
  const x = view.rect.x + (thread.offsetX ?? 0) * view.rect.width
  const y = view.rect.y + (thread.offsetY ?? 0) * view.rect.height
  // Scrolled out of the frame: the pin would float over the canvas outside it.
  if (x < 0 || y < 0 || x > frame.width || y > frame.height) {
    return { kind: "pending" }
  }
  return { kind: "pinned", frameId: frame.id, x, y, element: view.rect }
}

/**
 * Validate an anchor arriving at the server from a client. Returns a clean
 * copy, or null when it isn't one.
 */
export function parseElementAnchor(value: unknown): ElementAnchor | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  const str = (x: unknown, max: number) =>
    typeof x === "string" && x.length > 0 ? x.slice(0, max) : undefined
  const path = str(v.path, 2048)
  if (!path) return null
  const anchor: ElementAnchor = { path }
  const tag = str(v.tag, 64)
  const id = str(v.id, 256)
  const testId = str(v.testId, 256)
  const text = str(v.text, TEXT_FINGERPRINT_MAX)
  if (tag) anchor.tag = tag
  if (id) anchor.id = id
  if (testId) anchor.testId = testId
  if (text) anchor.text = text
  return anchor
}

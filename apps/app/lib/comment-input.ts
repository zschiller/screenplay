import {
  parseElementAnchor,
  routePath,
  snapshotLabel,
  type ElementAnchor,
} from "@/lib/comment-anchor"
import type { CreateThreadInput } from "@/lib/comments"

/** A new thread as the browser sends it: where it points and its first
 *  comment. The Room is the caller's. */
export interface NewThreadInput {
  x: number
  y: number
  iframeLayerId?: string | null
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
  /** Frame-comment anchors (#785). */
  workspaceId?: string | null
  route?: string | null
  anchor?: ElementAnchor | null
  viewportWidth?: number | null
  viewportHeight?: number | null
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  body: string
}

/**
 * A new thread from what a browser sent, checked field by field: the comment
 * server actions and a viewer's comments route (#1934) both read through it,
 * so a thread is stored the same whichever way it came.
 */
export function parseNewThread(
  raw: unknown
): Omit<CreateThreadInput, "roomId"> {
  const opts = (raw ?? {}) as Record<string, unknown>
  const anchor = parseElementAnchor(opts.anchor)
  return {
    workspaceId: shortString(opts.workspaceId, 256),
    route:
      typeof opts.route === "string" && opts.route.length <= 2048
        ? routePath(opts.route)
        : null,
    anchor,
    viewportWidth: finitePositive(opts.viewportWidth),
    viewportHeight: finitePositive(opts.viewportHeight),
    snapshot: snapshotLabel(anchor),
    x: finite(opts.x),
    y: finite(opts.y),
    iframeLayerId: shortString(opts.iframeLayerId, 256),
    selector: shortString(opts.selector, 16_384),
    offsetX: finite(opts.offsetX),
    offsetY: finite(opts.offsetY),
    documentId: shortString(opts.documentId, 256),
    anchorStart: shortString(opts.anchorStart, 16_384),
    anchorEnd: shortString(opts.anchorEnd, 16_384),
    quotedText: shortString(opts.quotedText, 100_000),
    body: typeof opts.body === "string" ? opts.body : "",
  }
}

function shortString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null
}

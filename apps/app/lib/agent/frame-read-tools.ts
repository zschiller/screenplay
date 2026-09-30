import { tool } from "ai"
import { z } from "zod"

import {
  imageModelOutput,
  type ImageToolOutput,
} from "@/lib/agent/image-output"
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import type { PageSnapshot } from "@/lib/sandbox-bridge/page-snapshot"
import { workspaceLabel } from "@/lib/workspace-label"
import type { BranchData, IframeLayerData } from "@/lib/types"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"

/**
 * Reads of a frame's running page (#1268): a screenshot (`view_frame`) and its
 * current HTML with the styles inlined (`read_frame_html`), so an agent can
 * base a mockup, or anything else, on what the app really looks like. The
 * Coordinator reads any frame; a Workspace agent only its own Workspace's.
 *
 * The tools only format; the {@link FrameReadPorts} render the page
 * (`frame-read-ports.ts` is the live side).
 */
export interface FrameReadPorts {
  /** Screenshot a frame's live preview through the Thumbnail Capturer. */
  captureFrame(preview: FramePreview): Promise<FrameImage>
  /** The frame's stored Frame Capture, or `null` when it has none. */
  readFrameCapture(frameId: string): Promise<StoredFrameCapture | null>
  /**
   * Render the frame's live preview and read its page through the Sandbox
   * Bridge, or `null` when `selector` matches nothing. Throws when the page
   * can't be read.
   */
  readFramePage(
    preview: FramePreview & { sandboxName: string },
    selector: string | undefined
  ): Promise<PageSnapshot | null>
}

/** A frame's live preview: its URL and the size it renders at. */
export type FramePreview = { url: string; width: number; height: number }

export type FrameImage = { data: Buffer; mediaType: string }

export type StoredFrameCapture = FrameImage & { capturedAt: number }

/**
 * Caps on `read_frame_html`, so one page can't flood the agent's context. The
 * markup and the CSS are capped apart, so a big stylesheet can't push the
 * page itself out.
 */
export const FRAME_HTML_LIMITS = {
  markup: 60_000,
  css: 40_000,
} as const

type Reader = {
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

/**
 * Whose frames the tools read: every frame on the canvas (the Coordinator), or
 * only the frames of the Workspace running in `sandboxName` (its own agent),
 * the same rule Element Targeting applies to a Workspace's frames.
 */
export type FrameReadScope =
  | { kind: "canvas" }
  | { kind: "workspace"; sandboxName: string }

export function buildFrameReadTools(
  ports: FrameReadPorts & Reader,
  scope: FrameReadScope
) {
  const own = scope.kind === "workspace"
  const frameIdSchema = own
    ? z
        .string()
        .optional()
        .describe(
          "The frame to read. Leave it out when your Workspace has one frame; with several, the answer lists them"
        )
    : z.string().describe("The frame id from read_canvas")
  const whose = own ? "one of your Workspace's frames" : "a frame"

  return {
    view_frame: tool({
      description: own
        ? "Look at one of your Workspace's frames on the canvas: returns a screenshot of its live preview at the frame's size, or its last stored capture when the preview isn't running. Use it to see what the user sees."
        : "Look at a frame: returns a screenshot of its live preview, or its last stored capture when the preview isn't running. Use it to check what a Workspace built.",
      inputSchema: z.object({ frameId: frameIdSchema }),
      execute: async ({ frameId }): Promise<string | ImageToolOutput> => {
        const frame = await ports.readDoc((c) => findFrame(c, scope, frameId))
        if (typeof frame === "string") return frame

        let liveProblem = "its Workspace has no running preview"
        if (frame.preview) {
          try {
            const image = await ports.captureFrame(frame.preview)
            return imageOutput(
              `Live preview of ${frame.name} at ${frame.preview.width}×${frame.preview.height}.`,
              image
            )
          } catch (err) {
            liveProblem = `the live capture failed (${errorText(err)})`
          }
        }

        const stored = await ports.readFrameCapture(frame.id).catch(() => null)
        if (stored) {
          return imageOutput(
            `Stored capture of ${frame.name} from ${new Date(stored.capturedAt).toISOString()}, not live: ${liveProblem}.`,
            stored
          )
        }
        return `No screenshot of ${frame.name}: ${liveProblem}, and it has never been captured.`
      },
      toModelOutput: imageModelOutput,
    }),

    read_frame_html: tool({
      description: `Read the page running in ${whose} as one self-contained HTML document: the rendered DOM as it is now (after scripts ran), with the CSS that styles it inlined in a <style> tag and scripts removed. Fonts and images stay as URLs, resolved by a <base> tag. Pass \`selector\` to read one part of the page. Use it as the starting point for a mockup, or to see exactly what markup a page renders. Read-only.`,
      inputSchema: z.object({
        frameId: frameIdSchema,
        selector: z
          .string()
          .optional()
          .describe(
            "A CSS selector for the one element to read, e.g. 'main' or '#pricing'. Leave it out for the whole page"
          ),
      }),
      execute: async ({ frameId, selector }) => {
        const frame = await ports.readDoc((c) => findFrame(c, scope, frameId))
        if (typeof frame === "string") return frame
        if (!frame.preview || !frame.sandboxName) {
          return `Can't read the page in ${frame.name}: its Workspace has no running preview.`
        }
        let snapshot: PageSnapshot | null
        try {
          snapshot = await ports.readFramePage(
            { ...frame.preview, sandboxName: frame.sandboxName },
            selector
          )
        } catch (err) {
          return `Couldn't read the page in ${frame.name}: ${errorText(err)}`
        }
        if (!snapshot) {
          return `Nothing in the page of ${frame.name} matches the selector ${selector}.`
        }
        return renderFrameHtml(snapshot, {
          caption: `Page HTML of ${frame.name}${selector ? `, element ${selector}` : ""}, read live at ${frame.preview.width}×${frame.preview.height}.`,
        })
      },
    }),
  }
}

export type FrameReadTools = ReturnType<typeof buildFrameReadTools>

/** For a harness reaching these tools over MCP, so none of them prompts. */
export const FRAME_READ_TOOL_ANNOTATIONS: Readonly<
  Record<keyof FrameReadTools, McpToolAnnotations>
> = {
  view_frame: { readOnlyHint: true, openWorldHint: false },
  read_frame_html: { readOnlyHint: true, openWorldHint: false },
}

type FoundFrame = {
  id: string
  /** How the answer names it: `frame [id] (/route in Workspace "Title")`. */
  name: string
  preview: FramePreview | null
  sandboxName?: string
}

/**
 * The frame to read and how to reach its preview, or the text to answer with
 * when there's none (or it isn't one the scope may read).
 */
function findFrame(
  c: RoomCollections,
  scope: FrameReadScope,
  frameId: string | undefined
): FoundFrame | string {
  let workspaceId: string | undefined
  if (scope.kind === "workspace") {
    workspaceId = records<BranchData>(c, COLLECTION_KEYS.branches).find(
      (b) => b.sandboxName === scope.sandboxName
    )?.id
    if (!workspaceId) return "This Workspace isn't on the canvas."
  }

  if (!frameId) {
    if (!workspaceId) return "Pass the frameId of the frame to read."
    const frames = records<IframeLayerData>(
      c,
      COLLECTION_KEYS.iframeLayers
    ).filter((l) => l.branchId === workspaceId)
    if (frames.length === 0) {
      return "Your Workspace has no frame on the canvas."
    }
    if (frames.length > 1) {
      return [
        "Your Workspace has several frames; pass the frameId of one:",
        ...frames.map(
          (l) =>
            `- ${l.id}: ${l.route || "/"} at ${Math.round(l.width)}×${Math.round(l.height)}`
        ),
      ].join("\n")
    }
    frameId = frames[0]!.id
  }

  const layer = c.iframeLayers.get(frameId)
  if (!layer) return `Frame not found: ${frameId}`
  if (workspaceId && layer.branchId !== workspaceId) {
    return `Frame ${frameId} isn't one of your Workspace's frames, so you can't read it.`
  }
  const branch = layer.branchId ? c.branches.get(layer.branchId) : undefined
  const route = layer.route || "/"
  const width = Math.round(layer.width)
  const height = Math.round(layer.height)
  return {
    id: frameId,
    name: `frame [${frameId}] (${route}${branch ? ` in Workspace "${workspaceLabel(branch)}"` : ""})`,
    preview: branch?.previewDomain
      ? { url: branch.previewDomain + (layer.route ?? ""), width, height }
      : null,
    sandboxName: branch?.sandboxName,
  }
}

/**
 * The snapshot as one self-contained document, under a caption line that says
 * what was read and what the caps left out.
 */
export function renderFrameHtml(
  snapshot: PageSnapshot,
  opts: { caption: string }
): string {
  const markup = capText(snapshot.markup, FRAME_HTML_LIMITS.markup)
  const css = capText(snapshot.css, FRAME_HTML_LIMITS.css, "\n")
  const notes = [
    markup.cut > 0 &&
      `The markup was cut after ${FRAME_HTML_LIMITS.markup} of ${snapshot.markup.length} characters; pass a selector to read one part of the page.`,
    css.cut > 0 &&
      `The CSS was cut after ${css.text.length} of ${snapshot.css.length} characters.`,
  ].filter(Boolean)

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<base href="${escapeAttribute(snapshot.url)}">`,
    snapshot.title && `<title>${escapeText(snapshot.title)}</title>`,
    ...snapshot.stylesheetLinks.map(
      (href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`
    ),
    css.text && `<style>\n${css.text}\n</style>`,
  ].filter(Boolean)

  return [
    opts.caption,
    ...notes,
    "",
    "<!doctype html>",
    `<html${attrs(snapshot.htmlAttributes)}>`,
    "<head>",
    ...head,
    "</head>",
    `<body${attrs(snapshot.bodyAttributes)}>`,
    markup.text,
    "</body>",
    "</html>",
  ].join("\n")
}

/** `text` cut to `max` characters, at the last `boundary` before it if given. */
function capText(
  text: string,
  max: number,
  boundary?: string
): { text: string; cut: number } {
  if (text.length <= max) return { text, cut: 0 }
  let end = max
  if (boundary) {
    const at = text.lastIndexOf(boundary, max)
    if (at > 0) end = at
  }
  return { text: text.slice(0, end), cut: text.length - end }
}

function attrs(serialized: string): string {
  return serialized ? ` ${serialized}` : ""
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
}

/** A collection's current records, read from the raw Y.Map (see room-tools). */
function records<T>(collections: RoomCollections, key: string): T[] {
  return Object.values(collections.doc.getMap(key).toJSON()) as T[]
}

function imageOutput(caption: string, image: FrameImage): ImageToolOutput {
  return {
    kind: "image",
    caption,
    data: image.data.toString("base64"),
    mediaType: image.mediaType,
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

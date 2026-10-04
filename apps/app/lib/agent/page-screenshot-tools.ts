import { tool } from "ai"
import { z } from "zod"

import {
  imageModelOutput,
  type ImageToolOutput,
} from "@/lib/agent/image-output"
import type { Files } from "@/lib/files/files"
import { formatFileSize } from "@/lib/files/paths"
import { annotateTools } from "@/lib/mcp/tool-server"
import { workspaceLabel } from "@/lib/workspace-label"
import type { BranchData } from "@/lib/types"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"

/**
 * `screenshot_page`: a screenshot of any page an agent needs, rendered in the
 * background in the Thumbnail Capturer's browser, with no frame on the canvas.
 * A route of a Workspace's dev server, at any size, or the whole page; or any
 * public web page by URL. The model sees the screenshot, and `saveAs` keeps it
 * in saved files so a document, a mockup or a later chat can use it.
 *
 * The tool only resolves and formats; the {@link PageScreenshotPorts} render
 * (`page-screenshot-ports.ts` is the live side).
 */
export interface PageScreenshotPorts {
  /**
   * Render `url` at `viewport` (or, with `fullPage`, at its width and the
   * page's full height) and return the PNG and the size it was taken at.
   * Throws when the page can't be loaded or isn't allowed.
   */
  capturePage(request: PageScreenshotRequest): Promise<PageScreenshot>
  /** The PNG made small enough for the model to see. */
  toModelImage(png: Buffer): Promise<{ data: Buffer; mediaType: string }>
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

export type PageScreenshotRequest = {
  url: string
  width: number
  height: number
  fullPage: boolean
}

export type PageScreenshot = {
  png: Buffer
  width: number
  height: number
  /** A full-page capture stopped at {@link FULL_PAGE_MAX_HEIGHT}. */
  cut?: boolean
}

/**
 * Which Workspace a route is on when the tool leaves it out: a Workspace
 * chat's own (`sandboxName`); otherwise the canvas's only running preview.
 */
export type PageScreenshotScope = { sandboxName?: string }

export interface PageScreenshotFiles {
  canvas: Files
  /** The sender's Account Files; `null` on a turn nobody sent. */
  account?: Files | null
  /** The chat the tool acts for: what a save records as its author. */
  chatId: string
}

export const PAGE_SCREENSHOT_SIZE = {
  defaultWidth: 1280,
  defaultHeight: 800,
  min: 200,
  maxWidth: 3840,
  maxHeight: 4000,
} as const

export function buildPageScreenshotTools(
  ports: PageScreenshotPorts,
  files: PageScreenshotFiles,
  scope: PageScreenshotScope = {}
) {
  const own = Boolean(scope.sandboxName)
  const tools = {
    screenshot_page: tool({
      description: [
        "Take a screenshot of a page in the background, without a frame on the canvas: a route of a Workspace’s dev server, at any size, or any public web page by URL. Pass `fullPage` for the whole scrolling page.",
        "You see the screenshot; pass `saveAs` to also keep it as a PNG in saved files, to put in a document or a mockup, or for a later chat.",
        own
          ? "Use it to check a route or a screen size your frame doesn’t show; view_frame shows the frame itself."
          : "Use it to see a route or a screen size no frame shows.",
      ].join(" "),
      inputSchema: z.object({
        route: z
          .string()
          .optional()
          .describe(
            own
              ? "The route on your Workspace’s dev server, e.g. '/pricing?plan=team'. Defaults to '/'"
              : "The route on the Workspace’s dev server, e.g. '/pricing?plan=team'. Defaults to '/'"
          ),
        workspaceId: z
          .string()
          .optional()
          .describe(
            own
              ? "Another Workspace to take the route from. Leave it out for your own"
              : "The Workspace to take the route from. Leave it out when the canvas has one running preview"
          ),
        url: z
          .string()
          .optional()
          .describe("Instead of a route: a public web page’s full http(s) URL"),
        width: z
          .number()
          .int()
          .min(PAGE_SCREENSHOT_SIZE.min)
          .max(PAGE_SCREENSHOT_SIZE.maxWidth)
          .optional()
          .describe(
            `The window width in CSS pixels, e.g. 390 for a phone. Defaults to ${PAGE_SCREENSHOT_SIZE.defaultWidth}`
          ),
        height: z
          .number()
          .int()
          .min(PAGE_SCREENSHOT_SIZE.min)
          .max(PAGE_SCREENSHOT_SIZE.maxHeight)
          .optional()
          .describe(
            `The window height. Defaults to ${PAGE_SCREENSHOT_SIZE.defaultHeight}`
          ),
        fullPage: z
          .boolean()
          .optional()
          .describe("Take the whole page, not just the window"),
        saveAs: z
          .string()
          .optional()
          .describe(
            "Also save it as a PNG at this path in saved files, e.g. 'screenshots/pricing-phone.png'. The answer gives the markdown that shows it in a document"
          ),
        scope: z
          .enum(["canvas", "account"])
          .optional()
          .describe(
            "Where `saveAs` saves: `canvas` files (the default) or the sender’s `account` files"
          ),
      }),
      execute: async (input): Promise<string | ImageToolOutput> => {
        const target = await ports.readDoc((c) =>
          resolveTarget(c, scope, input)
        )
        if (typeof target === "string") return target

        const width = input.width ?? PAGE_SCREENSHOT_SIZE.defaultWidth
        const height = input.height ?? PAGE_SCREENSHOT_SIZE.defaultHeight
        const fullPage = input.fullPage ?? false

        const scoped = input.scope === "account" ? files.account : files.canvas
        if (input.saveAs !== undefined && !scoped) {
          return "Error: nobody sent this turn, so it has no account files. Save to the `canvas` scope instead."
        }

        let shot: PageScreenshot
        try {
          shot = await ports.capturePage({
            url: target.url,
            width,
            height,
            fullPage,
          })
        } catch (err) {
          return `Couldn’t take a screenshot of ${target.name}: ${errorText(err)}`
        }

        const lines = [
          `Screenshot of ${target.name}, ${fullPage ? `the whole page at ${shot.width}×${shot.height}` : `at ${shot.width}×${shot.height}`}.`,
        ]
        if (shot.cut) {
          lines.push(
            `The page is taller than ${FULL_PAGE_MAX_HEIGHT}px, so its bottom was cut.`
          )
        }
        if (input.saveAs !== undefined && scoped) {
          const saved = await scoped.save({
            path: pngPath(input.saveAs),
            bytes: shot.png,
            mediaType: "image/png",
            fallbackMediaType: "image/png",
            author: { addedBy: "agent", addedById: files.chatId },
          })
          if (!saved.ok) {
            lines.push(`It wasn’t saved: ${saved.error}`)
          } else {
            const { entry, replaced } = saved.value
            const account = input.scope === "account"
            lines.push(
              `${replaced ? "Replaced" : "Saved"} ${entry.path} in ${account ? "account" : "canvas"} files (${formatFileSize(entry.size)}).`,
              account
                ? "Account files don’t show in documents; save to `canvas` for that."
                : `To show it in a document, put this on its own line: ${documentImage(entry.path, `Screenshot of ${target.name}`)}`
            )
          }
        }

        const image = await ports.toModelImage(shot.png)
        return {
          kind: "image",
          caption: lines.join(" "),
          data: image.data.toString("base64"),
          mediaType: image.mediaType,
        }
      },
      toModelOutput: imageModelOutput,
    }),
  }
  // It only reads pages; a save lands in saved files, never the repository.
  return annotateTools(tools, {
    screenshot_page: { destructiveHint: false, openWorldHint: true },
  })
}

export type PageScreenshotTools = ReturnType<typeof buildPageScreenshotTools>

/** A full-page capture never comes back taller than this many pixels. */
export const FULL_PAGE_MAX_HEIGHT = 12_000

type Target = { url: string; name: string }

/**
 * The URL to render and how the answer names it, or the text to answer with
 * when the input doesn't say which page.
 */
export function resolveTarget(
  c: RoomCollections,
  scope: PageScreenshotScope,
  input: { route?: string; workspaceId?: string; url?: string }
): Target | string {
  if (input.url !== undefined) {
    if (input.route !== undefined || input.workspaceId !== undefined) {
      return "Pass a `url`, or a `route` (with its `workspaceId`), not both."
    }
    let parsed: URL
    try {
      parsed = new URL(input.url)
    } catch {
      return `Not a URL: ${input.url}. Pass a full http(s) URL, or a \`route\` for a Workspace’s dev server.`
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `Only http(s) pages can be screenshot, not ${parsed.protocol} URLs.`
    }
    return { url: parsed.href, name: parsed.href }
  }

  const route = input.route?.trim() || "/"
  if (/^[a-z][a-z0-9+.-]*:/i.test(route) || route.startsWith("//")) {
    return "A `route` is a path like '/pricing'; pass a full address as `url` instead."
  }
  const path = route.startsWith("/") ? route : `/${route}`

  const branches = records<BranchData>(c, COLLECTION_KEYS.branches)
  let workspace: BranchData | undefined
  if (input.workspaceId !== undefined) {
    workspace = c.branches.get(input.workspaceId)
    if (!workspace) return `Workspace not found: ${input.workspaceId}`
  } else if (scope.sandboxName) {
    workspace = branches.find((b) => b.sandboxName === scope.sandboxName)
    if (!workspace) return "Your Workspace isn’t on the canvas any more."
  } else {
    const running = branches.filter((b) => b.previewDomain)
    if (running.length === 1) {
      workspace = running[0]
    } else if (running.length === 0) {
      return "No Workspace on the canvas has a running preview. Pass a `url` to screenshot a public page."
    } else {
      return [
        "Pass the workspaceId of the Workspace to take the route from:",
        ...running.map((b) => `- ${b.id}: "${workspaceLabel(b)}"`),
      ].join("\n")
    }
  }
  if (!workspace?.previewDomain) {
    return `Workspace "${workspace ? workspaceLabel(workspace) : input.workspaceId}" has no running preview yet.`
  }
  return {
    url: workspace.previewDomain.replace(/\/+$/, "") + path,
    name: `${path} in Workspace "${workspaceLabel(workspace)}"`,
  }
}

/**
 * The markdown that shows a canvas file in a document: a CommonMark image
 * whose destination is the file's path, in angle brackets when it has spaces
 * or parentheses. The same as the documents' own `documentImageMarkdown`.
 */
export function documentImage(path: string, alt: string): string {
  const src = /[\s()<>]/.test(path) ? `<${path}>` : path
  return `![${alt.replace(/[[\]]/g, "")}](${src})`
}

/** The save path, ending in `.png` since that's what it holds. */
export function pngPath(path: string): string {
  return /\.png$/i.test(path)
    ? path
    : `${path.replace(/\.[a-z0-9]+$/i, "")}.png`
}

/** A collection's current records, read from the raw Y.Map (see room-tools). */
function records<T>(collections: RoomCollections, key: string): T[] {
  return Object.values(collections.doc.getMap(key).toJSON()) as T[]
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

import { tool } from "ai"
import { z } from "zod"

import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import type { RoomDoc } from "@/lib/room-access"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers } from "@/lib/canvas/layout"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { MOCKUP_STATUSES } from "@/lib/types"
import { MOCKUP_STATUS_LABELS } from "@/lib/mockup-status"
import { mockupHtml } from "@/lib/yjs/mockup-html"

/**
 * A chat's Mockup tools (#1309): write a static HTML page onto the canvas as a
 * Mockup Layer, rewrite the ones this chat made, and read any Mockup's page
 * back (#1313), e.g. to build a picked take. Every Mockup records the
 * chat that made it, which is the only chat its update tool accepts and the
 * name its label shows.
 *
 * Writes go through the turn's `room.mutateDoc` and Canvas Operations, so a
 * Mockup lands exactly as one a member's client would write. They read through
 * a fresh collection view: nothing observes a server doc, so a cached one can
 * read stale.
 */
export interface MockupToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat whose turn this is: the owner of every Mockup it creates. */
  chatId: string
}

/** Longest page a Mockup takes, in characters: it lives in the Room doc. */
export const MAX_MOCKUP_HTML = 500_000

const htmlSchema = z
  .string()
  .max(MAX_MOCKUP_HTML)
  .describe(
    "The whole page: one self-contained HTML document with inline <style> and <script>. It renders in a sandboxed frame that loads nothing from the network, so inline every style, image (data: URLs or inline SVG) and font."
  )

export function buildMockupTools(ctx: MockupToolContext) {
  return {
    create_mockup: tool({
      description:
        "Draw a Mockup on the canvas: a static HTML page shown beside the live frames, for sketching a design idea without building it. It needs no dev server and appears at once, next to this chat's other Mockups, or else in the Group of this Workspace's frames. Make one Mockup per take so they sit side by side. Returns the Mockup's id, which update_mockup takes.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .max(120)
          .describe("A short name for this take, e.g. 'Option A · Toggle'"),
        html: htmlSchema,
        width: z
          .number()
          .int()
          .min(200)
          .max(4000)
          .optional()
          .describe(
            `Width in canvas pixels, the viewport the page lays out at (default ${DEFAULT_IFRAME_LAYER_WIDTH})`
          ),
        height: z
          .number()
          .int()
          .min(200)
          .max(4000)
          .optional()
          .describe(
            `Height in canvas pixels (default ${DEFAULT_IFRAME_LAYER_HEIGHT})`
          ),
      }),
      execute: async ({ title, html, width, height }) => {
        const created = await ctx.room.mutateDoc(({ doc }) => {
          const collections = createRoomCollections(doc)
          return createCanvasOps(collections).createMockup({
            html,
            title,
            width: width ?? DEFAULT_IFRAME_LAYER_WIDTH,
            height: height ?? DEFAULT_IFRAME_LAYER_HEIGHT,
            ownerChatId: ctx.chatId,
            groupId: mockupGroupFor(collections, ctx.chatId),
          })
        })
        if (!created) return "The Mockup couldn't be placed. Try again."
        return `Created Mockup "${title}" (id ${created.mockupId}).`
      },
    }),

    update_mockup: tool({
      description:
        "Change a Mockup this chat made: replace its whole page, its title, its status, or any of them. The canvas re-renders it in place. Only the chat that made a Mockup can change it.",
      inputSchema: z.object({
        mockup_id: z.string().describe("The id create_mockup returned"),
        html: htmlSchema.optional(),
        title: z.string().min(1).max(120).optional(),
        status: z
          .enum(MOCKUP_STATUSES)
          .optional()
          .describe(
            "Where this take stands, shown on its label: set-aside, current (every new Mockup starts here) or built. People on the canvas can change it too; use it however helps them follow the takes."
          ),
      }),
      execute: async ({ mockup_id, html, title, status }) => {
        if (html === undefined && title === undefined && status === undefined) {
          return "Nothing to change: pass html, title or status."
        }
        const outcome = await ctx.room.mutateDoc(({ doc }) => {
          const collections = createRoomCollections(doc)
          const mockup = collections.mockupLayers.get(mockup_id)
          if (!mockup) return "missing" as const
          if (mockup.ownerChatId !== ctx.chatId) return "not-owner" as const
          createCanvasOps(collections).updateMockup(mockup_id, {
            html,
            title,
            status,
          })
          return "updated" as const
        })
        if (outcome === "missing") return `There's no Mockup ${mockup_id}.`
        if (outcome === "not-owner") {
          return `Mockup ${mockup_id} was made by another chat, and only the chat that made a Mockup can change it. Create your own with create_mockup.`
        }
        return status
          ? `Updated Mockup ${mockup_id}; its status is ${MOCKUP_STATUS_LABELS[status]}.`
          : `Updated Mockup ${mockup_id}.`
      },
    }),

    read_mockup: tool({
      description:
        "Read Mockups back. Without an id, lists this chat's Mockups with their ids, titles and statuses. With an id, returns that Mockup's title, status and whole page, e.g. to build a picked take from it. Reads any Mockup on the canvas. Read-only.",
      inputSchema: z.object({
        mockup_id: z
          .string()
          .optional()
          .describe("The Mockup to read; leave it out to list your Mockups"),
      }),
      execute: async ({ mockup_id }) => {
        if (mockup_id === undefined) {
          const own = await ctx.room.readDoc(({ mockupLayers }) =>
            mockupLayers
              .toArray()
              .filter((m) => m.ownerChatId === ctx.chatId)
              .map((m) => ({ id: m.id, title: m.title, status: m.status }))
          )
          if (own.length === 0) return "This chat hasn't made any Mockups."
          return [
            "Your Mockups:",
            ...own.map(
              (m) =>
                `- ${m.id}: ${m.title} (${MOCKUP_STATUS_LABELS[m.status ?? "current"]})`
            ),
          ].join("\n")
        }
        const found = await ctx.room.readDoc(({ mockupLayers, doc }) => {
          const mockup = mockupLayers.get(mockup_id)
          if (!mockup) return null
          return {
            title: mockup.title,
            status: mockup.status,
            yours: mockup.ownerChatId === ctx.chatId,
            html: mockupHtml(doc, mockup_id).toString(),
          }
        })
        if (!found) return `There's no Mockup ${mockup_id}.`
        return [
          `# ${found.title}`,
          `Status: ${MOCKUP_STATUS_LABELS[found.status ?? "current"]}${found.yours ? "" : " (made by another chat)"}`,
          "",
          found.html || "(empty page)",
        ].join("\n")
      },
    }),
  }
}

/**
 * Where a chat's new Mockup lands: beside its latest Mockup, else in the Group
 * of its Workspace's first frame, else (`undefined`) in a new Group beside the
 * others.
 */
export function mockupGroupFor(
  collections: RoomCollections,
  chatId: string
): string | undefined {
  const groups = collections.iframeLayerGroups.toArray()
  const groupOf = (kind: string, ids: Set<string>) =>
    groups.find((g) =>
      getGroupMembers(g).some((m) => m.kind === kind && ids.has(m.id))
    )?.id
  const own = collections.mockupLayers
    .toArray()
    .filter((m) => m.ownerChatId === chatId)
  const latest = own.at(-1)
  if (latest) {
    const id = groupOf("mockup-layer", new Set([latest.id]))
    if (id) return id
  }
  const branchId = collections.chatSessions.get(chatId)?.branchId
  if (!branchId) return undefined
  const frames = new Set(
    collections.iframeLayers
      .toArray()
      .filter((f) => f.branchId === branchId)
      .map((f) => f.id)
  )
  return frames.size > 0 ? groupOf("iframe-layer", frames) : undefined
}

/** MCP hints for the Mockup tools on a desktop harness. */
export const MOCKUP_TOOL_ANNOTATIONS: Readonly<
  Record<string, McpToolAnnotations>
> = {
  create_mockup: { destructiveHint: false, openWorldHint: false },
  update_mockup: { destructiveHint: false, openWorldHint: false },
  read_mockup: { readOnlyHint: true, openWorldHint: false },
}

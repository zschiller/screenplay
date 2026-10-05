import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomDoc } from "@/lib/room-access"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers } from "@/lib/canvas/layout"
import {
  DEFAULT_IFRAME_LAYER_HEIGHT,
  DEFAULT_IFRAME_LAYER_WIDTH,
} from "@/lib/constants"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import { lastChangedBy } from "@/lib/canvas/layer-chat"

/**
 * A chat's Mockup tools (#1309): write a static HTML page onto the canvas as a
 * Mockup Layer, rewrite any Mockup on the canvas (#1724), and read any
 * Mockup's page back (#1313), e.g. to build a picked take. Each create or
 * update records the chat as the Mockup's `lastChangedByChatId`, which its
 * Knobs Ask and drafts go to (`lib/canvas/layer-chat`).
 *
 * Writes go through the turn's `room.mutateDoc` and Canvas Operations, so a
 * Mockup lands exactly as one a member's client would write. They read through
 * a fresh collection view: nothing observes a server doc, so a cached one can
 * read stale.
 */
export interface MockupToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat whose turn this is: what the Mockups it changes record. */
  chatId: string
}

/** Longest page a Mockup takes, in characters: it lives in the Room doc. */
export const MAX_MOCKUP_HTML = 500_000

const htmlSchema = z
  .string()
  .max(MAX_MOCKUP_HTML)
  .describe(
    'The whole page: one self-contained HTML document with inline <style> and <script>. It renders in a sandboxed frame that loads nothing from the network, so inline every style, image (data: URLs or inline SVG) and font, or name a file instead of copying it in: a `src` or `href` of `skill:<skill>/<path>` is a supporting file of a skill (e.g. a template’s shared script and styles, `<script src="skill:<skill>/<path>"></script>`), and `files:<path>` is a file in the canvas’s saved files (e.g. a screenshot screenshot_page saved, `<img src="files:screenshots/home.png">`). The canvas swaps each in when the page shows, and read_mockup returns them as written; one that doesn’t resolve loads empty. To give people live controls on it, declare knobs from a script with `screenplay.registerKnob({ id, type, label, default, ... }, (value) => { ... })` (types: slider, number, boolean, string, select, tabs, color; see the screenplay-add-knob skill); each value is also set on :root as the CSS variable --knob-<id>. To keep state everyone viewing it shares while they click through it (people can Interact with a Mockup), use `const s = screenplay.shareState(key, initial, (value) => render(value))` and `s.set(next)`; see the screenplay-share-state skill. To let a person send you their reaction from the page, call `screenplay.draft(text)` from a button’s click: it puts `text` in their composer in this chat for them to edit and send (it works only from a tap, and never sends), and their message arrives with a `Drafted on mockup:` footer naming the page. When you ask a question about this Mockup (ask_question with its mockup_id), the page can answer it: `screenplay.question((q) => render(q))` calls back at once and on every change with the open question (`{ question, options: [{ label, detail }], recommended, answer, answerable }`, where `answer` is null or `{ index }`, index null for a typed reply, and `answerable` is false while a tap can’t answer, while you drive it or while nobody has control of a live Mockup, so show “Answer in the chat” instead of the pick as sent) or null when there’s none; `screenplay.answer(index)` answers it from a click handler only, exactly as clicking the option on the card would, and returns whether it was sent. To match the app’s light or dark theme, `screenplay.theme((scheme) => render(scheme))` calls back with "light" or "dark" and on every change; until it does (and on a live Mockup), follow `prefers-color-scheme`.'
  )

export function buildMockupTools(ctx: MockupToolContext) {
  const tools = {
    create_mockup: tool({
      description:
        "Draw a Mockup on the canvas: a static HTML page shown beside the live frames, for sketching a design idea without building it. It needs no dev server and appears at once, next to this chat’s other Mockups, or else in the Group of this Workspace’s frames. Make one Mockup per take so they sit side by side. Returns the Mockup’s id, which update_mockup takes.",
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
            lastChangedByChatId: ctx.chatId,
            groupId: mockupGroupFor(collections, ctx.chatId),
          })
        })
        if (!created) return "The Mockup couldn’t be placed. Try again."
        return `Created Mockup "${title}" (id ${created.mockupId}).`
      },
    }),

    update_mockup: tool({
      description:
        "Change any Mockup on the canvas, whichever chat made it: replace its whole page, its title, or both. The canvas re-renders it in place.",
      inputSchema: z.object({
        mockup_id: z.string().describe("The id create_mockup returned"),
        html: htmlSchema.optional(),
        title: z.string().min(1).max(120).optional(),
      }),
      execute: async ({ mockup_id, html, title }) => {
        if (html === undefined && title === undefined) {
          return "Nothing to change: pass html or title."
        }
        const outcome = await ctx.room.mutateDoc(({ doc }) => {
          const collections = createRoomCollections(doc)
          const mockup = collections.mockupLayers.get(mockup_id)
          if (!mockup) return "missing" as const
          const ops = createCanvasOps(collections)
          ops.batch(() => {
            collections.mockupLayers.update(mockup_id, {
              lastChangedByChatId: ctx.chatId,
            })
            ops.updateMockup(mockup_id, { html, title })
          })
          return "updated" as const
        })
        if (outcome === "missing") return `There’s no Mockup ${mockup_id}.`
        return `Updated Mockup ${mockup_id}.`
      },
    }),

    read_mockup: tool({
      description:
        "Read Mockups back. Without an id, lists the Mockups this chat changed last, with their ids and titles. With an id, returns that Mockup’s title and whole page, e.g. to build a picked take from it. Reads any Mockup on the canvas. Read-only.",
      inputSchema: z.object({
        mockup_id: z
          .string()
          .optional()
          .describe(
            "The Mockup to read; leave it out to list the Mockups this chat changed last"
          ),
      }),
      execute: async ({ mockup_id }) => {
        if (mockup_id === undefined) {
          const own = await ctx.room.readDoc(({ mockupLayers }) =>
            mockupLayers
              .toArray()
              .filter((m) => lastChangedBy(m) === ctx.chatId)
              .map((m) => ({ id: m.id, title: m.title }))
          )
          if (own.length === 0) {
            return "No Mockup was changed last by this chat. Pass a mockup_id to read any Mockup on the canvas."
          }
          return [
            "Mockups this chat changed last:",
            ...own.map((m) => `- ${m.id}: ${m.title}`),
          ].join("\n")
        }
        const found = await ctx.room.readDoc(({ mockupLayers, doc }) => {
          const mockup = mockupLayers.get(mockup_id)
          if (!mockup) return null
          return {
            title: mockup.title,
            html: mockupHtml(doc, mockup_id).toString(),
          }
        })
        if (!found) return `There’s no Mockup ${mockup_id}.`
        return [`# ${found.title}`, "", found.html || "(empty page)"].join("\n")
      },
    }),
  }
  // MCP hints for the Mockup tools on a desktop harness.
  return annotateTools(tools, {
    create_mockup: { destructiveHint: false, openWorldHint: false },
    update_mockup: { destructiveHint: false, openWorldHint: false },
    read_mockup: { readOnlyHint: true, openWorldHint: false },
  })
}

/**
 * Where a chat's new Mockup lands: beside the latest Mockup it changed, else in the Group
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
    .filter((m) => lastChangedBy(m) === chatId)
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

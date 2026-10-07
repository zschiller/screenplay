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
import { canvasFilesOn } from "@/lib/files/canvas-files"
import {
  formatFileSize,
  isTextMediaType,
  mediaTypeFor,
} from "@/lib/files/paths"
import type { FileStore } from "@/lib/files/store"
import { MOCKUP_FOLDER_MAX_BYTES, MOCKUP_INDEX } from "@/lib/mockup-folder"
import { mockupFolderOn } from "@/lib/mockup-folder-server"
import { lastChangedBy } from "@/lib/canvas/layer-chat"
import { holdLayer } from "@/lib/agent/layer-hold"
import { layerFileOf, updateLayerFile } from "@/lib/yjs/file-views"
import {
  layerPageName,
  PAGE_PARAM_DESCRIPTION,
  pickLayerPage,
  type SenderPage,
} from "@/lib/agent/layer-page"
import { groupsOnPage, orderedPages } from "@/lib/canvas/pages"

/**
 * A chat's Mockup tools (#1309): write a static HTML page as a Mockup, on the
 * canvas or left in the chat (#1885), rewrite any Mockup (#1724), and read any
 * Mockup's page back (#1313), e.g. to build a picked take. Each create or
 * update records the chat as the Mockup's `lastChangedByChatId`, which its
 * Knobs Ask and drafts go to (`lib/canvas/layer-chat`). Each create, update
 * or read of one Mockup holds it for the rest of the turn, which shows on it as
 * the chat working: another chat's update is refused meanwhile (#1725,
 * `layer-hold.ts`).
 *
 * Writes go through the turn's `room.mutateDoc` and Canvas Operations, so a
 * Mockup lands exactly as one a member's client would write. They read through
 * a fresh collection view: nothing observes a server doc, so a cached one can
 * read stale. A Mockup's page is a folder in the file store (#1886,
 * `lib/mockup-folder`): `index.html` and the files it loads by relative path,
 * which `write_mockup_file` writes and `read_mockup` reads back.
 */
export interface MockupToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat whose turn this is: what the Mockups it changes record. */
  chatId: string
  /**
   * The page the turn's sender is on (#1842), where a new Mockup lands unless
   * it names one. Without it, the first page.
   */
  senderPage?: SenderPage
  /** The file store Mockup folders and Canvas Files keep their bytes in. */
  store: FileStore
}

/** Longest page or file one call writes, in characters. */
export const MAX_MOCKUP_HTML = 500_000

/** The most text `read_mockup` returns for one file, in characters. */
const READ_TEXT_MAX_CHARS = 100_000

const htmlSchema = z
  .string()
  .max(MAX_MOCKUP_HTML)
  .describe(
    'The whole page, the Mockup folder’s index.html. It renders in a sandboxed frame that loads nothing from the network but its own folder, so inline styles and scripts, or put them in the folder with write_mockup_file and load them by relative path (`<script src="data.js">`, `<img src="captures/home.png">`); paths built by its scripts load from the folder too. Code shared by many pages (e.g. a template’s runtime) stays in its skill: a `src` or `href` of `skill:<skill>/<path>` is a supporting file of a skill (`<script src="skill:<skill>/<path>"></script>`); read_mockup returns it as written, and one that doesn’t resolve loads empty. To give people live controls on it, declare knobs from a script with `screenplay.registerKnob({ id, type, label, default, ... }, (value) => { ... })` (types: slider, number, boolean, string, select, tabs, color; see the screenplay-add-knob skill); each value is also set on :root as the CSS variable --knob-<id>. To keep state everyone viewing it shares while they click through it (people can Interact with a Mockup), use `const s = screenplay.shareState(key, initial, (value) => render(value))` and `s.set(next)`; see the screenplay-share-state skill. To let a person send you their reaction from the page, call `screenplay.draft(text)` from a button’s click: it puts `text` in their composer in this chat for them to edit and send (it works only from a tap, and never sends), and their message arrives with a `Drafted on mockup:` footer naming the page. When you ask a question about this Mockup (ask_question with its mockup_id), the page can answer it: `screenplay.question((q) => render(q))` calls back at once and on every change with the open question (`{ question, options: [{ label, detail }], recommended, answer, answerable }`, where `answer` is null or `{ index }`, index null for a typed reply, and `answerable` is false while a tap can’t answer, while you drive it or while nobody has control of a live Mockup, so show “Answer in the chat” instead of the pick as sent) or null when there’s none; `screenplay.answer(index)` answers it from a click handler only, exactly as clicking the option on the card would, and returns whether it was sent. To match the app’s light or dark theme, `screenplay.theme((scheme) => render(scheme))` calls back with "light" or "dark" and on every change; until it does (and on a live Mockup), follow `prefers-color-scheme`.'
  )

export function buildMockupTools(ctx: MockupToolContext) {
  const folder = mockupFolderOn(ctx.room, ctx.store)
  const writePage = async (fileId: string, html: string) => {
    const wrote = await folder.write(fileId, {
      files: [{ path: MOCKUP_INDEX, bytes: new TextEncoder().encode(html) }],
    })
    return wrote.ok ? null : wrote.error
  }
  /** Hold the Mockup an id names for this chat; its file id, or why not. */
  const holdMockup = (id: string) =>
    ctx.room.mutateDoc(({ doc }) => {
      const collections = createRoomCollections(doc)
      const file = layerFileOf(collections, id)
      if (file?.kind !== "mockup") return { error: `There’s no Mockup ${id}.` }
      const refused = holdLayer(collections, ctx.chatId, file.id)
      if (refused) return { error: refused }
      updateLayerFile(collections, id, { lastChangedByChatId: ctx.chatId })
      return { fileId: file.id }
    })
  const tools = {
    create_mockup: tool({
      description:
        "Make a Mockup: a static HTML page, for sketching a design idea without building it. It needs no dev server. Every Mockup shows in your reply as a tile the person opens at full size. With `place` it also goes on the canvas at once, on the sender’s page (or the page you name), next to this chat’s other Mockups there, or else in the Group of this Workspace’s frames there; without it, it stays in this chat until someone adds it to the canvas. Decide per Mockup: place takes meant to sit beside the frames or each other on the canvas; leave off a page meant to be used at full size, like a page of options to pick from. Make one Mockup per take. Returns the Mockup’s id, which update_mockup and add_to_canvas take.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .max(120)
          .describe("A short name for this take, e.g. 'Option A · Toggle'"),
        html: htmlSchema,
        place: z
          .boolean()
          .describe(
            "Whether to put it on the canvas now (true) or leave it in this chat until someone adds it (false)"
          ),
        width: z
          .number()
          .int()
          .min(200)
          .max(4000)
          .optional()
          .describe(
            `Width in canvas pixels, the viewport the page lays out at on the canvas (default ${DEFAULT_IFRAME_LAYER_WIDTH})`
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
        page: z.string().optional().describe(PAGE_PARAM_DESCRIPTION),
      }),
      execute: async ({ title, html, width, height, page, place }) => {
        if (place === false) {
          const fileId = await ctx.room.mutateDoc(({ doc }) => {
            const collections = createRoomCollections(doc)
            const made = createCanvasOps(collections).createFile({
              kind: "mockup",
              title,
              lastChangedByChatId: ctx.chatId,
            })
            holdLayer(collections, ctx.chatId, made)
            return made
          })
          const failed = await writePage(fileId, html)
          if (failed) return failed
          return `Created Mockup "${title}" (id ${fileId}), not on the canvas.`
        }
        const senderPageId = await ctx.senderPage?.()
        const created = await ctx.room.mutateDoc(({ doc }) => {
          const collections = createRoomCollections(doc)
          const picked = pickLayerPage(collections, page, senderPageId)
          if ("error" in picked) return picked
          const made = createCanvasOps(collections, {
            currentPageId: () => picked.pageId,
          }).createMockup({
            title,
            width: width ?? DEFAULT_IFRAME_LAYER_WIDTH,
            height: height ?? DEFAULT_IFRAME_LAYER_HEIGHT,
            lastChangedByChatId: ctx.chatId,
            groupId: mockupGroupFor(collections, ctx.chatId, picked.pageId),
          })
          if (made) holdLayer(collections, ctx.chatId, made.mockupId)
          return made
        })
        if (created && "error" in created) return created.error
        if (!created) return "The Mockup couldn’t be placed. Try again."
        const failed = await writePage(created.mockupId, html)
        if (failed) return failed
        return `Created Mockup "${title}" (id ${created.mockupId}).`
      },
    }),

    update_mockup: tool({
      description:
        "Change any Mockup, on the canvas or not, whichever chat made it, unless another chat is changing it right now: replace its whole page, its title, or both. Every view of it re-renders in place. Call start_editing with its id first, before you write the page.",
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
          // A view's id or its file's (#1883): the change is the file's.
          const file = layerFileOf(collections, mockup_id)
          if (file?.kind !== "mockup") return "missing" as const
          const refused = holdLayer(collections, ctx.chatId, file.id)
          if (refused) return { refused }
          const ops = createCanvasOps(collections)
          ops.batch(() => {
            updateLayerFile(collections, mockup_id, {
              lastChangedByChatId: ctx.chatId,
            })
            ops.updateMockup(mockup_id, { title })
          })
          return { fileId: file.id }
        })
        if (outcome === "missing") return `There’s no Mockup ${mockup_id}.`
        if ("refused" in outcome) return outcome.refused
        if (html !== undefined) {
          const failed = await writePage(outcome.fileId, html)
          if (failed) return failed
        }
        return `Updated Mockup ${mockup_id}.`
      },
    }),

    read_mockup: tool({
      description:
        "Read Mockups back. Without an id, lists the Mockups this chat changed last, with their ids and titles. With an id, returns that Mockup’s title, whole page (its index.html) and the other files in its folder, e.g. to build a picked take from it; with a path too, returns that one file of its folder. Reads any Mockup, on the canvas or not. Read-only.",
      inputSchema: z.object({
        mockup_id: z
          .string()
          .optional()
          .describe(
            "The Mockup to read; leave it out to list the Mockups this chat changed last"
          ),
        path: z
          .string()
          .optional()
          .describe(
            "A file in the Mockup’s folder to read instead of its page, e.g. data.js"
          ),
      }),
      execute: async ({ mockup_id, path }) => {
        if (mockup_id === undefined) {
          const own = await ctx.room.readDoc(({ doc }) => {
            // A fresh view: a cached collection can read stale on the server.
            const c = createRoomCollections(doc)
            return (
              c.layerFiles
                .toArray()
                // One line per file, named by the file (#1883), placed or not
                // (#1885).
                .filter((f) => f.kind === "mockup")
                .filter((f) => lastChangedBy(f) === ctx.chatId)
                .map((f) => {
                  const viewId = c.mockupLayers.viewIdsOf(f.id)[0]
                  return {
                    id: f.id,
                    title: f.title,
                    page: viewId
                      ? layerPageName(c, { kind: "mockup-layer", id: viewId })
                      : undefined,
                    placed: !!viewId,
                  }
                })
            )
          })
          if (own.length === 0) {
            return "No Mockup was changed last by this chat. Pass a mockup_id to read any Mockup."
          }
          return [
            "Mockups this chat changed last:",
            ...own.map(
              (m) =>
                `- ${m.id}: ${m.title}` +
                (m.page ? ` (page "${m.page}")` : "") +
                (m.placed ? "" : " (not on the canvas)")
            ),
          ].join("\n")
        }
        const found = await ctx.room.mutateDoc(({ doc }) => {
          const collections = createRoomCollections(doc)
          const file = layerFileOf(collections, mockup_id)
          if (file?.kind !== "mockup") return null
          // Reading shows on the Mockup as work too, and holds it like a
          // change would; a read never waits on another chat's hold.
          holdLayer(collections, ctx.chatId, file.id)
          const viewId = collections.mockupLayers.has(mockup_id)
            ? mockup_id
            : collections.mockupLayers.viewIdsOf(file.id)[0]
          return {
            fileId: file.id,
            title: file.title,
            page: viewId
              ? layerPageName(collections, {
                  kind: "mockup-layer",
                  id: viewId,
                })
              : undefined,
          }
        })
        if (!found) return `There’s no Mockup ${mockup_id}.`
        if (path !== undefined) {
          await folder.ensure(found.fileId)
          const bytes = await folder.read(found.fileId, path)
          if (!bytes) return `Mockup ${mockup_id} has no file at "${path}".`
          const type = mediaTypeFor(path, "application/octet-stream")
          if (!isTextMediaType(type) && !/\.(js|mjs|css|html?)$/i.test(path)) {
            return `"${path}" is a ${formatFileSize(bytes.byteLength)} ${type} file, which the page loads by its path.`
          }
          const text = new TextDecoder().decode(bytes)
          return text.length <= READ_TEXT_MAX_CHARS
            ? text
            : `${text.slice(0, READ_TEXT_MAX_CHARS)}\n\n[Cut off at ${READ_TEXT_MAX_CHARS} of ${text.length} characters.]`
        }
        const page = await folder.page(found.fileId)
        const others = (await folder.list(found.fileId)).filter(
          (f) => f.path !== MOCKUP_INDEX
        )
        return [
          ...(found.page ? [`Page: "${found.page}"`, ""] : []),
          `# ${found.title}`,
          "",
          page?.html || "(empty page)",
          ...(others.length
            ? [
                "",
                "Other files in its folder (read one with path):",
                ...others.map((f) => `- ${f.path} (${formatFileSize(f.size)})`),
              ]
            : []),
        ].join("\n")
      },
    }),

    write_mockup_file: tool({
      description: `Write a file into a Mockup’s folder, beside its index.html, for the page to load by relative path: a data script, a stylesheet, or a capture copied from the canvas’s saved files (e.g. one screenshot_page saved). It replaces a file already at that path, and every view of the Mockup reloads. Pass delete to remove the file instead. The whole folder holds at most ${MOCKUP_FOLDER_MAX_BYTES / 1024 / 1024} MB. Call start_editing with its id first, as for update_mockup; to replace the page itself, use update_mockup.`,
      inputSchema: z.object({
        mockup_id: z.string().describe("The id create_mockup returned"),
        path: z
          .string()
          .min(1)
          .describe(
            "Where in the folder, relative to index.html, e.g. data.js or captures/home.png"
          ),
        content: z
          .string()
          .max(MAX_MOCKUP_HTML)
          .optional()
          .describe("The file’s text"),
        from_file: z
          .string()
          .optional()
          .describe(
            "Copy this saved file of the canvas instead of writing content, e.g. screenshots/home.png"
          ),
        delete: z
          .boolean()
          .optional()
          .describe("Remove the file at path instead of writing it"),
      }),
      execute: async ({
        mockup_id,
        path,
        content,
        from_file,
        delete: remove,
      }) => {
        const given = [content !== undefined, from_file !== undefined, !!remove]
        if (given.filter(Boolean).length !== 1) {
          return "Pass exactly one of content, from_file or delete."
        }
        const held = await holdMockup(mockup_id)
        if ("error" in held) return held.error
        let bytes: Uint8Array | undefined
        if (content !== undefined) bytes = new TextEncoder().encode(content)
        if (from_file !== undefined) {
          const saved = await canvasFilesOn(ctx.room, ctx.store).read(from_file)
          if (!saved.ok) return saved.error
          bytes = saved.value.bytes
        }
        const wrote = await folder.write(
          held.fileId,
          bytes ? { files: [{ path, bytes }] } : { remove: [path] }
        )
        if (!wrote.ok) return wrote.error
        return bytes
          ? `Wrote "${path}" (${formatFileSize(bytes.byteLength)}) in Mockup ${mockup_id}.`
          : `Removed "${path}" from Mockup ${mockup_id}.`
      },
    }),
  }
  // MCP hints for the Mockup tools on a desktop harness.
  return annotateTools(tools, {
    create_mockup: { destructiveHint: false, openWorldHint: false },
    update_mockup: { destructiveHint: false, openWorldHint: false },
    read_mockup: { readOnlyHint: true, openWorldHint: false },
    write_mockup_file: { destructiveHint: false, openWorldHint: false },
  })
}

/**
 * Where a chat's new Mockup lands on page `pageId`: beside the latest Mockup
 * it changed there, else in the Group of its Workspace's first frame there,
 * else (`undefined`) in a new Group beside the others on that page.
 */
export function mockupGroupFor(
  collections: RoomCollections,
  chatId: string,
  pageId: string
): string | undefined {
  const groups = groupsOnPage(
    collections.iframeLayerGroups.toArray(),
    orderedPages(collections.pages.toArray()),
    pageId
  )
  const groupOf = (kind: string, ids: Set<string>) =>
    groups.find((g) =>
      getGroupMembers(g).some((m) => m.kind === kind && ids.has(m.id))
    )?.id
  const latest = collections.mockupLayers
    .toArray()
    .filter((m) => lastChangedBy(m) === chatId)
    .map((m) => groupOf("mockup-layer", new Set([m.id])))
    .filter((id) => id !== undefined)
    .at(-1)
  if (latest) return latest
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

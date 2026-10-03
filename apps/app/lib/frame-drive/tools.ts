import { tool } from "ai"
import { z } from "zod"

import { findFrame, type FrameReadScope } from "@/lib/agent/frame-read-tools"
import { workspaceLabel } from "@/lib/workspace-label"
import {
  imageModelOutput,
  type ImageToolOutput,
} from "@/lib/agent/image-output"
import type { McpToolAnnotations } from "@/lib/mcp/tool-server"
import type {
  AgentDriveOutcome,
  AgentFrameDriver,
} from "@/lib/frame-drive/agent-driver"
import {
  DRIVE_GAPS,
  type DriveElements,
  type DriveGesture,
  type DriveTarget,
} from "@/lib/frame-drive/contract"
import { createCanvasOps } from "@/lib/canvas/ops"
import { getGroupMembers } from "@/lib/canvas/layout"
import { routeToLabel } from "@/lib/route-utils"
import type { BranchData, IframeLayerData, MockupLayerData } from "@/lib/types"
import {
  COLLECTION_KEYS,
  createRoomCollections,
  type RoomCollections,
} from "@/lib/yjs/schema"

/**
 * The agent's Frame Drive tools (#1389): the contract's gestures and reads as
 * one tool each, over whichever backend runs the frame. They drive Mockups
 * too (#1391), which run the same bridge. They only parse and phrase; Frame
 * Control and the backend live behind the driver ({@link AgentFrameDriver},
 * or on hosted one per kind of page, #1396). There is deliberately no tool
 * that runs a script in the page.
 */

/** What the tools drive through: an {@link AgentFrameDriver}, or one that
 *  hands each page to the right one. */
export type FrameDriver = Pick<
  AgentFrameDriver,
  | "run"
  | "start"
  | "screenshot"
  | "canvasUnavailable"
  | "frameUnavailable"
  | "letGo"
>

type Room = {
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
  mutateDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

/** How long `frame_open` waits for the canvas to mount the new frame. */
export const OPEN_FRAME_WAIT_MS = 10_000
const OPEN_FRAME_POLL_MS = 250

const targetSchema = z
  .object({
    selector: z
      .string()
      .optional()
      .describe("A selector from frame_elements. The surest way to hit it"),
    text: z
      .string()
      .optional()
      .describe("The element's visible label, e.g. 'Save' or 'Email'"),
    x: z.number().optional().describe("A point in the frame, in CSS px"),
    y: z.number().optional(),
  })
  .describe("What to act on: a selector, a label, or a point (x and y)")

const modifiersSchema = z
  .object({
    shiftKey: z.boolean().optional(),
    ctrlKey: z.boolean().optional(),
    altKey: z.boolean().optional(),
    metaKey: z.boolean().optional(),
  })
  .optional()

const TELL_IN_CHAT = "Tell the person in chat instead of driving."

export function buildFrameDriveTools(
  driver: FrameDriver,
  room: Room,
  scope: Extract<FrameReadScope, { kind: "chat" }>,
  opts: {
    /** Who the chat's turn is for: the person whose ask grants control. */
    asker: string
    /** Whether this runtime drives frames, or Mockups only (a hosted
     *  deployment without shared frames, #1391). */
    frames?: boolean
    sleep?: (ms: number) => Promise<void>
  }
) {
  const frames = opts.frames ?? true
  // What the tools call what they drive.
  const page = frames ? "a frame or Mockup" : "a Mockup"
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const frameId = z
    .string()
    .optional()
    .describe(
      frames
        ? "The frame or Mockup to drive. Leave it out for your Workspace's frame; with several, the answer lists them"
        : "The Mockup to drive. Leave it out when there's one; with several, the answer lists them"
    )

  /** The page's id, or the answer to give when there's no single one. */
  const resolve = async (
    id: string | undefined
  ): Promise<{ id: string; name: string } | string> => {
    const frame = await room.readDoc((c) => findDrivable(c, scope, id, frames))
    if (typeof frame !== "string") return frame
    // Just after the canvas closes, the room can read as empty for a moment:
    // say the canvas isn't open rather than that it has no frames.
    const closed = await driver.canvasUnavailable()
    return closed ? `Can't drive frames: ${closed} ${TELL_IN_CHAT}` : frame
  }

  const gesture = async (
    id: string | undefined,
    op: DriveGesture
  ): Promise<string> => {
    const frame = await resolve(id)
    if (typeof frame === "string") return frame
    return phrase(frame.name, await driver.run(frame.id, op))
  }

  return {
    frame_start_driving: tool({
      description: `Start driving ${page} because the person asked you in chat to show them something or to get it into a state. Their ask lets you drive, so they get no second prompt. Pick \`pace\` from what they asked: \`show\` for "show me" (a cursor glides to each target and pauses before acting, and it's brought into their view), \`jump\` for "get it into that state" (every step at once, and nobody's view moves). Call it before your first step; it sets the pace of every step until frame_stop_driving.`,
      inputSchema: z.object({
        frameId,
        pace: z
          .enum(["show", "jump"])
          .describe(
            "show: a watchable demo with a gliding cursor; jump: straight to the end state"
          ),
      }),
      execute: async ({ frameId, pace }) => {
        const frame = await resolve(frameId)
        if (typeof frame === "string") return frame
        const outcome = await driver.start(frame.id, {
          asker: opts.asker,
          pace,
        })
        switch (outcome.status) {
          case "driving":
            return pace === "show"
              ? `Driving ${frame.name} at a watchable pace, and brought it into the person's view. Say what you're about to show in one short line, then read frame_elements.`
              : `Driving ${frame.name} straight to the end state; nobody's view moved. Read frame_elements.`
          case "wait":
            return waitLine(frame.name, outcome)
          case "unavailable":
            return `Can't drive ${frame.name}: ${outcome.reason} ${TELL_IN_CHAT}`
          case "failed":
            return `Couldn't drive ${frame.name}: ${outcome.reason}`
        }
      },
    }),

    ...(frames && {
      frame_open: tool({
        description:
          "Open a new frame showing your Workspace beside its other frames, to drive when no frame fits: rather than taking over a frame the person is using for something else. Pass `route` to open it on a page. Returns the new frame's id once the canvas has it; then call frame_start_driving with it.",
        inputSchema: z.object({
          route: z
            .string()
            .optional()
            .describe("The page to open, e.g. '/settings'. Defaults to '/'"),
        }),
        execute: async ({ route }) => {
          const closed = await driver.canvasUnavailable()
          if (closed)
            return `Can't open a frame to drive: ${closed} ${TELL_IN_CHAT}`
          const opened = await room.mutateDoc((c) =>
            openWorkspaceFrame(c, scope.sandboxName, route)
          )
          if (typeof opened === "string") return opened
          const name = `frame [${opened.id}] (${opened.route})`
          // The canvas mounts it once the Room syncs; wait so the first step
          // doesn't find it missing.
          const deadline = Date.now() + OPEN_FRAME_WAIT_MS
          while ((await driver.frameUnavailable(opened.id)) !== null) {
            if (Date.now() >= deadline) {
              return `Opened ${name} beside your Workspace's frames, but the canvas hasn't loaded it yet. Try frame_start_driving with frameId "${opened.id}" in a moment.`
            }
            await sleep(OPEN_FRAME_POLL_MS)
          }
          return `Opened ${name} beside your Workspace's frames. Call frame_start_driving with frameId "${opened.id}"; its page may take a moment to load.`
        },
      }),
    }),

    frame_elements: tool({
      description: `Read what can be acted on in ${page} on the canvas: its links, buttons, fields and other controls, each with a selector to target it by, plus the page's path and title. Pass \`selector\` to also read one element's text and value. Read this before acting, and again after a step to see what changed. Read-only.`,
      inputSchema: z.object({
        frameId,
        selector: z
          .string()
          .optional()
          .describe("Also read this element's text, e.g. 'main' or '#total'"),
      }),
      execute: async ({ frameId, selector }) => {
        const frame = await resolve(frameId)
        if (typeof frame === "string") return frame
        const result = await driver.run(frame.id, { op: "elements", selector })
        if (result.status !== "read") return phrase(frame.name, result)
        return renderElements(frame.name, result.value)
      },
    }),

    frame_screenshot: tool({
      description: `Look at ${page} exactly as the person sees it on the canvas, in the state you drove it to. Use it to check each step.${frames ? " (view_frame renders a fresh copy of a frame's page instead, so it doesn't show what you did.)" : ""} Read-only.`,
      inputSchema: z.object({ frameId }),
      execute: async ({ frameId }): Promise<string | ImageToolOutput> => {
        const frame = await resolve(frameId)
        if (typeof frame === "string") return frame
        const result = await driver.screenshot(frame.id)
        if (result.status !== "shot") {
          return `No screenshot of ${frame.name}: ${result.reason}`
        }
        return {
          kind: "image",
          caption: [`${frame.name} as shown on the canvas.`, result.shot.note]
            .filter(Boolean)
            .join(" "),
          data: result.shot.data.toString("base64"),
          mediaType: result.shot.mediaType,
        }
      },
      toModelOutput: imageModelOutput,
    }),

    frame_click: tool({
      description: `Click an element in ${page}, as a person would. Links follow, buttons and menus open, checkboxes toggle. Find the target with frame_elements first.`,
      inputSchema: z.object({ frameId, target: targetSchema }),
      execute: ({ frameId, target }) =>
        gesture(frameId, { op: "click", target: cleanTarget(target) }),
    }),

    frame_type: tool({
      description: `Type text into a field in ${page} (an input or a textarea). Adds to what's there, or replaces it with \`replace\`.`,
      inputSchema: z.object({
        frameId,
        target: targetSchema,
        text: z.string(),
        replace: z
          .boolean()
          .optional()
          .describe("Replace the field's value instead of adding to it"),
      }),
      execute: ({ frameId, target, text, replace }) =>
        gesture(frameId, {
          op: "type",
          target: cleanTarget(target),
          text,
          replace,
        }),
    }),

    frame_key: tool({
      description: `Press a key in ${page}, e.g. 'Enter' (submits a field's form), 'Escape', 'ArrowDown', or a shortcut with modifiers. Sent to \`target\`, or to the page. To enter text, use frame_type.`,
      inputSchema: z.object({
        frameId,
        key: z.string().describe("A key name as in KeyboardEvent.key"),
        modifiers: modifiersSchema,
        target: targetSchema.optional(),
      }),
      execute: ({ frameId, key, modifiers, target }) =>
        gesture(frameId, {
          op: "key",
          key,
          modifiers,
          target: target ? cleanTarget(target) : undefined,
        }),
    }),

    frame_scroll: tool({
      description: `Scroll the page of ${page}, or the scrolling area around \`target\`, by dx and dy CSS px (positive dy scrolls down).`,
      inputSchema: z.object({
        frameId,
        dx: z.number().optional(),
        dy: z.number().optional(),
        target: targetSchema.optional(),
      }),
      execute: ({ frameId, dx, dy, target }) =>
        gesture(frameId, {
          op: "scroll",
          dx,
          dy,
          target: target ? cleanTarget(target) : undefined,
        }),
    }),

    frame_select: tool({
      description: `Pick an option in a native <select> in ${page}, by its value or its text. For a custom dropdown, click it, then click the option.`,
      inputSchema: z.object({
        frameId,
        target: targetSchema,
        value: z.string(),
      }),
      execute: ({ frameId, target, value }) =>
        gesture(frameId, { op: "select", target: cleanTarget(target), value }),
    }),

    frame_drag: tool({
      description: `Drag an element in ${page} onto another element or point: sliders, sortable lists, drag and drop.`,
      inputSchema: z.object({
        frameId,
        target: targetSchema,
        to: targetSchema.describe("Where to drop it"),
      }),
      execute: ({ frameId, target, to }) =>
        gesture(frameId, {
          op: "drag",
          target: cleanTarget(target),
          to: cleanTarget(to),
        }),
    }),

    frame_hover: tool({
      description: `Rest the pointer on an element in ${page}, as a person would, without clicking: tooltips, hover cards and hover menus open, and hover styles show. The pointer stays there until your next click, drag or hover moves it.`,
      inputSchema: z.object({ frameId, target: targetSchema }),
      execute: ({ frameId, target }) =>
        gesture(frameId, { op: "hover", target: cleanTarget(target) }),
    }),

    frame_stop_driving: tool({
      description: `Hand ${page} back when you're done driving it, so it no longer shows you as its driver.`,
      inputSchema: z.object({ frameId }),
      execute: async ({ frameId }) => {
        const frame = await resolve(frameId)
        if (typeof frame === "string") return frame
        await driver.letGo(frame.id)
        return `Stopped driving ${frame.name}.`
      },
    }),
  }
}

export type FrameDriveTools = ReturnType<typeof buildFrameDriveTools>

/** For a harness reaching these tools over MCP, so none of them prompts. */
export const FRAME_DRIVE_TOOL_ANNOTATIONS: Readonly<
  Record<keyof FrameDriveTools, McpToolAnnotations>
> = {
  frame_start_driving: { destructiveHint: false, openWorldHint: false },
  frame_open: { destructiveHint: false, openWorldHint: false },
  frame_elements: { readOnlyHint: true, openWorldHint: false },
  frame_screenshot: { readOnlyHint: true, openWorldHint: false },
  frame_click: { destructiveHint: false, openWorldHint: false },
  frame_type: { destructiveHint: false, openWorldHint: false },
  frame_key: { destructiveHint: false, openWorldHint: false },
  frame_scroll: { destructiveHint: false, openWorldHint: false },
  frame_select: { destructiveHint: false, openWorldHint: false },
  frame_drag: { destructiveHint: false, openWorldHint: false },
  frame_hover: { destructiveHint: false, openWorldHint: false },
  frame_stop_driving: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}

/**
 * What a drive tool acts on: the frame or Mockup named by `id`, else the one
 * there is to drive (the Workspace's own frame, or the canvas's only frame or
 * Mockup), else a list to pick from. Frames hosted can't drive yet still
 * resolve, so the backend says why.
 */
export function findDrivable(
  c: RoomCollections,
  scope: Extract<FrameReadScope, { kind: "chat" }>,
  id: string | undefined,
  frames: boolean
): { id: string; name: string } | string {
  const mockupName = (m: MockupLayerData) =>
    `Mockup [${m.id}]${m.title ? ` ("${m.title}")` : ""}`
  if (id) {
    const mockup = c.mockupLayers.get(id)
    if (mockup) return { id, name: mockupName(mockup) }
    if (!c.iframeLayers.get(id))
      return `There's no frame or Mockup ${id} on the canvas.`
    const frame = findFrame(c, scope, id)
    return typeof frame === "string" ? frame : { id, name: frame.name }
  }

  // Read off the raw maps: a server doc's collection snapshots can be stale.
  const mockups = records<MockupLayerData>(c, COLLECTION_KEYS.mockupLayers)
  if (!frames) {
    if (mockups.length === 1)
      return { id: mockups[0]!.id, name: mockupName(mockups[0]!) }
    if (mockups.length === 0)
      return "There are no Mockups on the canvas to drive."
    return [
      "Pass the frameId of the Mockup to drive:",
      ...mockups.map(
        (m) => `- ${m.id}: Mockup${m.title ? ` "${m.title}"` : ""}`
      ),
    ].join("\n")
  }

  const allFrames = records<IframeLayerData>(c, COLLECTION_KEYS.iframeLayers)
  const branches = records<BranchData>(c, COLLECTION_KEYS.branches)
  const workspaceId = scope.sandboxName
    ? branches.find((b) => b.sandboxName === scope.sandboxName)?.id
    : undefined
  const mine = workspaceId
    ? allFrames.filter((l) => l.branchId === workspaceId)
    : []
  const only =
    mine.length === 1
      ? mine[0]!.id
      : mine.length === 0 && allFrames.length + mockups.length === 1
        ? (allFrames[0]?.id ?? mockups[0]!.id)
        : null
  if (only) return findDrivable(c, scope, only, frames)
  if (allFrames.length + mockups.length === 0)
    return "There are no frames or Mockups on the canvas."
  const titles = new Map(branches.map((b) => [b.id, workspaceLabel(b)]))
  const frameLine = (l: IframeLayerData) =>
    `- ${l.id}: frame ${l.route || "/"}${l.branchId && titles.has(l.branchId) ? ` in Workspace "${titles.get(l.branchId)}"` : ""}`
  return [
    mine.length > 1
      ? "Your Workspace has several frames; pass the frameId of one:"
      : "Pass the frameId of the frame or Mockup to drive:",
    // Its own frames first, then the rest of the canvas.
    ...[...mine, ...allFrames.filter((l) => !mine.includes(l))].map(frameLine),
    ...mockups.map((m) => `- ${m.id}: Mockup${m.title ? ` "${m.title}"` : ""}`),
  ].join("\n")
}

function records<T>(c: RoomCollections, key: string): T[] {
  return Object.values(c.doc.getMap(key).toJSON()) as T[]
}

/** Zod leaves absent keys out already; drop empty strings too. */
function cleanTarget(target: DriveTarget): DriveTarget {
  const out: DriveTarget = {}
  if (target.selector) out.selector = target.selector
  if (target.text) out.text = target.text
  if (typeof target.x === "number" && typeof target.y === "number") {
    out.x = target.x
    out.y = target.y
  }
  return out
}

/** One outcome as the line the agent reads. */
export function phrase(frameName: string, outcome: AgentDriveOutcome): string {
  switch (outcome.status) {
    case "done": {
      const v = outcome.value
      const on = v.target
        ? ` ${v.target.tag}${v.target.label ? ` "${v.target.label}"` : ""}`
        : ""
      const extra = [
        v.value !== undefined && `Its value is now ${JSON.stringify(v.value)}.`,
        v.scrolled &&
          `Scrolled to ${Math.round(v.scrolled.x)}, ${Math.round(v.scrolled.y)}.`,
        v.emulated &&
          `Screenplay ran the browser's default for it (${v.emulated}).`,
      ].filter(Boolean)
      return [
        `Did ${v.op} on${on || " the page"} in ${frameName}. The page is at ${v.path}.`,
        ...extra,
      ].join(" ")
    }
    case "read":
      return renderElements(frameName, outcome.value)
    case "gap":
      return `Couldn't ${outcome.target ? `act on ${outcome.target.tag}${outcome.target.label ? ` "${outcome.target.label}"` : ""}` : "do that"} in ${frameName}: ${DRIVE_GAPS[outcome.gap]} If the step needs it, ask the person in chat to do it in the frame and to tell you when it's done, then stop and wait for their reply before you carry on.`
    case "not-found":
      return `Nothing in ${frameName} matches ${JSON.stringify(outcome.target)}. Read frame_elements for a selector.`
    case "taken":
    case "wait":
      return waitLine(frameName, outcome)
    case "unavailable":
      return `Can't drive ${frameName}: ${outcome.reason} ${TELL_IN_CHAT}`
    case "failed":
      return `Couldn't drive ${frameName}: ${outcome.reason}`
  }
}

/**
 * Open a new frame for the Workspace whose Sandbox is `sandboxName`, at the
 * end of the Group its last frame is in (beside its frames), or in a new
 * Group of its own when it has none. The new frame or the error to answer.
 */
export function openWorkspaceFrame(
  collections: RoomCollections,
  sandboxName: string | undefined,
  route: string | undefined
): { id: string; route: string } | string {
  // A fresh view: nothing observes a server doc, so a cached one reads stale.
  const c = createRoomCollections(collections.doc)
  const branch = sandboxName
    ? c.branches.toArray().find((b) => b.sandboxName === sandboxName)
    : undefined
  if (!branch) return "Error: this chat has no Workspace to open a frame for."
  const path = route ? (route.startsWith("/") ? route : `/${route}`) : "/"
  const label = routeToLabel(path)
  const ops = createCanvasOps(c)
  const mine = new Set(
    c.iframeLayers
      .toArray()
      .filter((l) => l.branchId === branch.id)
      .map((l) => l.id)
  )
  const group = c.iframeLayerGroups
    .toArray()
    .find((g) => getGroupMembers(g).some((m) => mine.has(m.id)))
  // The size of its last frame in that Group, as the canvas's "add frame".
  const lastId = group
    ? getGroupMembers(group)
        .filter((m) => mine.has(m.id))
        .at(-1)?.id
    : undefined
  const last = lastId ? c.iframeLayers.get(lastId) : undefined
  let id: string | undefined
  if (last && group) {
    id = ops.addFrameToGroup(group.id, {
      width: last.width,
      height: last.height,
      label,
      branchId: branch.id,
      ...(path !== "/" ? { route: path } : {}),
    })
  } else {
    id = ops.createFrameForAgent(branch.id, { x: 0, y: 0 }, label).layerId
    if (path !== "/") c.iframeLayers.update(id, { route: path })
  }
  if (!id) return "Error: couldn't add a frame beside your Workspace's frames."
  return { id, route: path }
}

function waitLine(
  frameName: string,
  outcome:
    | Extract<AgentDriveOutcome, { status: "taken" | "wait" }>
    | { status: "wait"; driver: string | null; takenOver: boolean }
): string {
  if (outcome.status === "taken" || outcome.takenOver) {
    return `Someone took control of ${frameName}, so that step didn't run. Stop driving it: tell them in chat where you got to, and ask before you carry on. You'll get the frame back when they leave Interact.`
  }
  return `Someone is interacting with ${frameName}, so you can't drive it now. Ask in chat for them to leave Interact (Esc) if they want you to carry on; you'll get the frame when they do.`
}

function renderElements(frameName: string, page: DriveElements): string {
  const lines = [
    `${frameName} is at ${page.path}${page.title ? ` ("${page.title}")` : ""}, viewport ${page.viewport.width}×${page.viewport.height}, scrolled to ${Math.round(page.scroll.x)}, ${Math.round(page.scroll.y)}.`,
  ]
  if (page.read !== undefined) {
    lines.push(
      page.read === null
        ? "The selector matches nothing."
        : [
            `The element reads: ${JSON.stringify(page.read.text)}`,
            page.read.value !== undefined &&
              `value ${JSON.stringify(page.read.value)}`,
            page.read.checked !== undefined && `checked ${page.read.checked}`,
          ]
            .filter(Boolean)
            .join(", ")
    )
  }
  if (page.elements.length === 0) {
    lines.push("Nothing on the page can be acted on.")
    return lines.join("\n")
  }
  lines.push(
    "What can be acted on (↓ = out of view; scroll or act on it directly):"
  )
  for (const e of page.elements) {
    const kind = [e.tag, e.type && `[${e.type}]`, e.role && `{${e.role}}`]
      .filter(Boolean)
      .join("")
    const state = [
      e.value !== undefined && e.value !== "" && `= ${JSON.stringify(e.value)}`,
      e.checked !== undefined && (e.checked ? "checked" : "unchecked"),
      e.disabled && "disabled",
    ]
      .filter(Boolean)
      .join(" ")
    lines.push(
      `${e.inViewport ? "-" : "↓"} ${kind} ${JSON.stringify(e.label)}${state ? ` ${state}` : ""}  ${e.selector}`
    )
  }
  return lines.join("\n")
}

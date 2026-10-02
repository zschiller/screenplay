import { tool } from "ai"
import { z } from "zod"

import { findFrame, type FrameReadScope } from "@/lib/agent/frame-read-tools"
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
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The agent's Frame Drive tools (#1389): the contract's gestures and reads as
 * one tool each, over whichever backend runs the frame. They only parse and
 * phrase; Frame Control and the backend live behind {@link AgentFrameDriver}.
 * There is deliberately no tool that runs a script in the page.
 */

type Reader = {
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

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

export function buildFrameDriveTools(
  driver: AgentFrameDriver,
  reader: Reader,
  scope: Extract<FrameReadScope, { kind: "chat" }>
) {
  const frameId = z
    .string()
    .optional()
    .describe(
      "The frame to drive. Leave it out for your Workspace's frame; with several frames, the answer lists them"
    )

  /** The frame's id, or the answer to give when there's no single one. */
  const resolve = async (
    id: string | undefined
  ): Promise<{ id: string; name: string } | string> => {
    return reader.readDoc((c) => findFrame(c, scope, id))
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
    frame_elements: tool({
      description:
        "Read what can be acted on in a frame the person has open on the Mac: its links, buttons, fields and other controls, each with a selector to target it by, plus the page's path and title. Pass `selector` to also read one element's text and value. Read this before acting, and again after a step to see what changed. Read-only.",
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
      description:
        "Look at a frame exactly as the person sees it on the canvas, in the state you drove it to. Use it to check each step. (view_frame renders a fresh copy of the page instead, so it doesn't show what you did.) Read-only.",
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
      description:
        "Click an element in a frame the person has open, as they would. Links follow, buttons and menus open, checkboxes toggle. Find the target with frame_elements first.",
      inputSchema: z.object({ frameId, target: targetSchema }),
      execute: ({ frameId, target }) =>
        gesture(frameId, { op: "click", target: cleanTarget(target) }),
    }),

    frame_type: tool({
      description:
        "Type text into a field in a frame (an input or a textarea). Adds to what's there, or replaces it with `replace`.",
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
      description:
        "Press a key in a frame, e.g. 'Enter' (submits a field's form), 'Escape', 'ArrowDown', or a shortcut with modifiers. Sent to `target`, or to the page. To enter text, use frame_type.",
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
      description:
        "Scroll a frame's page, or the scrolling area around `target`, by dx and dy CSS px (positive dy scrolls down).",
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
      description:
        "Pick an option in a native <select> in a frame, by its value or its text. For a custom dropdown, click it, then click the option.",
      inputSchema: z.object({
        frameId,
        target: targetSchema,
        value: z.string(),
      }),
      execute: ({ frameId, target, value }) =>
        gesture(frameId, { op: "select", target: cleanTarget(target), value }),
    }),

    frame_drag: tool({
      description:
        "Drag an element in a frame onto another element or point: sliders, sortable lists, drag and drop.",
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

    frame_stop_driving: tool({
      description:
        "Hand a frame back when you're done driving it, so it no longer shows you as its driver.",
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
  frame_elements: { readOnlyHint: true, openWorldHint: false },
  frame_screenshot: { readOnlyHint: true, openWorldHint: false },
  frame_click: { destructiveHint: false, openWorldHint: false },
  frame_type: { destructiveHint: false, openWorldHint: false },
  frame_key: { destructiveHint: false, openWorldHint: false },
  frame_scroll: { destructiveHint: false, openWorldHint: false },
  frame_select: { destructiveHint: false, openWorldHint: false },
  frame_drag: { destructiveHint: false, openWorldHint: false },
  frame_stop_driving: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
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
      return `Couldn't ${outcome.target ? `act on ${outcome.target.tag}${outcome.target.label ? ` "${outcome.target.label}"` : ""}` : "do that"} in ${frameName}: ${DRIVE_GAPS[outcome.gap]} If the step needs it, ask the person to do it in the frame, then carry on.`
    case "not-found":
      return `Nothing in ${frameName} matches ${JSON.stringify(outcome.target)}. Read frame_elements for a selector.`
    case "taken":
    case "wait":
      return waitLine(frameName, outcome)
    case "unavailable":
      return `Can't drive ${frameName}: ${outcome.reason} Tell the person in chat instead of driving.`
    case "failed":
      return `Couldn't drive ${frameName}: ${outcome.reason}`
  }
}

function waitLine(
  frameName: string,
  outcome: Extract<AgentDriveOutcome, { status: "taken" | "wait" }>
): string {
  if (outcome.status === "taken" || outcome.takenOver) {
    return `The person took control of ${frameName}, so that step didn't run. Stop driving it: tell them in chat where you got to, and ask before you carry on. You'll get the frame back when they leave Interact.`
  }
  return `The person is interacting with ${frameName}, so you can't drive it now. Ask them in chat to leave Interact (Esc) if they want you to carry on; you'll get the frame when they do.`
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

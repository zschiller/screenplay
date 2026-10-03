import * as Y from "yjs"
import { describe, expect, it } from "vitest"

import {
  AgentFrameDriver,
  memoryFrameControlStore,
} from "@/lib/frame-drive/agent-driver"
import {
  DRIVE_GAPS,
  DRIVE_OPS,
  type DriveOp,
  type DriveResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import {
  buildFrameDriveTools,
  FRAME_DRIVE_TOOL_ANNOTATIONS,
  phrase,
} from "@/lib/frame-drive/tools"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"

const EVAL_LIKE = /eval|script|exec|run_js|javascript|inject|function/i

function room({ empty = false } = {}) {
  const doc = new Y.Doc()
  const c = createRoomCollections(doc)
  if (empty)
    return {
      readDoc: async <T>(fn: (c: RoomCollections) => T | Promise<T>) => fn(c),
    }
  c.branches.set("b1", {
    id: "b1",
    sandboxName: "sb-1",
    title: "Checkout",
  } as never)
  c.iframeLayers.set("f1", {
    id: "f1",
    branchId: "b1",
    route: "/",
    width: 800,
    height: 600,
  } as never)
  return {
    readDoc: async <T>(fn: (c: RoomCollections) => T | Promise<T>) => fn(c),
  }
}

function tools(
  answer: (op: DriveOp) => DriveResult,
  unavailable?: string,
  { empty = false } = {}
) {
  const ops: DriveOp[] = []
  const backend: FrameDriveBackend = {
    unavailable: async () => unavailable ?? null,
    run: async (_id, op) => {
      ops.push(op)
      return answer(op)
    },
    screenshot: async () => ({
      status: "shot",
      shot: {
        data: Buffer.from("img"),
        mediaType: "image/png",
        note: "At 50% zoom.",
      },
    }),
  }
  const driver = new AgentFrameDriver({
    backend,
    store: memoryFrameControlStore(),
    keyOf: (id) => id,
    presence: () => ({ online: new Set(), goneAt: new Map() }),
  })
  return {
    ops,
    tools: buildFrameDriveTools(driver, room({ empty }), {
      kind: "chat",
      sandboxName: "sb-1",
    }),
  }
}

type Exec = { execute?: (input: unknown, opts: unknown) => unknown }
const call = (t: unknown, input: unknown) =>
  (t as Exec).execute!(input, { toolCallId: "t", messages: [] })

describe("Frame Drive tools", () => {
  it("has no tool or op that runs a script in the page", () => {
    const { tools: all } = tools(() => ({ status: "failed", reason: "" }))
    for (const name of Object.keys(all)) expect(name).not.toMatch(EVAL_LIKE)
    for (const op of DRIVE_OPS) expect(op).not.toMatch(EVAL_LIKE)
    expect(Object.keys(FRAME_DRIVE_TOOL_ANNOTATIONS).sort()).toEqual(
      Object.keys(all).sort()
    )
  })

  it("drives the Workspace's own frame by default", async () => {
    const { tools: t, ops } = tools(() => ({
      status: "done",
      value: {
        op: "click",
        target: { selector: "#save", tag: "button", label: "Save" },
        path: "/saved",
      },
    }))
    const out = await call(t.frame_click, { target: { text: "Save" } })
    expect(ops).toEqual([{ op: "click", target: { text: "Save" } }])
    expect(out).toMatch(/button "Save".*\/saved/)
  })

  it("tells the agent to say so in chat when the canvas isn't open", async () => {
    const { tools: t, ops } = tools(
      () => ({ status: "failed", reason: "" }),
      "Screenplay isn't showing this canvas."
    )
    const out = await call(t.frame_click, { target: { text: "Save" } })
    expect(out).toMatch(/isn't showing this canvas.*Tell the person in chat/)
    expect(ops).toEqual([])
  })

  it("says the canvas isn't open even when the room reads as empty", async () => {
    const { tools: t } = tools(
      () => ({ status: "failed", reason: "" }),
      "Screenplay isn't showing this canvas.",
      { empty: true }
    )
    const out = await call(t.frame_click, { target: { text: "Save" } })
    expect(out).toMatch(/isn't showing this canvas.*Tell the person in chat/)
  })

  it("lists elements with their selectors", async () => {
    const { tools: t } = tools(() => ({
      status: "read",
      value: {
        path: "/settings",
        title: "Settings",
        viewport: { width: 800, height: 600 },
        scroll: { x: 0, y: 0 },
        elements: [
          {
            selector: "#save",
            tag: "button",
            label: "Save",
            inViewport: true,
          },
          {
            selector: "#email",
            tag: "input",
            type: "email",
            label: "Email",
            value: "a@b.co",
            inViewport: false,
          },
        ],
      },
    }))
    const out = String(await call(t.frame_elements, {}))
    expect(out).toContain('- button "Save"  #save')
    expect(out).toContain('↓ input[email] "Email" = "a@b.co"  #email')
  })

  it("returns the screenshot as an image with its note", async () => {
    const { tools: t } = tools(() => ({ status: "failed", reason: "" }))
    const out = (await call(t.frame_screenshot, {})) as {
      kind: string
      caption: string
    }
    expect(out.kind).toBe("image")
    expect(out.caption).toMatch(/as shown on the canvas\. At 50% zoom\./)
  })
})

describe("phrase", () => {
  it("names a gap and hands the step to the person", () => {
    const line = phrase("frame [f1]", {
      status: "gap",
      gap: "file-picker",
      target: { selector: "#f", tag: "input", label: "Upload" },
    })
    expect(line).toContain(DRIVE_GAPS["file-picker"])
    expect(line).toMatch(/ask the person to do it/)
  })

  it("tells the agent to stop and ask after a take-over", () => {
    expect(
      phrase("frame [f1]", { status: "wait", driver: "u", takenOver: true })
    ).toMatch(/took control.*Stop driving.*ask before you carry on/)
    expect(phrase("frame [f1]", { status: "taken" })).toMatch(/took control/)
  })
})

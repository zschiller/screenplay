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
  findDrivable,
  phrase,
} from "@/lib/frame-drive/tools"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { toolAnnotations } from "@/lib/mcp/tool-server"

const EVAL_LIKE = /eval|script|exec|run_js|javascript|inject|function/i

function room({ empty = false } = {}) {
  const doc = new Y.Doc()
  const c = createRoomCollections(doc)
  const access = {
    c,
    readDoc: async <T>(fn: (c: RoomCollections) => T | Promise<T>) => fn(c),
    mutateDoc: async <T>(fn: (c: RoomCollections) => T | Promise<T>) => {
      let out!: T | Promise<T>
      doc.transact(() => {
        out = fn(c)
      })
      return out
    },
  }
  if (empty) return access
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
  c.iframeLayerGroups.set("g1", {
    id: "g1",
    name: "Group 1",
    x: 0,
    y: 0,
    members: [{ kind: "iframe-layer", id: "f1" }],
  } as never)
  return access
}

function tools(
  answer: (op: DriveOp) => DriveResult,
  unavailable?: string,
  {
    empty = false,
    frameUnavailable,
  }: {
    empty?: boolean
    /** Whether the canvas has a frame loaded, when that differs. */
    frameUnavailable?: (frameId: string) => string | null
  } = {}
) {
  const ops: DriveOp[] = []
  const reveals: string[] = []
  const backend: FrameDriveBackend = {
    unavailable: async (frameId) =>
      unavailable ??
      (frameId && frameUnavailable ? frameUnavailable(frameId) : null),
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
  const store = memoryFrameControlStore()
  const driver = new AgentFrameDriver({
    backend,
    store,
    keyOf: (id) => id,
    presence: () => ({ online: new Set(), goneAt: new Map() }),
    reveal: async (frameId) => {
      reveals.push(frameId)
      return null
    },
  })
  const r = room({ empty })
  return {
    ops,
    reveals,
    store,
    c: r.c,
    tools: buildFrameDriveTools(
      driver,
      r,
      { kind: "chat", sandboxName: "sb-1" },
      { asker: "user-zack", sleep: async () => {} }
    ),
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
    for (const t of Object.values(all)) expect(toolAnnotations(t)).toBeDefined()
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

describe("Showing the person (#1390)", () => {
  const DONE: DriveResult = {
    status: "done",
    value: { op: "click", path: "/" },
  }

  it("show: takes the frame on the ask, brings it into view, and paces each step", async () => {
    const { tools: t, ops, reveals, store } = tools(() => DONE)
    // The person is interacting with the frame when they ask.
    store.records.set("f1", { live: false, driver: "user-zack", requests: [] })
    const out = await call(t.frame_start_driving, { pace: "show" })
    expect(out).toMatch(/watchable pace.*into the person's view/)
    expect(reveals).toEqual(["f1"])
    await call(t.frame_click, { target: { text: "Save" } })
    expect(ops).toEqual([
      { op: "click", target: { text: "Save" }, pace: "show" },
    ])
  })

  it("jump: no animation, and nobody's view moves", async () => {
    const { tools: t, ops, reveals } = tools(() => DONE)
    expect(await call(t.frame_start_driving, { pace: "jump" })).toMatch(
      /end state; nobody's view moved/
    )
    await call(t.frame_click, { target: { text: "Save" } })
    expect(reveals).toEqual([])
    expect(ops[0]).toMatchObject({ pace: "jump" })
  })

  it("opens a new frame beside the Workspace's frames and waits for the canvas to load it", async () => {
    let checks = 0
    const { tools: t, c } = tools(() => DONE, undefined, {
      // The canvas mounts it on the third look.
      frameUnavailable: (id) =>
        id !== "f1" && ++checks < 3 ? "not yet" : null,
    })
    const out = String(await call(t.frame_open, { route: "settings" }))
    const id = out.match(/frameId "([^"]+)"/)?.[1]
    expect(out).toMatch(/^Opened frame \[.+\] \(\/settings\) beside/)
    expect(checks).toBe(3)
    expect(c.iframeLayers.get(id!)).toMatchObject({
      branchId: "b1",
      route: "/settings",
      label: "Settings",
      width: 800,
      height: 600,
    })
    expect(
      c.iframeLayerGroups.get("g1")?.members.map((m: { id: string }) => m.id)
    ).toEqual(["f1", id])
  })

  it("opens a Workspace's first frame in a Group of its own", async () => {
    const { tools: t, c } = tools(() => DONE)
    c.iframeLayers.delete("f1")
    c.iframeLayerGroups.delete("g1")
    const out = String(await call(t.frame_open, {}))
    const id = out.match(/frameId "([^"]+)"/)?.[1]
    expect(c.iframeLayers.get(id!)).toMatchObject({ branchId: "b1" })
    expect(c.iframeLayers.get(id!)?.route).toBeUndefined()
  })

  it("doesn't open a frame when the canvas isn't open", async () => {
    const { tools: t, c } = tools(
      () => DONE,
      "Screenplay isn't showing this canvas."
    )
    expect(String(await call(t.frame_open, {}))).toMatch(
      /isn't showing this canvas.*Tell the person in chat/
    )
    expect(c.iframeLayers.toArray()).toHaveLength(1)
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
    expect(line).toMatch(
      /ask the person in chat to do it.*wait for their reply/
    )
  })

  it("tells the agent to stop and ask after a take-over", () => {
    expect(
      phrase("frame [f1]", { status: "wait", driver: "u", takenOver: true })
    ).toMatch(/took control.*Stop driving.*ask before you carry on/)
    expect(phrase("frame [f1]", { status: "taken" })).toMatch(/took control/)
  })
})

describe("findDrivable", () => {
  function canvas({ frames = 1, mockups = 1 } = {}) {
    const c = createRoomCollections(new Y.Doc())
    c.branches.set("b1", {
      id: "b1",
      sandboxName: "sb-1",
      title: "Checkout",
    } as never)
    for (let i = 1; i <= frames; i++)
      c.iframeLayers.set(`f${i}`, {
        id: `f${i}`,
        branchId: "b1",
        route: "/",
        width: 800,
        height: 600,
      } as never)
    for (let i = 1; i <= mockups; i++)
      c.mockupLayers.set(`m${i}`, { id: `m${i}`, title: `Take ${i}` } as never)
    return c
  }
  const scope = { kind: "chat" as const, sandboxName: "sb-1" }

  it("drives a Mockup named by its id", () => {
    expect(findDrivable(canvas(), scope, "m1", true)).toEqual({
      id: "m1",
      name: 'Mockup [m1] ("Take 1")',
    })
  })

  it("keeps the Workspace's own frame as the default beside Mockups", () => {
    expect(findDrivable(canvas(), scope, undefined, true)).toMatchObject({
      id: "f1",
    })
  })

  it("defaults to the one Mockup where only Mockups drive", () => {
    expect(findDrivable(canvas(), scope, undefined, false)).toMatchObject({
      id: "m1",
    })
    const out = findDrivable(canvas({ mockups: 2 }), scope, undefined, false)
    expect(out).toMatch(/Mockup to drive:\n- m1: Mockup "Take 1"\n- m2/)
  })

  it("lists frames and Mockups when there's no single one", () => {
    const out = findDrivable(
      canvas({ frames: 0, mockups: 2 }),
      { kind: "chat" },
      undefined,
      true
    )
    expect(out).toMatch(/frame or Mockup to drive/)
    expect(out).toContain('- m2: Mockup "Take 2"')
  })

  it("says when nothing has the id", () => {
    expect(findDrivable(canvas(), scope, "zz", true)).toMatch(
      /no frame or Mockup zz/
    )
  })
})

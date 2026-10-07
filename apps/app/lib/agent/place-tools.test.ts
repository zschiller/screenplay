import { describe, expect, it } from "vitest"

import { buildPlaceTools } from "@/lib/agent/place-tools"
import { getGroupMembers } from "@/lib/canvas/layout"
import type { RoomDoc } from "@/lib/room-access"
import {
  baseBranch,
  baseChat,
  baseLayer,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

function setup() {
  const h = makeHarness()
  const room = {
    roomId: "room-1",
    readDoc: async (fn) => fn(h.collections),
    mutateDoc: async (fn) => fn(h.collections),
  } as RoomDoc
  h.collections.branches.set("ws-1", baseBranch("ws-1"))
  h.collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { branchId: "ws-1" })
  )
  const tools = buildPlaceTools({ room, chatId: "chat-1" })
  const run = (input: { id: string; page?: string }) =>
    tools.add_to_canvas.execute!(input, {} as never) as Promise<string>
  return { ...h, run }
}

describe("add_to_canvas (#1885)", () => {
  it("puts a file with no view beside the chat’s Workspace frames", async () => {
    const { ops, collections, run } = setup()
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])
    const fileId = ops.createFile({
      kind: "mockup",
      title: "Options",
      html: "<p>a</p>",
    })

    const out = await run({ id: fileId })

    const viewId = /view id ([^)]+)\)/.exec(out)![1]!
    expect(out).toContain('Put Mockup "Options" on the canvas')
    expect(collections.mockupLayers.get(viewId)).toMatchObject({
      fileId,
      title: "Options",
      width: 1280,
      height: 800,
    })
    expect(
      getGroupMembers(collections.iframeLayerGroups.get("group-1")!)
    ).toContainEqual({ kind: "mockup-layer", id: viewId })
  })

  it("starts a Group in free space when the chat’s Group would cover another", async () => {
    const { ops, collections, run } = setup()
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    seedGroup(collections, "group-1", [{ kind: "iframe-layer", id: "frame-1" }])
    collections.iframeLayers.set("frame-2", baseLayer("frame-2"))
    collections.iframeLayerGroups.set("group-2", {
      id: "group-2",
      name: "group-2",
      x: 500,
      y: 0,
      members: [{ kind: "iframe-layer", id: "frame-2" }],
    })
    const fileId = ops.createFile({
      kind: "mockup",
      title: "Options",
      html: "<p>a</p>",
    })

    const out = await run({ id: fileId })

    const viewId = /view id ([^)]+)\)/.exec(out)![1]!
    const own = collections.iframeLayerGroups
      .toArray()
      .find((g) => getGroupMembers(g).some((m) => m.id === viewId))!
    expect(own.id).not.toBe("group-1")
    // Right of group-2, so it covers neither frame.
    expect(own.x).toBeGreaterThanOrEqual(900)
  })

  it("starts its own Group when the chat has no layers, and keeps the file", async () => {
    const { ops, collections, run } = setup()
    const fileId = ops.createFile({ kind: "document", title: "Notes" })

    const out = await run({ id: fileId })

    const viewId = /view id ([^)]+)\)/.exec(out)![1]!
    expect(collections.markdownLayers.get(viewId)).toMatchObject({
      fileId,
      title: "Notes",
      width: 480,
      height: 640,
    })
    expect(collections.iframeLayerGroups.toArray()).toHaveLength(1)
    expect(collections.layerFiles.get(fileId)?.title).toBe("Notes")
  })

  it("says so for an id that names nothing", async () => {
    const { run } = setup()
    expect(await run({ id: "nope" })).toBe(
      "There’s no Document or Mockup nope."
    )
  })
})

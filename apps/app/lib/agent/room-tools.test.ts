import { describe, expect, it } from "vitest"

import {
  buildRoomTools,
  CANVAS_SUMMARY_LIMITS,
  type RoomToolPorts,
  type TerminalTabSummary,
} from "@/lib/agent/room-tools"
import type { RoomCollections } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"

/**
 * The Coordinator tools module against a bare Room doc: fake ports read the
 * harness's Y.Doc directly, the way `RoomAccess.readDoc` reads the live one.
 */
function portsOver(
  collections: RoomCollections,
  terminalTabs: TerminalTabSummary[] = []
): RoomToolPorts {
  return {
    readDoc: async (fn) => fn(collections),
    listTerminalTabs: async () => terminalTabs,
  }
}

async function readCanvas(ports: RoomToolPorts): Promise<string> {
  const tools = buildRoomTools("room-1", ports)
  const execute = tools.read_canvas.execute!
  return (await execute({}, { toolCallId: "t1", messages: [] })) as string
}

describe("read_canvas", () => {
  it("summarizes Workspaces, frames, documents and Terminal Tabs", async () => {
    const { collections } = makeHarness()
    collections.repos.set(
      "repo-1",
      baseRepo("repo-1", { repoFullName: "acme/web" })
    )
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", {
        title: "Fix sign-in redirect",
        ref: "fix-sign-in",
        diffAdditions: 18,
        diffDeletions: 3,
        prNumber: 12,
        prState: "open",
      })
    )
    collections.branches.set(
      "ws-2",
      baseBranch("ws-2", { ref: "dark-mode", status: "starting" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "ws-1", isStreaming: true })
    )
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", {
        branchId: "ws-1",
        route: "/settings",
        width: 1280,
        height: 800,
      })
    )
    collections.iframeLayers.set("frame-2", baseLayer("frame-2"))
    collections.markdownLayers.set(
      "doc-1",
      baseDoc("doc-1", { title: "Launch spec" })
    )

    const summary = await readCanvas(
      portsOver(collections, [
        { id: "term-1", label: "Claude Code", branchId: "ws-1" },
      ])
    )

    expect(summary).toContain("Repositories (1):\n- acme/web")
    expect(summary).toContain(
      '- [ws-1] "Fix sign-in redirect" · branch fix-sign-in · acme/web · working · +18 −3 · PR #12 open'
    )
    // No title: the Workspace label rule falls back to the branch.
    expect(summary).toContain(
      '- [ws-2] "dark-mode" · branch dark-mode · acme/web · starting'
    )
    expect(summary).toContain(
      "- [frame-1] /settings · 1280×800 · Workspace ws-1"
    )
    expect(summary).toContain("- [frame-2] (no route) · 400×300 · no Workspace")
    expect(summary).toContain('- [doc-1] "Launch spec"')
    expect(summary).toContain('- [term-1] "Claude Code" · Workspace ws-1')
  })

  it("reads records written after an earlier read", async () => {
    const { collections } = makeHarness()
    const ports = portsOver(collections)
    await readCanvas(ports)
    collections.markdownLayers.set("doc-1", baseDoc("doc-1", { title: "New" }))
    expect(await readCanvas(ports)).toContain('- [doc-1] "New"')
  })

  it("says so when the canvas is empty", async () => {
    const { collections } = makeHarness()
    expect(await readCanvas(portsOver(collections))).toMatch(/is empty/)
  })

  it("still summarizes the doc when Terminal Tabs can't be listed", async () => {
    const { collections } = makeHarness()
    collections.markdownLayers.set("doc-1", baseDoc("doc-1", { title: "A" }))
    const summary = await readCanvas({
      ...portsOver(collections),
      listTerminalTabs: async () => {
        throw new Error("db down")
      },
    })
    expect(summary).toContain('- [doc-1] "A"')
  })

  it("stays well under 25k tokens on a very large canvas", async () => {
    const { collections } = makeHarness()
    const long = "x".repeat(500)
    collections.repos.set("repo-1", baseRepo("repo-1"))
    const id = (kind: string, i: number) =>
      `${kind}-${i.toString().padStart(4, "0")}-V1StGXR8_Z5jdHi6B-myT`
    for (let i = 0; i < 600; i++) {
      collections.branches.set(
        id("ws", i),
        baseBranch(id("ws", i), {
          title: long,
          ref: long,
          diffAdditions: 12345,
          diffDeletions: 678,
          prNumber: 9999,
          prState: "merged",
        })
      )
    }
    for (let i = 0; i < 3000; i++) {
      collections.iframeLayers.set(
        id("frame", i),
        baseLayer(id("frame", i), {
          branchId: id("ws", i % 600),
          route: `/${long}`,
          width: 1440,
          height: 900,
        })
      )
    }
    for (let i = 0; i < 800; i++) {
      collections.markdownLayers.set(
        id("doc", i),
        baseDoc(id("doc", i), { title: long })
      )
    }
    const tabs = Array.from({ length: 400 }, (_, i) => ({
      id: id("term", i),
      label: long,
      branchId: id("ws", i % 600),
    }))

    const summary = await readCanvas(portsOver(collections, tabs))

    // A conservative 3 characters per token (ids tokenize worse than prose):
    // the summary must stay far below the 25k-token budget.
    expect(summary.length / 3).toBeLessThan(25_000)
    expect(summary).toContain(
      `…and ${3000 - CANVAS_SUMMARY_LIMITS.frames} more`
    )
    expect(summary).toContain(
      `…and ${600 - CANVAS_SUMMARY_LIMITS.workspaces} more`
    )
    // Counts stay truthful even when the list is cut.
    expect(summary).toContain("Frames (3000):")
  })
})

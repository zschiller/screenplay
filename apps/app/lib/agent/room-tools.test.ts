import { describe, expect, it } from "vitest"

import {
  buildRoomTools,
  CANVAS_SUMMARY_LIMITS,
  type RoomToolPorts,
  type TerminalTabSummary,
  type WorkspaceTurnRequest,
} from "@/lib/agent/room-tools"
import type { RoomCollections } from "@/lib/yjs/schema"
import { readMemory } from "@/lib/canvas/memory"
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
  const unused = async (): Promise<never> => {
    throw new Error("not used by read_canvas")
  }
  return {
    readDoc: async (fn) => fn(collections),
    mutateDoc: async (fn) => fn(collections),
    listTerminalTabs: async () => terminalTabs,
    readChatTranscript: unused,
    readWorkspaceDiff: unused,
    readWorkspaceFile: unused,
    captureFrame: unused,
    readFrameCapture: unused,
    launchWorkspaceTurn: async () => {},
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
      '- [frame-1] "Frame" · /settings · 1280×800 · Workspace ws-1'
    )
    expect(summary).toContain(
      '- [frame-2] "Frame" · (no route) · 400×300 · no Workspace'
    )
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

async function writeMemory(
  ports: RoomToolPorts,
  input: { action: "add" | "edit" | "remove"; id?: string; text?: string }
): Promise<string> {
  const tools = buildRoomTools("room-1", ports)
  const execute = tools.write_memory.execute!
  return (await execute(input, { toolCallId: "t1", messages: [] })) as string
}

describe("write_memory", () => {
  it("adds an entry to the Room's shared data, marked as the Coordinator's", async () => {
    const { collections } = makeHarness()
    const out = await writeMemory(portsOver(collections), {
      action: "add",
      text: "  Use pnpm, never npm.  ",
    })

    const [entry, ...rest] = readMemory(collections)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({
      text: "Use pnpm, never npm.",
      source: "coordinator",
    })
    expect(out).toContain(`[${entry!.id}]`)
  })

  it("edits an entry by id", async () => {
    const { collections } = makeHarness()
    const ports = portsOver(collections)
    await writeMemory(ports, { action: "add", text: "Deploy on Fridays." })
    const id = readMemory(collections)[0]!.id

    const out = await writeMemory(ports, {
      action: "edit",
      id,
      text: "Never deploy on Fridays.",
    })

    expect(out).toBe(`Updated [${id}].`)
    expect(readMemory(collections).map((m) => m.text)).toEqual([
      "Never deploy on Fridays.",
    ])
  })

  it("removes an entry by id", async () => {
    const { collections } = makeHarness()
    const ports = portsOver(collections)
    await writeMemory(ports, { action: "add", text: "Staging is flaky." })
    const id = readMemory(collections)[0]!.id

    expect(await writeMemory(ports, { action: "remove", id })).toBe(
      `Removed [${id}].`
    )
    expect(readMemory(collections)).toEqual([])
  })

  it("changes nothing for an unknown id or empty text", async () => {
    const { collections } = makeHarness()
    const ports = portsOver(collections)

    expect(
      await writeMemory(ports, { action: "edit", id: "mem-x", text: "hi" })
    ).toBe("No memory entry [mem-x].")
    expect(await writeMemory(ports, { action: "remove" })).toMatch(
      /needs the entry's id/
    )
    expect(await writeMemory(ports, { action: "add", text: "   " })).toMatch(
      /needs text/
    )
    expect(readMemory(collections)).toEqual([])
  })
})

describe("send_to_workspace", () => {
  /** Ports that record every Workspace turn the tool starts. */
  function sendHarness() {
    const { collections } = makeHarness()
    const launched: WorkspaceTurnRequest[] = []
    const ports: RoomToolPorts = {
      ...portsOver(collections),
      launchWorkspaceTurn: async (request) => {
        launched.push(request)
      },
    }
    const send = async (input: { workspace_id: string; message: string }) =>
      (await buildRoomTools("room-1", ports).send_to_workspace.execute!(input, {
        toolCallId: "t1",
        messages: [],
      })) as string
    return { collections, launched, ports, send }
  }

  it("queues the message in the Workspace's newest open chat and returns", async () => {
    const { collections, launched, send } = sendHarness()
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { title: "Fix sign-in redirect" })
    )
    collections.chatSessions.set(
      "old",
      baseChat("old", { branchId: "ws-1", createdAt: 1 })
    )
    collections.chatSessions.set(
      "new",
      baseChat("new", { branchId: "ws-1", createdAt: 2, model: "m-1" })
    )
    collections.chatSessions.set(
      "closed",
      baseChat("closed", { branchId: "ws-1", createdAt: 3, closedAt: 4 })
    )

    const result = await send({
      workspace_id: "ws-1",
      message: "  Keep the next param.  ",
    })

    expect(launched).toEqual([
      {
        branchId: "ws-1",
        sandboxName: "sandbox-ws-1",
        chatId: "new",
        message: "Keep the next param.",
        isFirstChat: false,
        model: "m-1",
      },
    ])
    expect(result).toContain('Sent to "Fix sign-in redirect" [chat new]')
  })

  it("never waits on the Workspace turn", async () => {
    const { collections, ports } = sendHarness()
    collections.branches.set("ws-1", baseBranch("ws-1"))
    // Resolving means queued: Turn Launch drives the turn after the fact.
    let queued = false
    const result = buildRoomTools("room-1", {
      ...ports,
      launchWorkspaceTurn: async () => {
        queued = true
      },
    }).send_to_workspace.execute!(
      { workspace_id: "ws-1", message: "Go" },
      { toolCallId: "t1", messages: [] }
    )
    await expect(result).resolves.toMatch(/Sent to/)
    expect(queued).toBe(true)
  })

  it("opens a chat when the Workspace has none open", async () => {
    const { collections, launched, send } = sendHarness()
    collections.branches.set("ws-1", baseBranch("ws-1"))

    await send({ workspace_id: "ws-1", message: "Add a dark mode toggle" })

    const [request] = launched
    const chat = collections.chatSessions.get(request.chatId)
    expect(chat).toMatchObject({ branchId: "ws-1", label: "Untitled" })
    expect(request.isFirstChat).toBe(true)
  })

  it.each([
    ["an unknown Workspace", () => {}, /No Workspace has the id ws-1/],
    [
      "a Workspace whose sandbox isn't running",
      (c: RoomCollections) =>
        c.branches.set("ws-1", baseBranch("ws-1", { status: "starting" })),
      /isn't running/,
    ],
    [
      "a Workspace whose agent is working",
      (c: RoomCollections) => {
        c.branches.set("ws-1", baseBranch("ws-1"))
        c.chatSessions.set(
          "chat-1",
          baseChat("chat-1", { branchId: "ws-1", isStreaming: true })
        )
      },
      /is working on a turn/,
    ],
    [
      "a Workspace whose plan waits on the user",
      (c: RoomCollections) => {
        c.branches.set("ws-1", baseBranch("ws-1"))
        c.plans.set("plan-1", {
          id: "plan-1",
          chatId: "chat-1",
          branchId: "ws-1",
          content: "Plan",
          status: "pending",
          toolEventId: "t",
          createdAt: 0,
        })
      },
      /Only the user approves plans/,
    ],
  ])("refuses %s without starting a turn", async (_, seed, reason) => {
    const { collections, launched, send } = sendHarness()
    seed(collections)
    await expect(send({ workspace_id: "ws-1", message: "Go" })).rejects.toThrow(
      reason
    )
    expect(launched).toEqual([])
  })
})

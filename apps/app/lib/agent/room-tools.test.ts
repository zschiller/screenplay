import { describe, expect, it } from "vitest"

import {
  buildRoomTools,
  wakeRequesterId,
  CANVAS_SUMMARY_LIMITS,
  type RoomToolPorts,
  type TerminalTabSummary,
  type WorkspaceTurnRequest,
} from "@/lib/agent/room-tools"
import type { RoomCollections } from "@/lib/yjs/schema"
import { readMemory } from "@/lib/canvas/memory"
import { getGroupMembers } from "@/lib/canvas/layout"
import type { BranchProvisionRequest } from "@/lib/branch/provisioning-live"
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
    provisionWorkspace: async () => {},
    stopWorkspaceTurn: async () => {},
    openPullRequest: unused,
    deleteSandbox: async () => {},
    requesterId: "user-1",
    coordinatorChatId: "room-chat-1",
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

describe("the Coordinator's tools", () => {
  it("have no way to approve or reject a Workspace's plan (#897)", () => {
    const { collections } = makeHarness()
    const names = Object.keys(buildRoomTools("room-1", portsOver(collections)))
    expect(names.filter((n) => /plan|approve|reject/.test(n))).toEqual([])
  })
})

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
    // No title: "New Workspace", never the branch; no turns yet: fresh (#1182).
    expect(summary).toContain(
      '- [ws-2] "New Workspace" · branch dark-mode · acme/web · starting · fresh (no turns yet)'
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

  it("holds the first ask for a fresh Workspace that is still starting (#1182)", async () => {
    const { collections, launched, send } = sendHarness()
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { status: "starting", ref: "brave-otter" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "ws-1" })
    )

    const result = await send({ workspace_id: "ws-1", message: "Make it pink" })

    expect(result).toContain('Queued for "New Workspace" [chat chat-1]')
    // Sent by provisioning once the sandbox runs, not now.
    expect(launched).toEqual([])
    expect(collections.branches.get("ws-1")?.pendingSeed).toEqual({
      chatId: "chat-1",
      message: "Make it pink",
      coordinatorChatId: expect.any(String),
    })
  })

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
        c.branches.set(
          "ws-1",
          baseBranch("ws-1", { status: "starting", lastActivityAt: 1 })
        ),
      /isn't running/,
    ],
    [
      "a stopped fresh Workspace",
      (c: RoomCollections) =>
        c.branches.set("ws-1", baseBranch("ws-1", { status: "stopped" })),
      /isn't running/,
    ],
    [
      "a starting Workspace that already has a message waiting",
      (c: RoomCollections) =>
        c.branches.set(
          "ws-1",
          baseBranch("ws-1", {
            status: "starting",
            pendingSeed: {
              chatId: "chat-0",
              message: "First",
              coordinatorChatId: "room-chat",
            },
          })
        ),
      /already has a message waiting/,
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

describe("create_workspaces", () => {
  const specs = [
    {
      title: "Fix sign-in redirect",
      repository: "acme/web",
      prompt: "Fix the sign-in redirect loop after OAuth.",
    },
    {
      title: "Dark mode toggle",
      repository: "ACME/Web",
      base_branch: "release",
      prompt: "Add a dark mode toggle to the header.",
    },
  ]

  function createHarness(overrides: Partial<RoomToolPorts> = {}) {
    const { collections } = makeHarness()
    collections.repos.set(
      "repo-1",
      baseRepo("repo-1", { repoFullName: "acme/web", defaultBranch: "main" })
    )
    const provisioned: BranchProvisionRequest[] = []
    const ports: RoomToolPorts = {
      ...portsOver(collections),
      requesterId: "asker",
      coordinatorChatId: "room-chat-1",
      provisionWorkspace: async (request) => {
        provisioned.push(request)
      },
      ...overrides,
    }
    return { collections, ports, provisioned }
  }

  async function create(ports: RoomToolPorts, input: unknown) {
    return (await buildRoomTools("room-1", ports).create_workspaces.execute!(
      input,
      { toolCallId: "t1", messages: [] }
    )) as string
  }

  it("creates each Workspace right away, owned by the asking member and seeded with its prompt (#1217)", async () => {
    const { collections, ports, provisioned } = createHarness()
    const result = await create(ports, { workspaces: specs })

    const branches = collections.branches.toArray()
    expect(branches.map((b) => [b.title, b.ref, b.createdBy])).toEqual([
      ["Fix sign-in redirect", "fix-sign-in-redirect", "asker"],
      ["Dark mode toggle", "dark-mode-toggle", "asker"],
    ])
    const [fix, dark] = branches
    expect(fix).toMatchObject({
      repoId: "repo-1",
      status: "creating",
      createFlow: "new",
      autoNamedBranch: false,
      pendingSeed: {
        message: "Fix the sign-in redirect loop after OAuth.",
        coordinatorChatId: "room-chat-1",
      },
    })
    expect(dark).toMatchObject({
      createFlow: "duplicate-branch",
      createSourceBranch: "release",
    })
    // The seed goes to the Workspace's own chat, titled like it.
    const seedChat = collections.chatSessions.get(fix!.pendingSeed!.chatId)
    expect(seedChat).toMatchObject({
      branchId: fix!.id,
      label: "Fix sign-in redirect",
    })
    // Both frames land together in one new Group.
    const groups = collections.iframeLayerGroups.toArray()
    expect(groups).toHaveLength(1)
    expect(getGroupMembers(groups[0]!)).toHaveLength(2)
    expect(
      provisioned.map((p) => [p.branchId, p.flow, p.sourceBranch])
    ).toEqual([
      [fix!.id, "new", undefined],
      [dark!.id, "duplicate-branch", "release"],
    ])
    expect(result).toContain("Started 2 of 2 Workspaces.")
    expect(result).toContain(`[workspace ${fix!.id}]`)
    expect(result).toContain(`[workspace ${dark!.id}]`)
  })

  it("keeps going when one fails to start: that one is marked failed for Retry and reported", async () => {
    const { collections, ports, provisioned } = createHarness()
    let calls = 0
    ports.provisionWorkspace = async (request) => {
      if (calls++ === 0) throw new Error("no GitHub token")
      provisioned.push(request)
    }
    const result = await create(ports, {
      workspaces: [
        ...specs,
        { title: "Docs", repository: "acme/docs", prompt: "Write the guide." },
      ],
    })

    const [fix, dark] = collections.branches.toArray()
    // The failed one keeps its create flow, which is what Retry re-runs.
    expect(fix).toMatchObject({
      status: "error",
      error: "no GitHub token",
      createFlow: "new",
    })
    expect(provisioned.map((p) => p.branchId)).toEqual([dark!.id])
    // A repository not on the canvas gets no Workspace at all.
    expect(collections.branches.toArray()).toHaveLength(2)
    expect(result.split("\n")).toEqual([
      "Started 1 of 3 Workspaces. Each gets its seed message once its sandbox is running; you'll hear back when its turns end.",
      `- "Fix sign-in redirect" (acme/web) [workspace ${fix!.id}]: failed to start (no GitHub token). Its row offers Retry; tell the user.`,
      `- "Dark mode toggle" (acme/web) [workspace ${dark!.id}]: starting`,
      `- "Docs" (acme/docs): not created, because that repository isn't on this canvas. Tell the user.`,
    ])
  })

  it("gives each Workspace its own branch name", async () => {
    const { collections, ports } = createHarness()
    collections.branches.set(
      "old",
      baseBranch("old", { ref: "fix-sign-in-redirect" })
    )
    await create(ports, { workspaces: [specs[0], specs[0]] })
    expect(
      collections.branches
        .toArray()
        .map((b) => b.ref)
        .sort()
    ).toEqual([
      "fix-sign-in-redirect",
      "fix-sign-in-redirect-2",
      "fix-sign-in-redirect-3",
    ])
  })

  it("on a wake turn, gives Workspaces to the owner of the Workspace that woke it", () => {
    expect(wakeRequesterId({ createdBy: "waker" }, "fallback")).toBe("waker")
    expect(wakeRequesterId({}, "fallback")).toBe("fallback")
    expect(wakeRequesterId(undefined, "fallback")).toBe("fallback")
  })
})

describe("stop_workspace", () => {
  function stopHarness() {
    const { collections } = makeHarness()
    const stopped: string[] = []
    const ports: RoomToolPorts = {
      ...portsOver(collections),
      stopWorkspaceTurn: async (chatId) => {
        stopped.push(chatId)
      },
    }
    const stop = async (workspace_id: string) =>
      (await buildRoomTools("room-1", ports).stop_workspace.execute!(
        { workspace_id },
        { toolCallId: "t1", messages: [] }
      )) as string
    return { collections, stopped, stop }
  }

  it("stops the Workspace's running turn right away", async () => {
    const { collections, stopped, stop } = stopHarness()
    collections.branches.set("ws-1", baseBranch("ws-1", { title: "Fix it" }))
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "ws-1", isStreaming: true })
    )
    collections.chatSessions.set(
      "chat-2",
      baseChat("chat-2", { branchId: "ws-1" })
    )
    collections.chatSessions.set(
      "chat-3",
      baseChat("chat-3", { branchId: "ws-2", isStreaming: true })
    )

    expect(await stop("ws-1")).toBe(
      'Stopped "Fix it". Its chat keeps what it did so far.'
    )
    expect(stopped).toEqual(["chat-1"])
  })

  it("says so when the Workspace isn't working", async () => {
    const { collections, stopped, stop } = stopHarness()
    collections.branches.set("ws-1", baseBranch("ws-1", { title: "Fix it" }))
    expect(await stop("ws-1")).toContain("isn't working on a turn")
    expect(stopped).toEqual([])
  })

  it("fails for an unknown Workspace", async () => {
    const { stop } = stopHarness()
    await expect(stop("nope")).rejects.toThrow(/No Workspace has the id nope/)
  })
})

describe("open_pull_request and remove_workspace (#901, #1217)", () => {
  function createHarness(overrides: Partial<RoomToolPorts> = {}) {
    const { collections } = makeHarness()
    collections.repos.set(
      "repo-1",
      baseRepo("repo-1", { repoFullName: "acme/web" })
    )
    // Alice owns the Workspace; Bob is the member talking to the Coordinator.
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", {
        title: "Fix sign-in redirect",
        ref: "fix-sign-in",
        diffAdditions: 18,
        diffDeletions: 3,
        createdBy: "alice",
      })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "ws-1" })
    )
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1" })
    )
    const opened: { sandboxName: string; ownerId: string }[] = []
    const deleted: string[] = []
    const ports: RoomToolPorts = {
      ...portsOver(collections),
      requesterId: "bob",
      openPullRequest: async (request) => {
        opened.push(request)
        return { url: "https://github.com/acme/web/pull/7", number: 7 }
      },
      deleteSandbox: async (name) => {
        deleted.push(name)
      },
      ...overrides,
    }
    return { collections, ports, opened, deleted }
  }

  async function call(ports: RoomToolPorts, name: string, workspaceId: string) {
    return (await buildRoomTools("room-1", ports)[name]!.execute!(
      { workspace_id: workspaceId },
      { toolCallId: "t1", messages: [] }
    )) as string
  }

  it("opens the PR right away, with the Workspace owner's GitHub account, not the member who asked", async () => {
    const { ports, opened, collections } = createHarness()
    const result = await call(ports, "open_pull_request", "ws-1")
    expect(opened).toEqual([{ sandboxName: "sandbox-ws-1", ownerId: "alice" }])
    expect(result).toBe(
      'Opened PR #7 for "Fix sign-in redirect": https://github.com/acme/web/pull/7'
    )
    expect(collections.branches.get("ws-1")).toMatchObject({
      prNumber: 7,
      prUrl: "https://github.com/acme/web/pull/7",
      prState: "open",
    })
  })

  it("falls back to whoever asked for a Workspace with no recorded owner", async () => {
    const { ports, opened, collections } = createHarness()
    collections.branches.update("ws-1", { createdBy: undefined })
    await call(ports, "open_pull_request", "ws-1")
    expect(opened).toEqual([{ sandboxName: "sandbox-ws-1", ownerId: "bob" }])
  })

  it("removes the Workspace right away as the sidebar does: record, frames, chats, then its sandbox", async () => {
    const { ports, deleted, collections } = createHarness()
    collections.branches.update("ws-1", { prNumber: 4, prState: "open" })
    const result = await call(ports, "remove_workspace", "ws-1")
    expect(result).toBe(
      'Removed "Fix sign-in redirect": 1 chat, 1 frame and its sandbox. PR #4 stays open on GitHub.'
    )
    expect(collections.branches.get("ws-1")).toBeUndefined()
    expect(collections.iframeLayers.get("frame-1")).toBeUndefined()
    expect(collections.chatSessions.get("chat-1")).toBeUndefined()
    expect(deleted).toEqual(["sandbox-ws-1"])
  })

  // A refusal is the call's result, never an error (#1231).
  it("refuses a missing Workspace, one with a PR open, or one not on GitHub, and does nothing", async () => {
    const { ports, collections, opened, deleted } = createHarness()
    const missing =
      "No Workspace has the id ws-9. Call read_canvas for current ids."
    expect(await call(ports, "remove_workspace", "ws-9")).toBe(missing)
    expect(await call(ports, "open_pull_request", "ws-9")).toBe(missing)

    collections.branches.update("ws-1", { prNumber: 4, prState: "open" })
    expect(await call(ports, "open_pull_request", "ws-1")).toBe(
      '"Fix sign-in redirect" already has PR #4 open.'
    )

    collections.branches.update("ws-1", { prNumber: undefined })
    collections.repos.update("repo-1", {
      repoOwner: undefined,
      repoName: undefined,
    })
    expect(await call(ports, "open_pull_request", "ws-1")).toBe(
      "\"Fix sign-in redirect\" isn't in a GitHub repository, so it can't have a pull request."
    )
    expect(opened).toEqual([])
    expect(deleted).toEqual([])
  })

  it("fails the call when opening the PR throws", async () => {
    const { ports } = createHarness({
      openPullRequest: async () => {
        throw new Error("GitHub is down.")
      },
    })
    await expect(call(ports, "open_pull_request", "ws-1")).rejects.toThrow(
      "GitHub is down."
    )
  })
})

describe("read_skill (#905)", () => {
  async function readSkill(name: string): Promise<string> {
    const { collections } = makeHarness()
    const tools = buildRoomTools("room-1", portsOver(collections))
    const execute = tools.read_skill.execute!
    return (await execute(
      { name },
      { toolCallId: "t1", messages: [] }
    )) as string
  }

  it("loads a Coordinator Skill's instructions", async () => {
    const out = await readSkill("screenplay-try-variants")

    expect(out).toContain("name: screenplay-try-variants")
    expect(out).toContain("create_workspaces")
  })

  it("won't load a Workspace agent's Skill, and lists its own instead", async () => {
    const out = await readSkill("screenplay-add-knob")

    expect(out).toContain('Unknown skill: "screenplay-add-knob"')
    expect(out).toContain("- screenplay-try-variants:")
  })

  it("names its Skills in the description, for a desktop harness", () => {
    const { collections } = makeHarness()
    const tools = buildRoomTools("room-1", portsOver(collections))

    expect(tools.read_skill.description).toContain("screenplay-try-variants")
  })
})

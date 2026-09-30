import { describe, expect, it, vi } from "vitest"

import { buildRoomTools, type RoomToolPorts } from "@/lib/agent/room-tools"
import {
  WORKSPACE_READ_LIMITS,
  type WorkspaceCheckout,
} from "@/lib/agent/room-read-tools"
import { imageModelOutput } from "@/lib/agent/image-output"
import { toolOutputToContent } from "@/lib/agent/acp/adapter"
import type { AgentMessage } from "@/lib/agent/types"
import { renderHistory } from "@/lib/agent/history-render"
import { wireToContentBlocks } from "@/lib/agent/acp/markers"
import {
  buildTargetedElementsFooter,
  prependTurnMarkers,
  serializeElement,
} from "@/lib/agent/message-markers"
import type { RoomCollections } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseLayer,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"

/**
 * The Coordinator's Workspace reads against a bare Room doc, with fake history,
 * diff, file and capture ports standing in for the durable log, the sandbox and
 * the Thumbnail Capturer.
 */
function setup(overrides: Partial<RoomToolPorts> = {}) {
  const { collections } = makeHarness()
  collections.repos.set(
    "repo-1",
    baseRepo("repo-1", { repoFullName: "acme/web", defaultBranch: "trunk" })
  )
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", {
      title: "Fix sign-in",
      ref: "fix-sign-in",
      previewDomain: "https://ws-1.preview.test",
    })
  )
  const ports: RoomToolPorts = {
    readDoc: async (fn) => fn(collections),
    mutateDoc: async (fn) => fn(collections),
    listTerminalTabs: async () => [],
    provisionWorkspace: async () => {},
    stopWorkspaceTurn: async () => {},
    openPullRequest: async () => {
      throw new Error("no GitHub")
    },
    deleteSandbox: async () => {},
    requesterId: "user-1",
    coordinatorChatId: "room-chat-1",
    launchWorkspaceTurn: vi.fn(async () => {}),
    readChatTranscript: vi.fn(async () => []),
    readWorkspaceDiff: vi.fn(async () => ""),
    readWorkspaceFile: vi.fn(async () => null),
    captureFrame: vi.fn(async () => {
      throw new Error("no browser")
    }),
    readFrameCapture: vi.fn(async () => null),
    ...overrides,
  }
  return { collections, ports }
}

async function run(
  ports: RoomToolPorts,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const tools = buildRoomTools("room-1", ports)
  return tools[name].execute!(input, { toolCallId: "t1", messages: [] })
}

function addChat(
  collections: RoomCollections,
  id: string,
  partial: Parameters<typeof baseChat>[1] = {}
) {
  collections.chatSessions.set(
    id,
    baseChat(id, { branchId: "ws-1", label: id, ...partial })
  )
}

const turn: AgentMessage[] = [
  { role: "user", content: "Fix the sign-in redirect" },
  { role: "assistant", content: "Earlier answer" },
  { role: "user", content: "Now make it keep the query string" },
  { role: "assistant", content: "Looking at the router" },
  {
    role: "tool_call",
    toolCallId: "a",
    title: "read_file",
    status: "completed",
    content: [],
    rawInput: { path: "app/login.tsx" },
  },
  {
    role: "tool_call",
    toolCallId: "b",
    title: "edit_file",
    status: "completed",
    content: [],
    rawInput: { path: "app/login.tsx" },
  },
  {
    role: "tool_call",
    toolCallId: "c",
    title: "run_command",
    status: "failed",
    content: [],
    rawInput: { command: "pnpm", args: ["test"] },
  },
  { role: "reasoning", content: "secret thoughts" },
  { role: "assistant", content: "The redirect now keeps `?next=`." },
]

describe("read_workspace_chat", () => {
  it("returns the last ask, the turn summary and the last reply by default", async () => {
    const { collections, ports } = setup({
      readChatTranscript: vi.fn(async () => turn),
    })
    addChat(collections, "chat-1", { label: "Chat", createdAt: 1 })

    const out = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
    })) as string

    expect(ports.readChatTranscript).toHaveBeenCalledWith("chat-1")
    expect(out).toContain(
      'Workspace "Fix sign-in" · chat "Chat" [chat-1] · idle'
    )
    expect(out).toContain("Last ask: Now make it keep the query string")
    expect(out).toContain(
      "Turn summary: Read 1 file, edited 1, ran 1 command; failed: pnpm test"
    )
    expect(out).toContain("Last reply:\nThe redirect now keeps `?next=`.")
    expect(out).not.toContain("Earlier answer")
    expect(out).not.toContain("Looking at the router")
    expect(out).not.toContain("secret thoughts")
  })

  it("returns the whole transcript when asked", async () => {
    const { collections, ports } = setup({
      readChatTranscript: vi.fn(async () => turn),
    })
    addChat(collections, "chat-1")

    const out = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
      full: true,
    })) as string

    expect(out).toContain("User: Fix the sign-in redirect")
    expect(out).toContain("Agent: Earlier answer")
    expect(out).toContain("Tool: run_command (failed)")
    expect(out).toContain("Agent: The redirect now keeps `?next=`.")
    expect(out).not.toContain("secret thoughts")
  })

  it("reads a reloaded user turn as it did before the projection (#1252)", async () => {
    const element = {
      ref: "el1",
      route: "/login",
      selector: "button#submit",
      frameLabel: "Sign in",
    }
    const body = `Make ${serializeElement("button#submit", "el1")} blue`
    const footer = buildTargetedElementsFooter([element])
    const { collections, ports } = setup({
      readChatTranscript: vi.fn(async () =>
        renderHistory([
          {
            kind: "record",
            record: {
              role: "user",
              content: wireToContentBlocks(
                prependTurnMarkers(body, {
                  delegatedFrom: "room-chat-1",
                  branch: "fix-sign-in",
                }) + footer
              ),
            },
          },
        ])
      ),
    })
    addChat(collections, "chat-1")

    const full = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
      full: true,
    })) as string
    const last = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
    })) as string

    // The human's text and the element detail, without the server markers.
    expect(full).toContain(`User: ${body}${footer}`)
    expect(last).toContain(`Last ask: ${body}${footer}`)
    expect(full).not.toContain("from coordinator")
  })

  it("keeps the newest messages when the transcript runs long", async () => {
    const long = "x".repeat(WORKSPACE_READ_LIMITS.transcript)
    const { collections, ports } = setup({
      readChatTranscript: vi.fn(async (): Promise<AgentMessage[]> => [
        { role: "user", content: `first ${long}` },
        { role: "assistant", content: "the latest reply" },
      ]),
    })
    addChat(collections, "chat-1")

    const out = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
      full: true,
    })) as string

    expect(out).toContain("earlier characters left out")
    expect(out).toContain("Agent: the latest reply")
    expect(out.length).toBeLessThan(WORKSPACE_READ_LIMITS.transcript + 200)
  })

  it("reads the newest open chat and names the others", async () => {
    const { collections, ports } = setup()
    addChat(collections, "chat-old", { label: "Old", createdAt: 1 })
    addChat(collections, "chat-new", {
      label: "New",
      createdAt: 2,
      isStreaming: true,
    })
    addChat(collections, "chat-closed", { createdAt: 3, closedAt: 4 })

    const out = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
    })) as string

    expect(ports.readChatTranscript).toHaveBeenCalledWith("chat-new")
    expect(out).toContain('chat "New" [chat-new] · working')
    expect(out).toContain('Other chats: "Old" [chat-old]')
    expect(out).toContain("No messages yet.")
  })

  it("never reads a chat from another Workspace", async () => {
    const { collections, ports } = setup()
    collections.chatSessions.set(
      "chat-x",
      baseChat("chat-x", { branchId: "ws-2" })
    )

    const out = await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
      chatId: "chat-x",
    })

    expect(out).toBe('Workspace "Fix sign-in" has no chat chat-x.')
    expect(ports.readChatTranscript).not.toHaveBeenCalled()
  })

  it("says how the last turn ended when it didn't end in a reply", async () => {
    const { collections, ports } = setup({
      readChatTranscript: vi.fn(async (): Promise<AgentMessage[]> => [
        { role: "user", content: "Plan the dark mode toggle" },
        {
          role: "plan",
          content: "1. Add a toggle",
          status: "pending",
          planId: "p1",
        },
      ]),
    })
    addChat(collections, "chat-1")

    const out = (await run(ports, "read_workspace_chat", {
      workspaceId: "ws-1",
    })) as string

    expect(out).toContain(
      "Waiting for the user to approve this plan:\n1. Add a toggle"
    )
    expect(out).toContain("No reply yet.")
  })

  it("answers plainly for an unknown Workspace", async () => {
    const { ports } = setup()
    expect(
      await run(ports, "read_workspace_chat", { workspaceId: "nope" })
    ).toBe("Workspace not found: nope")
  })
})

describe("read_workspace_diff", () => {
  it("reads the checkout's diff against the repository's default branch", async () => {
    const diff = "diff --git a/app/login.tsx b/app/login.tsx\n+keep next\n"
    const { ports } = setup({ readWorkspaceDiff: vi.fn(async () => diff) })

    const out = (await run(ports, "read_workspace_diff", {
      workspaceId: "ws-1",
      path: "app/login.tsx",
    })) as string

    const checkout: WorkspaceCheckout = {
      sandboxName: "sandbox-ws-1",
      ref: "fix-sign-in",
      defaultBranch: "trunk",
    }
    expect(ports.readWorkspaceDiff).toHaveBeenCalledWith(checkout, {
      path: "app/login.tsx",
    })
    expect(out).toContain(
      'Workspace "Fix sign-in" · branch fix-sign-in against origin/trunk'
    )
    expect(out).toContain("+keep next")
  })

  it("says when there are no changes", async () => {
    const { ports } = setup()
    expect(
      await run(ports, "read_workspace_diff", { workspaceId: "ws-1" })
    ).toBe('Workspace "Fix sign-in" has no changes against origin/trunk.')
  })

  it("caps a huge diff", async () => {
    const { ports } = setup({
      readWorkspaceDiff: vi.fn(async () => "+".repeat(200_000)),
    })
    const out = (await run(ports, "read_workspace_diff", {
      workspaceId: "ws-1",
    })) as string
    expect(out.length).toBeLessThan(WORKSPACE_READ_LIMITS.diff + 500)
    expect(out).toContain("(truncated")
  })

  it("reports a checkout it can't read", async () => {
    const { ports } = setup({
      readWorkspaceDiff: vi.fn(async () => {
        throw new Error("its sandbox isn't running")
      }),
    })
    expect(
      await run(ports, "read_workspace_diff", { workspaceId: "ws-1" })
    ).toBe(
      `Couldn't read Workspace "Fix sign-in"'s diff: its sandbox isn't running`
    )
  })
})

describe("read_workspace_file", () => {
  it("reads a file line-numbered, windowed", async () => {
    const { ports } = setup({
      readWorkspaceFile: vi.fn(async () => "one\ntwo\nthree\n"),
    })

    const out = (await run(ports, "read_workspace_file", {
      workspaceId: "ws-1",
      path: "app/login.tsx",
      offset: 2,
      limit: 1,
    })) as string

    expect(ports.readWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxName: "sandbox-ws-1" }),
      "app/login.tsx"
    )
    expect(out).toContain("2\ttwo")
    expect(out).not.toContain("one")
  })

  it("says when the file doesn't exist", async () => {
    const { ports } = setup()
    expect(
      await run(ports, "read_workspace_file", {
        workspaceId: "ws-1",
        path: "missing.ts",
      })
    ).toBe('File not found in Workspace "Fix sign-in": missing.ts')
  })

  it("has no write counterpart", () => {
    const { ports } = setup()
    const names = Object.keys(buildRoomTools("room-1", ports))
    expect(names).not.toContain("write_file")
    expect(names).not.toContain("edit_file")
    expect(names).not.toContain("run_command")
  })
})

describe("view_frame", () => {
  const png = Buffer.from("fake-image")

  function withFrame(overrides: Partial<RoomToolPorts> = {}) {
    const s = setup(overrides)
    s.collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", {
        branchId: "ws-1",
        route: "/login",
        width: 1280,
        height: 800,
      })
    )
    return s
  }

  it("screenshots the live preview through the capturer", async () => {
    const { ports } = withFrame({
      captureFrame: vi.fn(async () => ({ data: png, mediaType: "image/webp" })),
    })

    const out = await run(ports, "view_frame", { frameId: "frame-1" })

    expect(ports.captureFrame).toHaveBeenCalledWith({
      url: "https://ws-1.preview.test/login",
      width: 1280,
      height: 800,
    })
    expect(ports.readFrameCapture).not.toHaveBeenCalled()
    expect(out).toEqual({
      kind: "image",
      caption:
        'Live preview of frame [frame-1] (/login in Workspace "Fix sign-in") at 1280×800.',
      data: png.toString("base64"),
      mediaType: "image/webp",
    })
  })

  it("falls back to the stored Frame Capture when the live capture fails", async () => {
    const { ports } = withFrame({
      readFrameCapture: vi.fn(async () => ({
        data: png,
        mediaType: "image/webp",
        capturedAt: Date.UTC(2026, 8, 28, 12),
      })),
    })

    const out = (await run(ports, "view_frame", { frameId: "frame-1" })) as {
      caption: string
    }

    expect(ports.readFrameCapture).toHaveBeenCalledWith("frame-1")
    expect(out.caption).toBe(
      'Stored capture of frame [frame-1] (/login in Workspace "Fix sign-in") from 2026-09-28T12:00:00.000Z, not live: the live capture failed (no browser).'
    )
  })

  it("uses the stored capture without trying a Workspace with no preview", async () => {
    const { collections, ports } = withFrame({
      readFrameCapture: vi.fn(async () => ({
        data: png,
        mediaType: "image/webp",
        capturedAt: 0,
      })),
    })
    collections.branches.update("ws-1", { previewDomain: "" })

    const out = (await run(ports, "view_frame", { frameId: "frame-1" })) as {
      caption: string
    }

    expect(ports.captureFrame).not.toHaveBeenCalled()
    expect(out.caption).toMatch(/its Workspace has no running preview\.$/)
  })

  it("says so when there's no screenshot at all", async () => {
    const { ports } = withFrame()
    expect(await run(ports, "view_frame", { frameId: "frame-1" })).toBe(
      'No screenshot of frame [frame-1] (/login in Workspace "Fix sign-in"): the live capture failed (no browser), and it has never been captured.'
    )
  })

  it("sends the model the image, and the transcript only the caption", async () => {
    const { ports } = withFrame({
      captureFrame: vi.fn(async () => ({ data: png, mediaType: "image/webp" })),
    })
    const out = await run(ports, "view_frame", { frameId: "frame-1" })

    expect(imageModelOutput({ output: out })).toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: 'Live preview of frame [frame-1] (/login in Workspace "Fix sign-in") at 1280×800.',
        },
        {
          type: "image-data",
          data: png.toString("base64"),
          mediaType: "image/webp",
        },
      ],
    })
    expect(JSON.stringify(toolOutputToContent(out))).not.toContain(
      png.toString("base64")
    )
  })
})

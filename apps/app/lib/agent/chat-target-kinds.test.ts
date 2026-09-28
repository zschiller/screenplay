import { describe, expect, it, vi } from "vitest"

// The agent kind enumerates Skills from its sandbox and the room kind lists
// the member's Terminal Tabs from the database; neither matters to memory.
vi.mock("@/lib/skills/sandbox-index", () => ({
  getMergedSkillIndexForSandbox: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/lib/terminal-tabs", () => ({
  listTerminalTabs: vi.fn().mockResolvedValue([]),
}))

import {
  agentChatTarget,
  markdownLayerChatTarget,
  roomChatTarget,
  type ChatTargetSpec,
} from "@/lib/agent/chat-target-kinds"
import { PLAN_MODE_MARKER } from "@/lib/agent/message-markers"
import { addMemory } from "@/lib/canvas/memory"
import type { RoomDoc } from "@/lib/room-access"
import {
  baseBranch,
  baseDoc,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"

const MESSAGE = "bold the dates"

// The decorator's signature is independent of the spec's target/context type
// params, so this picks out just that field's type and sidesteps the variance
// of `loadContext`/`buildTools` when handing either spec to the helper below.
type Decorator = ChatTargetSpec<never, never>["decorateUserMessage"]

const decorate = (
  decorator: Decorator,
  opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean }
) => decorator?.(MESSAGE, opts) ?? MESSAGE

/**
 * Turn-marker decoration is per target kind: a marker only belongs on a
 * message whose target has something to do with it. A document chat has no
 * `submit_plan` gate and no branch, so it gets a bare message (#743).
 */
describe("decorateUserMessage — per target kind", () => {
  it("prepends the plan marker for a sandbox-backed agent chat", () => {
    const out = decorate(agentChatTarget.decorateUserMessage, {
      planMode: true,
      isFirstMessage: false,
    })

    expect(out).toContain(PLAN_MODE_MARKER)
    expect(out).toContain(MESSAGE)
  })

  it("leaves a document chat's message undecorated even with plan mode on", () => {
    const out = decorate(markdownLayerChatTarget.decorateUserMessage, {
      planMode: true,
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
    expect(out).not.toContain(PLAN_MODE_MARKER)
  })

  it("leaves a Room Target chat's message undecorated", () => {
    const out = decorate(roomChatTarget.decorateUserMessage, {
      planMode: true,
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })

  it("doesn't leak the branch marker into a document chat's first message", () => {
    const out = decorate(markdownLayerChatTarget.decorateUserMessage, {
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })
})

/**
 * The `room` kind (the Coordinator): the whole canvas as context and the
 * Coordinator tools module as its tool set, with no sandbox or document tools.
 */
describe("room chat target", () => {
  it("is its own kind", () => {
    expect(roomChatTarget.kind).toBe("room")
  })

  it("bakes the canvas summary into its system prompt", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      { canvasSummary: 'Documents (1):\n- [doc-1] "Launch spec"', memory: [] },
      {}
    )

    expect(prompt).toContain("Coordinator")
    expect(prompt).toContain('- [doc-1] "Launch spec"')
    expect(prompt).toContain("read_canvas")
  })

  it("runs with the read tools and the arrange tools", () => {
    const room = {
      roomId: "room-1",
      readDoc: async () => {
        throw new Error("not read while building tools")
      },
      mutateDoc: async () => {
        throw new Error("not written while building tools")
      },
    }
    const tools = roomChatTarget.buildTools(room, { userId: "user-1" })

    expect(Object.keys(tools).sort()).toEqual([
      "create_document",
      "create_frames",
      "list_changes",
      "merge_groups",
      "move_group",
      "move_to_group",
      "read_canvas",
      "read_document",
      "read_workspace_chat",
      "read_workspace_diff",
      "read_workspace_file",
      "remove",
      "rename",
      "undo_changes",
      "view_frame",
      "write_memory",
    ])
  })
})

/**
 * Canvas memory (#902): every kind's system prompt carries it, read live from
 * the Room doc, and only the Coordinator's carries the ids it writes with.
 */
describe("canvas memory in every kind's system prompt", () => {
  function roomWithMemory(): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    collections.markdownLayers.set(
      "doc-1",
      baseDoc("doc-1", { title: "Launch spec" })
    )
    addMemory(collections, { text: "Use pnpm, never npm.", source: "member" })
    return {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }

  it("includes memory in a Workspace agent's prompt", async () => {
    const room = roomWithMemory()
    const ctx = await agentChatTarget.loadContext(room, {
      sandboxName: "sb-1",
      branch: "main",
    })
    const prompt = agentChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toContain("Canvas memory")
    expect(prompt).toContain("- Use pnpm, never npm.")
  })

  it("includes memory in a document chat's prompt", async () => {
    const room = roomWithMemory()
    const ctx = await markdownLayerChatTarget.loadContext(room, {
      markdownLayerId: "doc-1",
    })
    const prompt = markdownLayerChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toContain("- Use pnpm, never npm.")
  })

  it("includes memory, with the ids it edits by, in the Coordinator's prompt", async () => {
    const room = roomWithMemory()
    const ctx = await roomChatTarget.loadContext(room, { userId: "user-1" })
    const prompt = roomChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toMatch(/- \[mem-[^\]]+\] Use pnpm, never npm\./)
    expect(prompt).toContain("write_memory")
  })

  it("gives a document chat no memory write tool", () => {
    const tools = markdownLayerChatTarget.buildTools(roomWithMemory(), {
      markdownLayerId: "doc-1",
    })

    expect(Object.keys(tools)).not.toContain("write_memory")
  })
})

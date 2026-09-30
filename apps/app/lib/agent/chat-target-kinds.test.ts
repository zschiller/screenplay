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
  roomChatTarget,
  type ChatTargetSpec,
} from "@/lib/agent/chat-target-kinds"
import { PLAN_MODE_MARKER } from "@/lib/agent/message-markers"
import { addMemory } from "@/lib/canvas/memory"
import type { RoomDoc } from "@/lib/room-access"
import type { ToolContext } from "@/lib/agent/tools"
import {
  documentFragment,
  fragmentBodyToPlainText,
} from "@/lib/yjs/fragment-text"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseRepo,
  makeHarness,
  seedGroup,
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
 * message whose target has something to do with it. The Coordinator has no
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

  it("leaves a Room Target chat's message undecorated", () => {
    const out = decorate(roomChatTarget.decorateUserMessage, {
      planMode: true,
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })
})

/**
 * The `room` kind (the Coordinator): the whole canvas as context and the
 * Coordinator tools module as its tool set, with no sandbox tools.
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

  it("sends the next ask to a fresh Workspace instead of planning one (#1182)", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      { canvasSummary: "", memory: [] },
      {}
    )

    expect(prompt).toContain(
      "Send the next ask that fits its repository to it with `send_to_workspace` rather than planning a new Workspace with `create_workspaces`."
    )
  })

  it("lists the Coordinator's Skills, and only those, in its prompt (#905)", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      { canvasSummary: "", memory: [] },
      {}
    )

    expect(prompt).toContain("**screenplay-try-variants**")
    expect(prompt).not.toContain("screenplay-add-knob")
  })

  it("runs with the Coordinator tools and the shared document reader", () => {
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
      "arrange_groups",
      "create_document",
      "create_frames",
      "create_workspaces",
      "list_changes",
      "merge_groups",
      "move_group",
      "move_to_group",
      "open_pull_request",
      "read_canvas",
      "read_document",
      "read_skill",
      "read_workspace_chat",
      "read_workspace_diff",
      "read_workspace_file",
      "remove",
      "remove_workspace",
      "rename",
      "send_to_workspace",
      "show_on_canvas",
      "stop_workspace",
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
      chatId: "chat-1",
    })
    const prompt = agentChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toContain("Canvas memory")
    expect(prompt).toContain("- Use pnpm, never npm.")
  })

  it("includes memory, with the ids it edits by, in the Coordinator's prompt", async () => {
    const room = roomWithMemory()
    const ctx = await roomChatTarget.loadContext(room, { userId: "user-1" })
    const prompt = roomChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toMatch(/- \[mem-[^\]]+\] Use pnpm, never npm\./)
    expect(prompt).toContain("write_memory")
  })
})

/**
 * A Workspace chat writes Documents (#1314): the Chat Target toolset seam hands
 * it the Document tools, bound to the chat, which creates Documents it owns
 * and edits only those.
 */
describe("a Workspace chat's Document tools", () => {
  function setup() {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    collections.chatSessions.set(
      "chat-1",
      baseChat("chat-1", { branchId: "ws-1" })
    )
    collections.markdownLayers.set(
      "hand-made",
      baseDoc("hand-made", { title: "Notes" })
    )
    collections.markdownLayers.set(
      "theirs",
      baseDoc("theirs", { title: "Other plan", ownerChatId: "chat-2" })
    )
    seedGroup(collections, "g-hand", [
      { kind: "markdown-layer", id: "hand-made" },
    ])
    seedGroup(collections, "g-theirs", [
      { kind: "markdown-layer", id: "theirs" },
    ])
    const room: RoomDoc = {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
    const sandbox: ToolContext = { sandboxName: "sb-1", room, userId: "user-1" }
    const target = { sandboxName: "sb-1", branch: "main", chatId: "chat-1" }
    const tools = agentChatTarget.buildTools(room, target, sandbox)
    const run = (name: string, input: object) =>
      (
        tools[name as keyof typeof tools] as {
          execute: (input: object, opts: never) => Promise<string>
        }
      ).execute(input, {} as never)
    const body = (id: string) =>
      fragmentBodyToPlainText(documentFragment(collections.doc, id))
    return { collections, room, target, tools, run, body }
  }

  it("has the tools to create and edit Documents, and to read any", () => {
    const { tools } = setup()

    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        "create_document",
        "replace_document_body",
        "append_to_document_body",
        "set_document_title",
        "read_document",
      ])
    )
    expect(Object.keys(tools)).not.toContain("write_memory")
  })

  it("creates a Document the chat owns, with its title and body", async () => {
    const { collections, run, body } = setup()

    const out = await run("create_document", {
      title: "Rollout plan",
      content: "Ship to 10% first.",
    })

    const doc = collections.markdownLayers
      .toArray()
      .find((d) => d.title === "Rollout plan")!
    expect(out).toBe(`Created document "Rollout plan" (id ${doc.id}).`)
    expect(doc.ownerChatId).toBe("chat-1")
    expect(body(doc.id)).toBe("Ship to 10% first.")
    expect(
      collections.iframeLayerGroups
        .toArray()
        .some((g) => g.members?.some((m) => m.id === doc.id))
    ).toBe(true)
  })

  it("edits the Documents it made", async () => {
    const { collections, run, body } = setup()
    await run("create_document", { title: "Plan" })
    const id = collections.markdownLayers
      .toArray()
      .find((d) => d.ownerChatId === "chat-1")!.id

    await run("replace_document_body", { document_id: id, content: "One." })
    await run("append_to_document_body", { document_id: id, content: "Two." })
    await run("set_document_title", { document_id: id, title: "Final plan" })

    expect(body(id)).toBe("One.\n\nTwo.")
    expect(collections.markdownLayers.get(id)?.title).toBe("Final plan")
  })

  it("refuses to change a hand-made Document or another chat's", async () => {
    const { collections, run, body } = setup()

    for (const [id, title] of [
      ["hand-made", "Notes"],
      ["theirs", "Other plan"],
    ]) {
      const refusal = `Error: "${title}" wasn't made by this chat, so you can read it but not change it.`
      expect(
        await run("replace_document_body", { document_id: id, content: "x" })
      ).toBe(refusal)
      expect(
        await run("append_to_document_body", { document_id: id, content: "x" })
      ).toBe(refusal)
      expect(
        await run("set_document_title", { document_id: id, title: "x" })
      ).toBe(refusal)
      expect(collections.markdownLayers.get(id)?.title).toBe(title)
      expect(body(id)).toBe("")
    }
  })

  it("marks the chat's own Documents in its prompt", async () => {
    const { collections, room, target } = setup()
    collections.markdownLayers.set(
      "mine",
      baseDoc("mine", { title: "My plan", ownerChatId: "chat-1" })
    )

    const ctx = await agentChatTarget.loadContext(room, target)
    const prompt = agentChatTarget.buildSystemPrompt(ctx!, {})

    expect(prompt).toContain("create_document")
    expect(prompt).toMatch(/My plan.*\(yours\)/)
    expect(prompt).not.toMatch(/Notes.*\(yours\)/)
  })
})

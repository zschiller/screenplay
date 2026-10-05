import { describe, expect, it, vi } from "vitest"
import type { ToolSet } from "ai"

// The agent kind enumerates Skills from its sandbox and the room kind lists
// the member's Terminal Tabs from the database; neither matters to memory.
vi.mock("@/lib/skills/sandbox-index", () => ({
  repoSkillFsForSandbox: vi.fn().mockResolvedValue(null),
}))
// Saved files' and Skills' bytes, in memory.
vi.mock("@/lib/files", async () => {
  const { memoryFileStore } = await import("@/lib/files/store")
  const { canvasFilesOn } = await import("@/lib/files/canvas-files")
  const { accountFilesOn, listFileIndex, memoryFileListStore } =
    await import("@/lib/files/account-files")
  const fileStore = memoryFileStore()
  return {
    fileStore,
    canvasFiles: (room: RoomDoc) => canvasFilesOn(room, fileStore),
    // Account Files (#1521) per person, in memory instead of the KV.
    accountFiles: (userId: string) => {
      if (!accountFileLists.has(userId))
        accountFileLists.set(userId, memoryFileListStore())
      return accountFilesOn(
        userId,
        listFileIndex(accountFileLists.get(userId)!),
        fileStore
      )
    },
  }
})
const accountFileLists = vi.hoisted(
  () => new Map<string, import("@/lib/files/account-files").FileListStore>()
)
// Account Skills' lists (#1558) per person, in memory instead of the KV.
const accountSkillLists = vi.hoisted(
  () => new Map<string, import("@/lib/files/account-files").FileListStore>()
)
vi.mock("@/lib/files/account-store", async () => {
  const { memoryFileListStore } = await import("@/lib/files/account-files")
  return {
    kvAccountSkillStore: (userId: string) => {
      if (!accountSkillLists.has(userId))
        accountSkillLists.set(userId, memoryFileListStore())
      return accountSkillLists.get(userId)!
    },
  }
})
vi.mock("@/lib/terminal-tabs", () => ({
  listTerminalTabs: vi.fn().mockResolvedValue([]),
}))

// Account memory (#1513) per person, in memory instead of the encrypted KV.
const accountStores = vi.hoisted(
  () => new Map<string, import("@/lib/memory/account").AccountMemoryStore>()
)
vi.mock("@/lib/memory/account-store", async () => {
  const { inMemoryAccountMemoryStore } = await import("@/lib/memory/account")
  return {
    kvAccountMemoryStore: (userId: string) => {
      if (!accountStores.has(userId))
        accountStores.set(userId, inMemoryAccountMemoryStore())
      return accountStores.get(userId)!
    },
  }
})

import {
  prepareChatTarget,
  type ChatTargetSpec,
} from "@/lib/agent/chat-target-kinds"
import { repoSkillFsForSandbox } from "@/lib/skills/sandbox-index"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"
import { roomChatTarget } from "@/lib/agent/room-chat-target"
import { sketchChatTarget } from "@/lib/agent/sketch-chat-target"
import { toolsetOn, turnToolset, type ChatTools } from "@/lib/agent/toolset"
import { harnessToolNaming } from "@/lib/agent/harnesses"
import { BARE_TOOL_NAMING, type ToolNaming } from "@/lib/agent/tool-name"
import { PLAN_MODE_MARKER } from "@/lib/agent/message-markers"
import { addMemory, readMemory } from "@/lib/memory/canvas"
import { addAccountMemory, readAccountMemory } from "@/lib/memory/account"
import { kvAccountMemoryStore } from "@/lib/memory/account-store"
import { buildArrangeTools } from "@/lib/agent/room-arrange-tools"
import { buildViewTools } from "@/lib/agent/room-view-tools"
import { buildDocumentTools } from "@/lib/agent/document-tools"
import { buildMockupTools } from "@/lib/agent/mockup-tools"
import type { RoomDoc } from "@/lib/room-access"
import { accountSkills } from "@/lib/skills/account"
import { canvasSkills } from "@/lib/skills/canvas"
import { agentContextFolder } from "@/lib/files/context-folder"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { readDocumentBody } from "@/lib/document-markdown"
import {
  baseBranch,
  baseChat,
  baseDoc,
  baseLayer,
  baseRepo,
  makeHarness,
  seedGroup,
} from "@/test/canvas/harness"

const MESSAGE = "bold the dates"

/** A kind's toolset on the in-process engine. */
const inProcess = (tools: ChatTools) => toolsetOn(tools, "in-process")

// The decorator's signature is independent of the spec's target/context type
// params, so this picks out just that field's type and sidesteps the variance
// of `loadContext`/`tools` when handing either spec to the helper below.
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
    const out = decorate(workspaceChatTarget.decorateUserMessage, {
      planMode: true,
      isFirstMessage: false,
    })

    expect(out).toContain(PLAN_MODE_MARKER)
    expect(out).toContain(MESSAGE)
  })

  it("marks only plan mode on a Room Target chat’s message, never a branch", () => {
    const out = decorate(roomChatTarget.decorateUserMessage, {
      planMode: true,
      branch: "feat/x",
      isFirstMessage: true,
    })
    expect(out).toBe(`[plan mode: enabled] ${MESSAGE}`)
    expect(
      decorate(roomChatTarget.decorateUserMessage, {
        branch: "feat/x",
        isFirstMessage: true,
      })
    ).toBe(MESSAGE)
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
      {
        canvasSummary: 'Documents (1):\n- [doc-1] "Launch spec"',
        skills: [],
        memory: [],
        files: [],
        accountMemory: [],
        accountFiles: [],
        contextFolder: null,
      },
      BARE_TOOL_NAMING
    )

    expect(prompt).toContain("Coordinator")
    expect(prompt).toContain('- [doc-1] "Launch spec"')
    expect(prompt).toContain("read_canvas")
  })

  it("sends the next ask to a fresh Workspace instead of planning one (#1182)", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      {
        canvasSummary: "",
        skills: [],
        memory: [],
        files: [],
        accountMemory: [],
        accountFiles: [],
        contextFolder: null,
      },
      BARE_TOOL_NAMING
    )

    expect(prompt).toContain(
      "Send the next ask that fits its repository to it with `send_to_workspace` rather than planning a new Workspace with `create_workspaces`."
    )
  })

  it("lists the Coordinator’s Skills, and only those, in its prompt (#905)", async () => {
    const { collections } = makeHarness()
    const room: RoomDoc = {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
    const ctx = await roomChatTarget.loadContext(room, { userId: "user-1" })
    const prompt = roomChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)

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
    const tools = inProcess(roomChatTarget.tools(room, { userId: "user-1" }))

    expect(Object.keys(tools).sort()).toEqual([
      "arrange_groups",
      "ask_question",
      "comment_on_issue",
      "create_frames",
      "create_issue",
      "create_workspaces",
      "delete_saved_file",
      "link_issues",
      "list_changes",
      "list_labels",
      "list_saved_files",
      "make_saved_folder",
      "merge_groups",
      "merge_pr",
      "move_group",
      "move_saved_file",
      "move_to_group",
      "open_pull_request",
      "propose_plan",
      "read_canvas",
      "read_document",
      "read_frame_html",
      "read_issue",
      "read_pr_checks",
      "read_pr_diff",
      "read_saved_file",
      "read_skill",
      "read_workspace_chat",
      "read_workspace_diff",
      "read_workspace_file",
      "remove",
      "remove_workspace",
      "rename",
      "review_pr",
      "save_file",
      "save_skill",
      "screenshot_page",
      "search_issues",
      "send_to_chat",
      "send_to_workspace",
      "show_on_canvas",
      "start_chat",
      "stop_workspace",
      "undo_changes",
      "update_issue",
      "view_frame",
      "write_memory",
    ])
  })
})

/**
 * The Coordinator only delegates (#1316): the Chat Target toolset seam gives
 * it no tool that makes or edits a Document or Mockup, and gives a Workspace
 * chat none that arranges the canvas or moves the view, so chats never fight
 * over the layout.
 */
describe("the Coordinator only delegates", () => {
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async () => {
      throw new Error("not read while building tools")
    },
    mutateDoc: async () => {
      throw new Error("not written while building tools")
    },
  }
  const names = (tools: object) => Object.keys(tools)
  const documentAndMockupWrites = [
    ...names(buildDocumentTools({ room, chatId: "chat-1" })),
    ...names(buildMockupTools({ room, chatId: "chat-1" })),
  ].filter((name) => name !== "read_document" && name !== "read_mockup")
  const arrangeAndCamera = [
    ...names(buildArrangeTools(room.mutateDoc, "turn-1")),
    ...names(buildViewTools(room.readDoc)),
  ]

  it("gives the Coordinator no tool that creates or edits a Document or Mockup", () => {
    const tools = names(
      inProcess(roomChatTarget.tools(room, { userId: "user-1" }))
    )

    expect(documentAndMockupWrites).toEqual(
      expect.arrayContaining(["create_document", "create_mockup"])
    )
    for (const name of documentAndMockupWrites) {
      expect(tools).not.toContain(name)
    }
    // It still arranges the canvas, moves the view and starts chats.
    expect(tools).toEqual(
      expect.arrayContaining([
        ...arrangeAndCamera,
        "send_to_workspace",
        "create_workspaces",
      ])
    )
  })

  it("gives a Workspace chat no arrange or camera tools", () => {
    const tools = names(
      inProcess(
        workspaceChatTarget.tools(room, {
          sandboxName: "sb-1",
          chatId: "chat-1",
          userId: "user-1",
        })
      )
    )

    expect(arrangeAndCamera).toEqual(
      expect.arrayContaining(["arrange_groups", "show_on_canvas"])
    )
    for (const name of arrangeAndCamera) {
      expect(tools).not.toContain(name)
    }
    expect(tools).toEqual(expect.arrayContaining(documentAndMockupWrites))
  })

  it("tells the Coordinator to start a chat for a Document or Mockup", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      {
        canvasSummary: "",
        skills: [],
        memory: [],
        files: [],
        accountMemory: [],
        accountFiles: [],
        contextFolder: null,
      },
      BARE_TOOL_NAMING
    )

    expect(prompt).toContain("You can’t write or edit a document or a mockup.")
    expect(prompt).toMatch(
      /start a chat that makes it: send the ask to the Workspace it’s about with `send_to_workspace`/
    )
    expect(prompt).not.toContain("create_document")
    expect(prompt).not.toContain("create_mockup")
  })
})

/**
 * Canvas memory (#902): every kind's system prompt carries it, read live from
 * the Room doc, and only the Coordinator's carries the ids it writes with.
 */
describe("canvas memory in every kind’s system prompt", () => {
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

  it("includes memory in a Workspace agent’s prompt", async () => {
    const room = roomWithMemory()
    const ctx = await workspaceChatTarget.loadContext(room, {
      sandboxName: "sb-1",
      chatId: "chat-1",
      userId: "user-1",
    })
    const prompt = workspaceChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)

    expect(prompt).toContain("Canvas memory")
    expect(prompt).toMatch(/- \[mem-[^\]]+\] Use pnpm, never npm\./)
    expect(prompt).toContain("write_memory")
  })

  it("includes memory, with the ids it edits by, in the Coordinator’s prompt", async () => {
    const room = roomWithMemory()
    const ctx = await roomChatTarget.loadContext(room, { userId: "user-1" })
    const prompt = roomChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)

    expect(prompt).toMatch(/- \[mem-[^\]]+\] Use pnpm, never npm\./)
    expect(prompt).toContain("write_memory")
  })
})

/**
 * Canvas Files (#1514): every kind's system prompt lists the canvas's files by
 * path with size and type, read live from the Room doc, capped with a pointer
 * to `list_saved_files`.
 */
describe("canvas files in every kind’s system prompt", () => {
  function roomWithFiles(count: number): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    const entry = (path: string, kind: "file" | "folder", size = 0) => ({
      id: `file-${path}`,
      path,
      kind,
      size,
      mediaType: kind === "file" ? "text/markdown" : "",
      addedBy: "agent" as const,
      addedById: "chat-1",
      blobKey: kind === "file" ? `canvas/room-1/file-${path}` : "",
      createdAt: 1,
      updatedAt: 1,
    })
    if (count > 0) {
      collections.files.set("file-research", entry("research", "folder"))
    }
    for (let i = 0; i < count; i++) {
      const path = `research/note-${String(i).padStart(3, "0")}.md`
      collections.files.set(`file-${path}`, entry(path, "file", 2150))
    }
    return {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }

  async function prompts(
    room: RoomDoc,
    harnessKey?: string
  ): Promise<Record<string, string>> {
    const workspace = await workspaceChatTarget.loadContext(room, {
      sandboxName: "sb-1",
      chatId: "chat-1",
      userId: "user-1",
      harnessKey,
    })
    const sketch = await sketchChatTarget.loadContext(room, {
      chatId: "chat-2",
      userId: "user-1",
      harnessKey,
    })
    const coordinator = await roomChatTarget.loadContext(room, {
      userId: "user-1",
      coordinatorChatId: "room-chat-1",
      harnessKey,
    })
    return {
      Workspace: workspaceChatTarget.buildSystemPrompt(
        workspace!,
        BARE_TOOL_NAMING
      ),
      Sketch: sketchChatTarget.buildSystemPrompt(sketch!, BARE_TOOL_NAMING),
      Coordinator: roomChatTarget.buildSystemPrompt(
        coordinator!,
        BARE_TOOL_NAMING
      ),
    }
  }

  it("lists each file with its size and type, and each folder", async () => {
    for (const [kind, prompt] of Object.entries(
      await prompts(roomWithFiles(2))
    )) {
      expect(prompt, kind).toContain("Canvas files")
      expect(prompt, kind).toContain("- research/\n")
      expect(prompt, kind).toContain(
        "- research/note-001.md (2.1 KB, text/markdown)"
      )
      expect(prompt, kind).toContain("read_saved_file")
    }
  })

  it("caps the list and points at list_saved_files for the rest", async () => {
    const { Sketch } = await prompts(roomWithFiles(60))
    expect(Sketch).toContain("- research/note-048.md")
    expect(Sketch).not.toContain("- research/note-049.md")
    expect(Sketch).toContain(
      "- …and 11 more: call `list_saved_files` for all of them."
    )
  })

  it("says there are none yet on a canvas with no files", async () => {
    const { Coordinator } = await prompts(roomWithFiles(0))
    expect(Coordinator).toContain("(none yet)")
  })

  // #1524: a harness reads the files from the chat's context folder.
  it("names the chat’s context folder on a harness, read-only", async () => {
    const chats = {
      Workspace: "chat-1",
      Sketch: "chat-2",
      Coordinator: "room-chat-1",
    }
    for (const [kind, prompt] of Object.entries(
      await prompts(roomWithFiles(1), "some-harness")
    )) {
      const folder = agentContextFolder(chats[kind as keyof typeof chats])
      expect(prompt, kind).toContain(`\`${folder}/canvas/\``)
      expect(prompt, kind).toContain(`\`${folder}/account/\``)
      expect(prompt, kind).toContain("changes made in the folder are lost")
    }
  })

  it("names no folder on the in-process engine", async () => {
    for (const [kind, prompt] of Object.entries(
      await prompts(roomWithFiles(1))
    )) {
      expect(prompt, kind).not.toContain("On disk:")
    }
  })
})

/**
 * Account memory (#1513): each kind loads the account memory of the person
 * who sent the turn, not the chat's starter; a turn nobody sent loads none.
 */
describe("account memory at chat target loading", () => {
  async function setup() {
    accountStores.clear()
    await addAccountMemory(kvAccountMemoryStore("ana"), {
      text: "Ana: plain UI copy.",
      source: "member",
    })
    await addAccountMemory(kvAccountMemoryStore("ben"), {
      text: "Ben: small fixes over redesigns.",
      source: "agent",
    })
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    const room: RoomDoc = {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
    return room
  }

  const kinds = {
    Workspace: async (
      room: RoomDoc,
      target: { userId: string; senderless?: boolean }
    ) => {
      const ctx = await workspaceChatTarget.loadContext(room, {
        sandboxName: "sb-1",
        chatId: "chat-1",
        ...target,
      })
      return workspaceChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
    },
    sketch: async (
      room: RoomDoc,
      target: { userId: string; senderless?: boolean }
    ) => {
      const ctx = await sketchChatTarget.loadContext(room, {
        chatId: "chat-1",
        ...target,
      })
      return sketchChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
    },
    Coordinator: async (
      room: RoomDoc,
      target: { userId: string; senderless?: boolean }
    ) => {
      const ctx = await roomChatTarget.loadContext(room, target)
      return roomChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
    },
  }

  for (const [kind, load] of Object.entries(kinds)) {
    it(`reads the sender’s account memory in a ${kind} chat`, async () => {
      const room = await setup()
      const prompt = await load(room, { userId: "ben" })
      expect(prompt).toContain("Account memory (")
      expect(prompt).toMatch(
        /- \[mem-[^\]]+\] Ben: small fixes over redesigns\./
      )
      expect(prompt).not.toContain("Ana:")
    })

    it(`reads no account memory on a ${kind} turn nobody sent`, async () => {
      const room = await setup()
      const prompt = await load(room, { userId: "ana", senderless: true })
      expect(prompt).not.toContain("Account memory (")
      expect(prompt).not.toContain("Ana:")
      expect(prompt).toContain("save to `canvas` only")
    })
  }

  it("leaves the block out when the store can’t be read", async () => {
    const room = await setup()
    accountStores.set("ana", {
      load: () => Promise.reject(new Error("kv down")),
      save: async () => {},
    })
    const prompt = await kinds.Workspace(room, { userId: "ana" })
    expect(prompt).not.toContain("Account memory (")
  })
})

/**
 * Every chat saves memory (#1515): each kind's toolset has `write_memory`,
 * saving account memory to the turn's sender and canvas memory to the Room,
 * and refusing account memory on a turn nobody sent.
 */
describe("every kind saves memory", () => {
  function setup() {
    accountStores.clear()
    const { collections } = makeHarness()
    const room: RoomDoc = {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
    return { room, collections }
  }

  const kinds = {
    Workspace: (
      room: RoomDoc,
      target: { userId: string; senderless?: boolean }
    ) =>
      toolsetOn(
        workspaceChatTarget.tools(room, {
          sandboxName: "sb-1",
          chatId: "chat-1",
          ...target,
        }),
        "in-process"
      ),
    sketch: (room: RoomDoc, target: { userId: string; senderless?: boolean }) =>
      toolsetOn(
        sketchChatTarget.tools(room, { chatId: "chat-1", ...target }),
        "in-process"
      ),
    Coordinator: (
      room: RoomDoc,
      target: { userId: string; senderless?: boolean }
    ) => toolsetOn(roomChatTarget.tools(room, target), "in-process"),
  }

  const write = async (tools: ToolSet, input: Record<string, unknown>) =>
    (await tools.write_memory!.execute!(input, {
      toolCallId: "t1",
      messages: [],
      context: {},
    })) as string

  for (const [kind, toolsFor] of Object.entries(kinds)) {
    it(`saves canvas memory and the sender’s account memory from a ${kind} chat`, async () => {
      const { room, collections } = setup()
      const tools = toolsFor(room, { userId: "ben" })

      await write(tools, { scope: "canvas", action: "add", text: "Use pnpm." })
      await write(tools, {
        scope: "account",
        action: "add",
        text: "Prefers small fixes.",
      })

      expect(readMemory(collections).map((m) => m.text)).toEqual(["Use pnpm."])
      expect(
        (await readAccountMemory(kvAccountMemoryStore("ben"))).map(
          (m) => m.text
        )
      ).toEqual(["Prefers small fixes."])
      expect(await readAccountMemory(kvAccountMemoryStore("ana"))).toEqual([])
    })

    it(`refuses account memory on a ${kind} turn nobody sent`, async () => {
      const { room, collections } = setup()
      const tools = toolsFor(room, { userId: "ana", senderless: true })

      const out = await write(tools, {
        scope: "account",
        action: "add",
        text: "Prefers small fixes.",
      })

      expect(out).toMatch(/nobody sent this turn/)
      expect(await readAccountMemory(kvAccountMemoryStore("ana"))).toEqual([])
      await write(tools, { scope: "canvas", action: "add", text: "Use pnpm." })
      expect(readMemory(collections).map((m) => m.text)).toEqual(["Use pnpm."])
    })
  }
})

/**
 * Account Files (#1521): each kind saves and opens the sender's own files with
 * `scope: "account"`, a chat on another canvas started by the same person
 * lists and reads them, another member never sees them, and a turn nobody
 * sent has none.
 */
describe("account files in every kind", () => {
  function roomOn(roomId: string): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    return {
      roomId,
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }

  type Sender = { userId: string; senderless?: boolean }
  const kinds = {
    Workspace: {
      tools: (room: RoomDoc, target: Sender) =>
        toolsetOn(
          workspaceChatTarget.tools(room, {
            sandboxName: "sb-1",
            chatId: "chat-1",
            ...target,
          }),
          "in-process"
        ),
      prompt: async (room: RoomDoc, target: Sender) => {
        const ctx = await workspaceChatTarget.loadContext(room, {
          sandboxName: "sb-1",
          chatId: "chat-1",
          ...target,
        })
        return workspaceChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
      },
    },
    sketch: {
      tools: (room: RoomDoc, target: Sender) =>
        toolsetOn(
          sketchChatTarget.tools(room, { chatId: "chat-1", ...target }),
          "in-process"
        ),
      prompt: async (room: RoomDoc, target: Sender) => {
        const ctx = await sketchChatTarget.loadContext(room, {
          chatId: "chat-1",
          ...target,
        })
        return sketchChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
      },
    },
    Coordinator: {
      tools: (room: RoomDoc, target: Sender) =>
        toolsetOn(roomChatTarget.tools(room, target), "in-process"),
      prompt: async (room: RoomDoc, target: Sender) => {
        const ctx = await roomChatTarget.loadContext(room, target)
        return roomChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)
      },
    },
  }

  const call = async (
    tools: ToolSet,
    name: string,
    input: Record<string, unknown>
  ) =>
    (await tools[name]!.execute!(input, {
      toolCallId: "t1",
      messages: [],
      context: {},
    })) as string

  for (const [kind, { tools, prompt }] of Object.entries(kinds)) {
    it(`saves the sender’s account file from a ${kind} chat, and their chat on another canvas reads it`, async () => {
      accountFileLists.clear()
      const here = roomOn("room-1")
      const out = await call(tools(here, { userId: "ben" }), "save_file", {
        scope: "account",
        path: "style/voice.md",
        content: "Plain sentences.",
      })
      expect(out).toMatch(/^Saved style\/voice\.md/)
      // Not the canvas's: its own list stays empty.
      expect(
        await call(tools(here, { userId: "ben" }), "list_saved_files", {})
      ).toBe("No saved files yet.")

      const elsewhere = roomOn("room-2")
      for (const other of Object.values(kinds)) {
        const there = other.tools(elsewhere, { userId: "ben" })
        expect(
          await call(there, "list_saved_files", { scope: "account" })
        ).toContain("style/voice.md")
        expect(
          await call(there, "read_saved_file", {
            scope: "account",
            path: "style/voice.md",
          })
        ).toBe("Plain sentences.")
        const text = await other.prompt(elsewhere, { userId: "ben" })
        expect(text).toContain("Account files (")
        expect(text).toContain("- style/voice.md")
      }
    })

    it(`never shows one member’s account files to another in a ${kind} chat`, async () => {
      accountFileLists.clear()
      const room = roomOn("room-1")
      await call(tools(room, { userId: "ben" }), "save_file", {
        scope: "account",
        path: "ben.md",
        content: "Ben’s.",
      })
      const ana = tools(room, { userId: "ana" })
      expect(await call(ana, "list_saved_files", { scope: "account" })).toBe(
        "No saved files yet."
      )
      expect(
        await call(ana, "read_saved_file", { scope: "account", path: "ben.md" })
      ).toMatch(/^Error: No file/)
      const text = await prompt(room, { userId: "ana" })
      expect(text).not.toContain("ben.md")
    })

    it(`gives a ${kind} turn nobody sent no account files`, async () => {
      accountFileLists.clear()
      const room = roomOn("room-1")
      await call(tools(room, { userId: "ana" }), "save_file", {
        scope: "account",
        path: "ana.md",
        content: "Ana’s.",
      })
      const wake = tools(room, { userId: "ana", senderless: true })
      for (const name of ["list_saved_files", "save_file"]) {
        expect(
          await call(wake, name, {
            scope: "account",
            path: "x.md",
            content: "x",
          })
        ).toMatch(/nobody sent this turn/)
      }
      const text = await prompt(room, { userId: "ana", senderless: true })
      expect(text).not.toContain("ana.md")
      expect(text).toContain("Account files: nobody sent this turn")
    })
  }
})

/**
 * Canvas Skills (#1555): any chat saves one, and every chat on the canvas
 * lists it in its prompt from its next turn and reads it, ranked Repo, then
 * Canvas, then App.
 */
describe("canvas skills in every kind", () => {
  function room(): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    return {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }
  const workspaceTarget = {
    sandboxName: "sb-1",
    chatId: "chat-1",
    userId: "user-1",
  }

  async function call(
    tools: Record<string, { execute?: unknown }>,
    name: string,
    input: object
  ): Promise<string> {
    const execute = tools[name]!.execute as (
      input: object,
      options: object
    ) => Promise<string>
    return execute(input, { toolCallId: "t1", messages: [], context: {} })
  }

  const skillMd = (name: string, description: string, body = "") =>
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
  const author = { addedBy: "member" as const, addedById: "user-1" }

  it("a Skill saved on the canvas, the Coordinator and a sketch chat list and read", async () => {
    const r = room()
    const saved = await canvasSkills(r).save({
      name: "release-notes",
      content: skillMd(
        "release-notes",
        "Write release notes.",
        "Group by feature."
      ),
      author,
    })
    expect(saved.ok).toBe(true)

    const coordinator = await prepareChatTarget(r, roomChatTarget, {
      userId: "user-1",
    })
    const sketch = await prepareChatTarget(r, sketchChatTarget, {
      chatId: "s-1",
      userId: "user-1",
    })
    for (const prepared of [coordinator!, sketch!]) {
      expect(prepared.systemPrompt).toContain(
        "- **release-notes**: Write release notes."
      )
      expect(prepared.systemPrompt).toContain("save_skill")
      expect(
        await call(prepared.tools, "read_skill", { name: "release-notes" })
      ).toContain("Group by feature.")
    }
  })

  it("lists a Skill saved mid-chat in the next turn’s prompt and its note for a resumed session", async () => {
    const r = room()
    const before = await prepareChatTarget(
      r,
      workspaceChatTarget,
      workspaceTarget
    )
    expect(before!.systemPrompt).not.toContain("**review**")

    await canvasSkills(r).save({
      name: "review",
      content: skillMd("review", "Review a PR."),
      author,
    })

    const next = await prepareChatTarget(
      r,
      workspaceChatTarget,
      workspaceTarget,
      harnessToolNaming("claude-code", "screenplay")
    )
    expect(next!.systemPrompt).toContain("- **review**: Review a PR.")
    expect(next!.skillsNote).toContain("- **review**: Review a PR.")
    expect(next!.skillsNote).toContain("`mcp__screenplay__read_skill`")
  })

  it("ranks a Repo Skill over a canvas Skill over an App Skill in the prompt", async () => {
    const r = room()
    for (const name of ["deploy", "screenplay-add-knob"]) {
      await canvasSkills(r).save({
        name,
        content: skillMd(name, `Canvas ${name}.`),
        author,
      })
    }
    vi.mocked(repoSkillFsForSandbox).mockResolvedValueOnce({
      list: async (dir) => (dir === ".claude/skills" ? ["deploy"] : null),
      read: async (path) =>
        path === ".claude/skills/deploy/SKILL.md"
          ? skillMd("deploy", "Repo deploy.")
          : null,
    })

    const ctx = await workspaceChatTarget.loadContext(r, workspaceTarget)
    const prompt = workspaceChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)

    expect(prompt).toContain("- **deploy**: Repo deploy.")
    expect(prompt).not.toContain("Canvas deploy.")
    expect(prompt).toContain(
      "- **screenplay-add-knob**: Canvas screenplay-add-knob."
    )
    expect(ctx!.skills.filter((s) => s.name === "screenplay-add-knob")).toEqual(
      [
        {
          name: "screenplay-add-knob",
          description: "Canvas screenplay-add-knob.",
          origin: "canvas",
        },
      ]
    )
  })

  it("gives the Coordinator canvas Skills but no Repo Skills", async () => {
    const r = room()
    vi.mocked(repoSkillFsForSandbox).mockClear()
    const ctx = await roomChatTarget.loadContext(r, { userId: "user-1" })

    expect(repoSkillFsForSandbox).not.toHaveBeenCalled()
    expect(ctx!.skills.every((s) => s.origin !== "repo")).toBe(true)
  })
})

/**
 * Account Skills (#1558): any chat saves one to the person who sent its turn,
 * and every chat that person messages, on any canvas, lists and reads it,
 * ranked below the canvas's. A turn nobody sent has none and can't save one.
 */
describe("account skills in every kind", () => {
  function roomOn(roomId: string): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    return {
      roomId,
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }

  type Sender = { userId: string; senderless?: boolean }
  const kinds = {
    Workspace: {
      tools: (room: RoomDoc, target: Sender) =>
        inProcess(
          workspaceChatTarget.tools(room, {
            sandboxName: "sb-1",
            chatId: "chat-1",
            ...target,
          })
        ),
      prepare: (room: RoomDoc, target: Sender) =>
        prepareChatTarget(room, workspaceChatTarget, {
          sandboxName: "sb-1",
          chatId: "chat-1",
          ...target,
        }),
    },
    sketch: {
      tools: (room: RoomDoc, target: Sender) =>
        inProcess(
          sketchChatTarget.tools(room, { chatId: "chat-1", ...target })
        ),
      prepare: (room: RoomDoc, target: Sender) =>
        prepareChatTarget(room, sketchChatTarget, {
          chatId: "chat-1",
          ...target,
        }),
    },
    Coordinator: {
      tools: (room: RoomDoc, target: Sender) =>
        inProcess(roomChatTarget.tools(room, target)),
      prepare: (room: RoomDoc, target: Sender) =>
        prepareChatTarget(room, roomChatTarget, target),
    },
  }

  const call = async (tools: ToolSet, name: string, input: object) =>
    (await tools[name]!.execute!(input, {
      toolCallId: "t1",
      messages: [],
      context: {},
    })) as string

  const skillMd = (name: string, description: string, body = "") =>
    `---\nname: ${name}\ndescription: ${description}\n---\n${body}`
  const saveTo = async (
    skills: ReturnType<typeof accountSkills>,
    name: string,
    content: string
  ) => {
    const saved = await skills.save({
      name,
      content,
      author: { addedBy: "member", addedById: "ben" },
    })
    expect(saved.ok).toBe(true)
  }

  for (const [kind, { tools, prepare }] of Object.entries(kinds)) {
    it(`the sender’s account skill offered in a ${kind} chat and saved, every kind on another canvas uses it`, async () => {
      accountSkillLists.clear()
      const here = roomOn("room-1")
      const content = skillMd(
        "voice",
        "Ben’s writing voice.",
        "Plain sentences."
      )
      expect(
        await call(tools(here, { userId: "ben" }), "save_skill", {
          scope: "account",
          name: "voice",
          content,
        })
      ).toContain('Showed "voice" to the person as a card')
      expect(await accountSkills("ben").list()).toEqual([])
      // The person presses Save to account.
      await saveTo(accountSkills("ben"), "voice", content)

      const elsewhere = roomOn("room-2")
      for (const other of Object.values(kinds)) {
        const prepared = (await other.prepare(elsewhere, { userId: "ben" }))!
        expect(prepared.systemPrompt).toContain(
          "- **voice**: Ben’s writing voice."
        )
        expect(prepared.skillsNote).toContain("- **voice**")
        expect(prepared.systemPrompt).toContain('`scope: "account"`')
        expect(
          await call(prepared.tools, "read_skill", { name: "voice" })
        ).toContain("Plain sentences.")
      }
    })

    it(`never gives one member’s account skills to another’s turn in a ${kind} chat`, async () => {
      accountSkillLists.clear()
      const room = roomOn("room-1")
      await saveTo(
        accountSkills("ben"),
        "voice",
        skillMd("voice", "Ben’s writing voice.")
      )
      // Ana's turn in the same chat: her own, never Ben's.
      const ana = (await prepare(room, { userId: "ana" }))!
      expect(ana.systemPrompt).not.toContain("Ben’s writing voice.")
      expect(await call(ana.tools, "read_skill", { name: "voice" })).toMatch(
        /^Unknown skill/
      )
      // And her saves go to her.
      await saveTo(
        accountSkills("ana"),
        "voice",
        skillMd("voice", "Ana’s writing voice.")
      )
      const ben = (await prepare(room, { userId: "ben" }))!
      expect(ben.systemPrompt).toContain("Ben’s writing voice.")
      expect(ben.systemPrompt).not.toContain("Ana’s writing voice.")
    })

    it(`gives a ${kind} turn nobody sent no account skills`, async () => {
      accountSkillLists.clear()
      const room = roomOn("room-1")
      await saveTo(
        accountSkills("ana"),
        "voice",
        skillMd("voice", "Ana’s writing voice.")
      )
      const wake = (await prepare(room, { userId: "ana", senderless: true }))!
      expect(wake.systemPrompt).not.toContain("Ana’s writing voice.")
      expect(wake.systemPrompt).toContain("it has no account skills")
      // An offer is only a card, whoever presses it.
      expect(
        await call(wake.tools, "save_skill", {
          scope: "account",
          name: "voice",
          content: skillMd("voice", "x"),
        })
      ).toContain('Showed "voice" to the person as a card')
      expect(await accountSkills("ana").list()).toMatchObject([
        { name: "voice", description: "Ana’s writing voice." },
      ])
      expect(await canvasSkills(room).list()).toEqual([])
    })
  }

  it("ranks a canvas skill over an account skill of the same name", async () => {
    accountSkillLists.clear()
    const room = roomOn("room-1")
    await saveTo(
      canvasSkills(room),
      "review",
      skillMd("review", "Canvas review.", "The canvas’s way.")
    )
    await saveTo(
      accountSkills("ben"),
      "review",
      skillMd("review", "My review.", "My way.")
    )

    const prepared = (await kinds.sketch.prepare(room, { userId: "ben" }))!
    expect(prepared.systemPrompt).toContain("- **review**: Canvas review.")
    expect(prepared.systemPrompt).not.toContain("My review.")
    expect(
      await call(prepared.tools, "read_skill", { name: "review" })
    ).toContain("The canvas’s way.")
  })
})

/**
 * A Workspace chat writes Documents (#1314): the Chat Target toolset seam hands
 * it the Document tools, bound to the chat, which creates Documents and edits
 * any (#1724).
 */
describe("a Workspace chat’s Document tools", () => {
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
    collections.chatSessions.set("chat-2", baseChat("chat-2"))
    collections.markdownLayers.set(
      "hand-made",
      baseDoc("hand-made", { title: "Notes" })
    )
    collections.markdownLayers.set(
      "theirs",
      baseDoc("theirs", { title: "Other plan", lastChangedByChatId: "chat-2" })
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
    const target = { sandboxName: "sb-1", chatId: "chat-1", userId: "user-1" }
    const tools = inProcess(workspaceChatTarget.tools(room, target))
    const run = (name: string, input: object) =>
      (
        tools[name as keyof typeof tools] as {
          execute: (input: object, opts: never) => Promise<string>
        }
      ).execute(input, {} as never)
    const body = (id: string) =>
      readDocumentBody(documentFragment(collections.doc, id))
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
    expect(Object.keys(tools)).not.toContain("send_to_workspace")
  })

  it("creates a Document the chat changed last, with its title and body", async () => {
    const { collections, run, body } = setup()

    const out = await run("create_document", {
      title: "Rollout plan",
      content: "Ship to 10% first.",
    })

    const doc = collections.markdownLayers
      .toArray()
      .find((d) => d.title === "Rollout plan")!
    expect(out).toBe(`Created document "Rollout plan" (id ${doc.id}).`)
    expect(doc.lastChangedByChatId).toBe("chat-1")
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
      .find((d) => d.lastChangedByChatId === "chat-1")!.id

    await run("replace_document_body", { document_id: id, content: "One." })
    await run("append_to_document_body", { document_id: id, content: "Two." })
    await run("set_document_title", { document_id: id, title: "Final plan" })

    expect(body(id)).toBe("One.\n\nTwo.")
    expect(collections.markdownLayers.get(id)?.title).toBe("Final plan")
  })

  it("edits a hand-made Document, another chat’s, and one from before #1724", async () => {
    const { collections, run, body } = setup()
    collections.markdownLayers.set(
      "old",
      baseDoc("old", { title: "Old plan", ownerChatId: "chat-2" })
    )

    for (const id of ["hand-made", "theirs", "old"]) {
      expect(
        await run("replace_document_body", { document_id: id, content: "One." })
      ).toBe("Replaced document body (4 characters).")
      await run("append_to_document_body", { document_id: id, content: "Two." })
      await run("set_document_title", { document_id: id, title: `${id} 2` })
      expect(body(id)).toBe("One.\n\nTwo.")
      expect(collections.markdownLayers.get(id)).toMatchObject({
        title: `${id} 2`,
        lastChangedByChatId: "chat-1",
      })
    }
  })

  it("marks the Documents the chat changed last in its prompt", async () => {
    const { collections, room, target } = setup()
    collections.markdownLayers.set(
      "mine",
      baseDoc("mine", { title: "My plan", lastChangedByChatId: "chat-1" })
    )
    collections.markdownLayers.set(
      "old",
      baseDoc("old", { title: "Old plan", ownerChatId: "chat-1" })
    )

    const ctx = await workspaceChatTarget.loadContext(room, target)
    const prompt = workspaceChatTarget.buildSystemPrompt(ctx!, BARE_TOOL_NAMING)

    expect(prompt).toContain("create_document")
    expect(prompt).toMatch(/My plan \(you changed it last\)/)
    expect(prompt).toMatch(/Old plan \(you changed it last\)/)
    expect(prompt).not.toMatch(/Notes \(/)
    expect(prompt).not.toMatch(/Other plan \(/)
  })
})

describe("frame reads in every chat (#1311)", () => {
  /** Two Workspaces, each with a frame; neither preview is running. */
  function canvasWithFrames(): RoomDoc {
    const { collections } = makeHarness()
    collections.repos.set("repo-1", baseRepo("repo-1"))
    collections.branches.set(
      "ws-1",
      baseBranch("ws-1", { title: "Sign-in", sandboxName: "sb-1" })
    )
    collections.branches.set(
      "ws-2",
      baseBranch("ws-2", { title: "Pricing", sandboxName: "sb-2" })
    )
    collections.iframeLayers.set(
      "frame-1",
      baseLayer("frame-1", { branchId: "ws-1", route: "/login" })
    )
    collections.iframeLayers.set(
      "frame-2",
      baseLayer("frame-2", { branchId: "ws-2", route: "/pricing" })
    )
    collections.markdownLayers.set("doc-1", baseDoc("doc-1"))
    return {
      roomId: "room-1",
      readDoc: async (fn) => fn(collections),
      mutateDoc: async (fn) => fn(collections),
    }
  }

  const toolsOf = (room: RoomDoc) => ({
    workspace: inProcess(
      workspaceChatTarget.tools(room, {
        sandboxName: "sb-1",
        chatId: "chat-1",
        userId: "user-1",
      })
    ),
  })

  const call = (tool: { execute?: unknown }, input: object) =>
    (tool.execute as (i: object, o: object) => Promise<unknown>)(input, {
      toolCallId: "t1",
      messages: [],
    })

  it("gives a Workspace agent frame reads", () => {
    const { workspace } = toolsOf(canvasWithFrames())
    expect(Object.keys(workspace)).toEqual(
      expect.arrayContaining(["view_frame", "read_frame_html"])
    )
  })

  it("lets a Workspace agent read another Workspace’s frame", async () => {
    const { workspace } = toolsOf(canvasWithFrames())

    expect(await call(workspace.read_frame_html!, { frameId: "frame-2" })).toBe(
      'Can’t read the page in frame [frame-2] (/pricing in Workspace "Pricing"): its Workspace has no running preview.'
    )
  })

  it("reads a Workspace agent’s own frame when none is named", async () => {
    const { workspace } = toolsOf(canvasWithFrames())

    expect(await call(workspace.read_frame_html!, {})).toBe(
      'Can’t read the page in frame [frame-1] (/login in Workspace "Sign-in"): its Workspace has no running preview.'
    )
  })
})

describe("sketchChatTarget (a chat with no repository)", () => {
  it("gets the Document, Mockup, layer read and question tools, and nothing that touches code", () => {
    const room = {
      roomId: "room-1",
      readDoc: async () => {
        throw new Error("not read while building tools")
      },
      mutateDoc: async () => {
        throw new Error("not written while building tools")
      },
    }
    const names = Object.keys(
      inProcess(sketchChatTarget.tools(room, { chatId: "s-1", userId: "u-1" }))
    )
    expect(names).toEqual(
      expect.arrayContaining([
        ...Object.keys(buildDocumentTools({ room, chatId: "s-1" })),
        ...Object.keys(buildMockupTools({ room, chatId: "s-1" })),
        "read_document",
        "read_skill",
        "ask_question",
        // It drives a Mockup in the asker's view (#1391).
        "frame_click",
        "frame_screenshot",
      ])
    )
    expect(names).not.toContain("bash")
    expect(names).not.toContain("send_to_workspace")
  })

  it("writes its prompt around Mockups and Documents, with no repository", () => {
    const prompt = sketchChatTarget.buildSystemPrompt(
      {
        chatId: "s-1",
        layerDirectory: { documents: [] },
        skills: [],
        memory: [],
        files: [],
        accountMemory: [],
        accountFiles: [],
        contextFolder: null,
      },
      BARE_TOOL_NAMING
    )
    expect(prompt).toMatch(/no repository/i)
    expect(prompt).toContain("create_mockup")
  })
})

/**
 * A prompt names tools only through its turn's toolset (#1487): naming one
 * the turn doesn't have throws, and no tool name is written into a prompt by
 * hand past that check.
 */
describe("every kind’s prompt names only tools its turn has", () => {
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async () => {
      throw new Error("not read while building tools")
    },
    mutateDoc: async () => {
      throw new Error("not written while building tools")
    },
  }
  const memory = [{ id: "mem-1", text: "Use pnpm.", source: "member" }] as never
  const layerDirectory = {
    documents: [{ id: "doc-1", title: "Plan", lastChangedByChatId: "chat-1" }],
  }
  const kinds = [
    {
      kind: "Workspace",
      tools: () =>
        workspaceChatTarget.tools(room, {
          sandboxName: "sb-1",
          chatId: "chat-1",
          userId: "user-1",
        }),
      prompt: (naming: ToolNaming) =>
        workspaceChatTarget.buildSystemPrompt(
          {
            chatId: "chat-1",
            repoSystemPrompt: "A Next.js app.",
            settingUp: false,
            layerDirectory,
            skills: [
              { name: "screenplay-add-knob", description: "x", origin: "app" },
            ],
            memory,
            files: [],
            accountMemory: [],
            accountFiles: [],
            contextFolder: null,
          },
          naming
        ),
    },
    {
      kind: "Coordinator",
      tools: () => roomChatTarget.tools(room, { userId: "user-1" }),
      prompt: (naming: ToolNaming) =>
        roomChatTarget.buildSystemPrompt(
          {
            canvasSummary: "Documents (1)",
            skills: [],
            memory,
            files: [],
            accountMemory: [],
            accountFiles: [],
            contextFolder: null,
          },
          naming
        ),
    },
    {
      kind: "Sketch",
      tools: () =>
        sketchChatTarget.tools(room, { chatId: "chat-1", userId: "user-1" }),
      prompt: (naming: ToolNaming) =>
        sketchChatTarget.buildSystemPrompt(
          {
            chatId: "chat-1",
            layerDirectory,
            skills: [],
            memory,
            files: [],
            accountMemory: [],
            accountFiles: [],
            contextFolder: null,
          },
          naming
        ),
    },
  ]
  const engines: [string, ToolNaming][] = [
    ["in process", BARE_TOOL_NAMING],
    ["on Claude Code", harnessToolNaming("claude-code", "screenplay")],
    ["on Codex", harnessToolNaming("codex", "screenplay")],
  ]
  /** Every tool any kind has, the names a prompt could write by hand. */
  const everyTool = new Set(
    kinds.flatMap(({ tools }) => Object.keys(inProcess(tools())))
  )

  for (const { kind, tools, prompt } of kinds) {
    for (const [engine, naming] of engines) {
      it(`a ${kind} chat ${engine}`, () => {
        const toolset = turnToolset(tools(), naming)
        const text = prompt(toolset.naming)
        const has = Object.keys(toolset.tools)
        // Multi-word names only: `rename`, `grep` and the like are words too.
        for (const name of everyTool) {
          if (!name.includes("_") || has.includes(name)) continue
          expect(text).not.toMatch(
            new RegExp(`(?<![a-z0-9])${name}(?![a-z0-9_])`)
          )
        }
      })
    }
  }

  it("refuses a prompt that names a tool its turn doesn’t have", () => {
    const { naming } = turnToolset(
      sketchChatTarget.tools(room, { chatId: "chat-1", userId: "user-1" })
    )
    expect(naming.name("create_mockup")).toBe("create_mockup")
    expect(() => naming.name("run_command")).toThrow(/run_command/)
  })
})

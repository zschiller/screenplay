import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { baseBranch, baseRepo, makeHarness } from "@/test/canvas/harness"
import type { RoomCollections } from "@/lib/yjs/schema"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The Coordinator's MCP route (#903), driven the way a harness adapter drives
 * it: JSON-RPC over POST with the session's bearer token. The Room is a bare
 * harness doc; Room Access and Terminal Tabs are stubbed.
 */

const localMode = vi.hoisted(() => ({ isLocalBuild: true }))
vi.mock("@/lib/local-mode", () => localMode)

let collections: RoomCollections
const openRoomForRoute = vi.fn(async (roomId: string, _chatId?: string) => ({
  roomId,
  userId: "local-user",
  role: "owner",
  readDoc: async <T>(fn: (c: RoomCollections) => T) => fn(collections),
  mutateDoc: async <T>(fn: (c: RoomCollections) => T) => fn(collections),
}))
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: (roomId: string, chatId?: string) =>
    openRoomForRoute(roomId, chatId),
}))
vi.mock("@/lib/terminal-tabs", () => ({ listTerminalTabs: async () => [] }))
// What the Coordinator's Workspace tools drive, standing in for GitHub and
// the Sandboxes.
const live = vi.hoisted(() => ({
  startBranchProvisioning: vi.fn(async () => {}),
  createGitHubPr: vi.fn(async () => ({
    url: "https://github.com/acme/web/pull/7",
    number: 7,
  })),
  deleteSandboxes: vi.fn(async () => {}),
}))
vi.mock("@/lib/branch/provisioning-live", () => ({
  startBranchProvisioning: live.startBranchProvisioning,
}))
vi.mock("@/lib/github-pr", () => ({ createGitHubPr: live.createGitHubPr }))
vi.mock("@/lib/sandbox/lifecycle", () => ({
  deleteSandboxes: live.deleteSandboxes,
}))
vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: async () => null,
}))
// The Workspace's env var value, which no tool output may carry (#1416).
const SECRET = "correct-horse-battery-staple"
vi.mock("@/lib/env-store", () => ({
  sandboxSecrets: async (sandboxName: string) =>
    sandboxName ? ["correct-horse-battery-staple"] : [],
}))
// Saved files' and Skills' bytes, in memory.
vi.mock("@/lib/files", async () => {
  const { memoryFileStore } = await import("@/lib/files/store")
  const { canvasFilesOn } = await import("@/lib/files/canvas-files")
  const { accountFilesOn, listFileIndex, memoryFileListStore } =
    await import("@/lib/files/account-files")
  const fileStore = memoryFileStore()
  const lists = new Map<string, ReturnType<typeof memoryFileListStore>>()
  return {
    fileStore,
    canvasFiles: (room: RoomDoc) => canvasFilesOn(room, fileStore),
    accountFiles: (userId: string) => {
      if (!lists.has(userId)) lists.set(userId, memoryFileListStore())
      return accountFilesOn(
        userId,
        listFileIndex(lists.get(userId)!),
        fileStore
      )
    },
  }
})
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
// Each person's account memory, in memory.
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
// The Sandbox is unreachable, so read_skill falls back to the App Skills.
vi.mock("@/lib/sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sandbox")>()),
  sandboxProvider: {
    get: async () => {
      throw new Error("no sandbox in tests")
    },
  },
}))
// A Workspace token's dev server, standing in for the Sandbox.
const devServerPorts = vi.hoisted(() => vi.fn())
vi.mock("@/lib/agent/dev-server-ports", () => ({
  liveDevServerPorts: (opts: unknown) => {
    devServerPorts(opts)
    return {
      status: async () => ({
        command: "pnpm dev",
        localUrl: "http://localhost:4123",
        answering: false,
      }),
      readLog: async () =>
        "Error: Cannot find module 'next'\nSTRIPE_KEY=correct-horse-battery-staple\n",
      restart: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      waitUntilAnswering: async () => true,
    }
  },
}))

import { DELETE, GET, POST } from "./route"
import {
  COORDINATOR_MCP_SERVER_NAME,
  coordinatorToken,
} from "@/lib/agent/coordinator-mcp"
import { buildAgentSystemPrompt } from "@/lib/agent/config"
import { harnessToolNaming } from "@/lib/agent/tool-name"
import { toolsetOn, type ChatTools } from "@/lib/agent/toolset"
import { roomChatTarget } from "@/lib/agent/room-chat-target"
import { canvasSkills } from "@/lib/skills/canvas"
import { sketchChatTarget } from "@/lib/agent/sketch-chat-target"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"
import { readAccountMemory } from "@/lib/memory/account"
import { kvAccountMemoryStore } from "@/lib/memory/account-store"
import { readMemory } from "@/lib/memory/canvas"

const PORT = process.env.PORT || "3000"
const binding = { roomId: "room-1", chatId: "room-chat-room-1" }

function rpc(
  body: unknown,
  headers: Record<string, string> = {
    authorization: `Bearer ${coordinatorToken(binding)}`,
  }
): Request {
  return new Request(`http://127.0.0.1:${PORT}/api/agent/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  collections = makeHarness().collections
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", { title: "Fix sign-in redirect", ref: "fix-sign-in" })
  )
})

afterEach(() => {
  localMode.isLocalBuild = true
  openRoomForRoute.mockClear()
  vi.clearAllMocks()
})

describe("the Coordinator’s MCP route", () => {
  it("answers initialize with the tools capability", async () => {
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-code", version: "1" },
        },
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "screenplay" },
      },
    })
  })

  it("acknowledges a notification with 202 and no body", async () => {
    const res = await POST(
      rpc({ jsonrpc: "2.0", method: "notifications/initialized" })
    )
    expect(res.status).toBe(202)
    expect(await res.text()).toBe("")
  })

  it("lists the Coordinator’s tools with read-only annotations", async () => {
    const res = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
    const { result } = await res.json()
    const readCanvas = result.tools.find(
      (t: { name: string }) => t.name === "read_canvas"
    )
    expect(readCanvas).toMatchObject({
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    })
    expect(readCanvas.description).toMatch(/canvas/)
    // It writes a Workspace turn, so it isn't read-only, but it destroys
    // nothing and stays on this machine: Codex runs it without asking.
    expect(
      result.tools.find((t: { name: string }) => t.name === "send_to_workspace")
    ).toMatchObject({
      annotations: { destructiveHint: false, openWorldHint: false },
    })
  })

  it("runs read_canvas against the token’s Room", async () => {
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "read_canvas", arguments: {} },
      })
    )
    const { result } = await res.json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('"Fix sign-in redirect"')
    expect(openRoomForRoute).toHaveBeenCalledWith("room-1", "room-chat-room-1")
  })

  const toolCall = (id: number, name: string, args: Record<string, unknown>) =>
    rpc({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    })

  // No Coordinator tool asks first (#1217): each runs when the harness calls
  // it and returns its result in the same turn.
  it("creates Workspaces right away", async () => {
    collections.repos.set("repo-1", baseRepo("repo-1"))
    const { result } = await (
      await POST(
        toolCall(6, "create_workspaces", {
          workspaces: [
            { title: "Fix", repository: "owner/repo", prompt: "Fix it." },
          ],
        })
      )
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toMatch(/^Started 1 of 1 Workspace/)
    const created = collections.branches
      .toArray()
      .find((b) => b.title === "Fix")
    expect(created).toMatchObject({ status: "creating" })
    expect(live.startBranchProvisioning).toHaveBeenCalledTimes(1)
  })

  it("opens a Workspace’s pull request right away", async () => {
    collections.repos.set("repo-1", baseRepo("repo-1"))
    const { result } = await (
      await POST(toolCall(7, "open_pull_request", { workspace_id: "ws-1" }))
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toBe(
      'Opened PR #7 for "Fix sign-in redirect": https://github.com/acme/web/pull/7'
    )
    expect(live.createGitHubPr).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxName: "sandbox-ws-1" })
    )
    expect(collections.branches.get("ws-1")).toMatchObject({ prNumber: 7 })
  })

  it("removes a Workspace right away", async () => {
    const { result } = await (
      await POST(toolCall(8, "remove_workspace", { workspace_id: "ws-1" }))
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toMatch(/^Removed "Fix sign-in redirect"/)
    expect(collections.branches.get("ws-1")).toBeUndefined()
    expect(live.deleteSandboxes).toHaveBeenCalledWith(["sandbox-ws-1"])
  })

  // A refusal is the call's result, not an error, so the harness shows it as
  // a finished step (#1231).
  it("returns a refusal as the call’s result", async () => {
    const removal = await (
      await POST(toolCall(9, "remove_workspace", { workspace_id: "no-such" }))
    ).json()
    expect(removal.result.isError).toBe(false)
    expect(removal.result.content[0].text).toMatch(
      /No Workspace has the id no-such/
    )

    // ws-1's repository isn't on the canvas, so it isn't on GitHub.
    const pr = await (
      await POST(toolCall(10, "open_pull_request", { workspace_id: "ws-1" }))
    ).json()
    expect(pr.result.isError).toBe(false)
    expect(pr.result.content[0].text).toBe(
      '"Fix sign-in redirect" isn’t in a GitHub repository, so it can’t have a pull request.'
    )
    expect(live.createGitHubPr).not.toHaveBeenCalled()
  })

  it("still fails a call whose tool throws", async () => {
    const { result } = await (
      await POST(toolCall(11, "stop_workspace", { workspace_id: "no-such" }))
    ).json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No Workspace has the id no-such/)
  })

  it("answers an unknown tool with a JSON-RPC error", async () => {
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "delete_everything", arguments: {} },
      })
    )
    expect((await res.json()).error.code).toBe(-32602)
  })

  it("refuses a request without a token it minted", async () => {
    const ping = { jsonrpc: "2.0", id: 5, method: "ping" }
    expect((await POST(rpc(ping, {}))).status).toBe(401)
    expect(
      (await POST(rpc(ping, { authorization: "Bearer not-a-token" }))).status
    ).toBe(401)
    expect(openRoomForRoute).not.toHaveBeenCalled()
  })

  it("refuses a browser page from another origin (DNS rebinding)", async () => {
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 6, method: "ping" },
        {
          authorization: `Bearer ${coordinatorToken(binding)}`,
          origin: `http://evil.example:${PORT}`,
        }
      )
    )
    expect(res.status).toBe(403)
  })

  it("accepts the sidecar’s own origin", async () => {
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 7, method: "ping" },
        {
          authorization: `Bearer ${coordinatorToken(binding)}`,
          origin: `http://127.0.0.1:${PORT}`,
        }
      )
    )
    expect(res.status).toBe(200)
  })

  it("answers malformed JSON with a parse error", async () => {
    const res = await POST(rpc("{not json"))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(-32700)
  })

  it("offers no server-to-client stream", async () => {
    const req = new Request(`http://127.0.0.1:${PORT}/api/agent/mcp`)
    expect((await GET(req)).status).toBe(405)
    expect((await DELETE(req)).status).toBe(405)
  })

  it("does not exist outside the local build", async () => {
    localMode.isLocalBuild = false
    const res = await POST(rpc({ jsonrpc: "2.0", id: 8, method: "ping" }))
    expect(res.status).toBe(404)
  })
})

describe("a Workspace chat’s MCP route", () => {
  const workspace = {
    roomId: "room-1",
    chatId: "chat-ws-1",
    sandboxName: "sp-ws-1",
  }
  const call = (id: number, method: string, params?: unknown) =>
    POST(
      rpc(
        { jsonrpc: "2.0", id, method, params },
        { authorization: `Bearer ${coordinatorToken(workspace)}` }
      )
    )

  it("lists its dev server’s tools, its frame reads, Frame Drive (#1389), its Document and Mockup tools, other Workspaces' code reads (#1315), Question Cards, saved files (#1514), its PR tool (#1480) and its Skill tools (#1555)", async () => {
    const { result } = await (await call(1, "tools/list")).json()
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      "read_dev_server_logs",
      "restart_dev_server",
      "stop_dev_server",
      "start_dev_server",
      "view_frame",
      "read_frame_html",
      "frame_start_driving",
      "frame_open",
      "frame_elements",
      "frame_screenshot",
      "frame_click",
      "frame_type",
      "frame_key",
      "frame_scroll",
      "frame_select",
      "frame_drag",
      "frame_hover",
      "frame_stop_driving",
      "create_document",
      "replace_document_body",
      "append_to_document_body",
      "set_document_title",
      "create_mockup",
      "update_mockup",
      "read_mockup",
      "read_code_file",
      "search_code",
      "find_code_files",
      "read_document",
      "ask_question",
      "write_memory",
      "list_saved_files",
      "read_saved_file",
      "save_file",
      "move_saved_file",
      "delete_saved_file",
      "make_saved_folder",
      "create_pr",
      "read_skill",
      "save_skill",
      "delete_skill",
    ])
    const annotations = (name: string) =>
      result.tools.find((t: { name: string }) => t.name === name).annotations
    expect(annotations("read_dev_server_logs")).toMatchObject({
      readOnlyHint: true,
    })
    expect(annotations("read_frame_html")).toMatchObject({ readOnlyHint: true })
    // Driving a frame changes only the person's own page: never destructive.
    expect(annotations("frame_elements")).toMatchObject({ readOnlyHint: true })
    expect(annotations("frame_click")).toMatchObject({ destructiveHint: false })
    // Stopping and starting the dev server loses nothing: never destructive.
    for (const name of ["stop_dev_server", "start_dev_server"]) {
      expect(annotations(name)).toMatchObject({ destructiveHint: false })
    }
    // Saved files sit outside the repo: reading never asks, deleting is final.
    expect(annotations("read_saved_file")).toMatchObject({ readOnlyHint: true })
    expect(annotations("delete_saved_file")).toMatchObject({
      destructiveHint: true,
    })
    // read_document and the other Workspaces' code are read-only: a harness
    // never asks first.
    for (const name of [
      "read_code_file",
      "search_code",
      "find_code_files",
      "read_document",
      "read_skill",
    ]) {
      expect(annotations(name)).toMatchObject({ readOnlyHint: true })
    }
    expect(annotations("create_pr")).toMatchObject({
      destructiveHint: false,
      openWorldHint: true,
    })
  })

  // The prompt a harness Workspace chat gets, with every block that names a
  // tool: Skills, a Document of its own and a repository prompt.
  const harnessPrompt = (harnessKey: string) =>
    buildAgentSystemPrompt({
      layerDirectory: {
        documents: [{ id: "doc-1", title: "Plan", ownerChatId: "chat-ws-1" }],
      },
      chatId: "chat-ws-1",
      skills: [
        {
          name: "screenplay-try-variants",
          description: "Try variants.",
          origin: "app",
        },
      ],
      repoSystemPrompt: "This repo is a Next.js app.",
      toolNaming: harnessToolNaming(harnessKey, COORDINATOR_MCP_SERVER_NAME),
    })

  it("serves every tool a harness Workspace prompt tells the model to call (#1480)", async () => {
    const { result } = await (await call(5, "tools/list")).json()
    const served = new Set(result.tools.map((t: { name: string }) => t.name))
    const named = [
      ...harnessPrompt("claude-code").matchAll(
        new RegExp(`mcp__${COORDINATOR_MCP_SERVER_NAME}__([a-z_]+)`, "g")
      ),
    ].map((m) => m[1])
    expect(named).toEqual(expect.arrayContaining(["create_pr", "read_skill"]))
    for (const name of new Set(named)) expect(served).toContain(name)
  })

  it("names none of the in-process engine’s own tools to a harness (#1480)", () => {
    for (const harnessKey of ["claude-code", "codex"]) {
      const prompt = harnessPrompt(harnessKey)
      for (const tool of [
        "submit_plan",
        "run_command",
        "read_file",
        "write_file",
        "edit_file",
        "list_files",
        "grep",
        "glob",
      ]) {
        expect(prompt).not.toMatch(new RegExp(`\\b${tool}\\b`))
      }
    }
  })

  it("opens the pull request of the Sandbox its token is bound to (#1480)", async () => {
    const { result } = await (
      await call(6, "tools/call", {
        name: "create_pr",
        arguments: { title: "Fix sign-in redirect" },
      })
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toBe(
      "Created PR #7: https://github.com/acme/web/pull/7"
    )
    expect(live.createGitHubPr).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxName: "sp-ws-1",
        userId: "local-user",
        title: "Fix sign-in redirect",
      })
    )
  })

  it("loads an App Skill (#1480)", async () => {
    const { result } = await (
      await call(7, "tools/call", {
        name: "read_skill",
        arguments: { name: "screenplay-add-knob" },
      })
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain("name: screenplay-add-knob")
  })

  it("loads a canvas Skill with read_skill (#1555)", async () => {
    const saved = await canvasSkills(
      (await openRoomForRoute("room-1")) as unknown as RoomDoc
    ).save({
      name: "release-notes",
      content:
        "---\nname: release-notes\ndescription: Write release notes.\n---\nGroup by feature.",
      author: { addedBy: "agent", addedById: "chat-ws-1" },
    })
    expect(saved.ok).toBe(true)

    const { result } = await (
      await call(9, "tools/call", {
        name: "read_skill",
        arguments: { name: "release-notes" },
      })
    ).json()
    expect(result.content[0].text).toContain("Group by feature.")
  })

  it("makes Documents owned by the chat its token is bound to", async () => {
    const { result } = await (
      await call(4, "tools/call", {
        name: "create_document",
        arguments: { title: "Sign-in notes" },
      })
    ).json()
    expect(result.isError).toBe(false)
    const [doc] = collections.markdownLayers.toArray()
    expect(doc).toMatchObject({
      title: "Sign-in notes",
      ownerChatId: "chat-ws-1",
    })
  })

  it("reads the log of the Sandbox its token is bound to", async () => {
    const { result } = await (
      await call(2, "tools/call", {
        name: "read_dev_server_logs",
        arguments: {},
      })
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain("not answering")
    expect(result.content[0].text).toContain("Cannot find module 'next'")
    // Scrubbed of the Sandbox's env var values, as in-process (#1416).
    expect(result.content[0].text).not.toContain(SECRET)
    expect(result.content[0].text).toContain("STRIPE_KEY=")
    expect(devServerPorts).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxName: "sp-ws-1" })
    )
    expect(openRoomForRoute).toHaveBeenCalledWith("room-1", "chat-ws-1")
  })

  it("has no Coordinator tools", async () => {
    const res = await call(3, "tools/call", {
      name: "read_canvas",
      arguments: {},
    })
    expect((await res.json()).error.code).toBe(-32602)
  })
})

/**
 * Each Chat Target kind lists its tools once (#1487): a harness gets the
 * tools its in-process turn has, less the ones it brings its own of, and
 * every tool it lists carries its annotations.
 */
describe("every chat kind’s MCP toolset", () => {
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(collections),
    mutateDoc: async (fn) => fn(collections),
  }
  /** A Workspace harness reads, edits, runs commands and plans itself. */
  const HARNESS_NATIVE = [
    "read_file",
    "write_file",
    "edit_file",
    "run_command",
    "list_files",
    "grep",
    "glob",
    "submit_plan",
  ]
  const kinds: {
    kind: string
    binding: Parameters<typeof coordinatorToken>[0]
    tools: () => ChatTools
    native: string[]
  }[] = [
    {
      kind: "Coordinator",
      binding,
      tools: () => roomChatTarget.tools(room, { userId: "local-user" }),
      native: [],
    },
    {
      kind: "Workspace",
      binding: { roomId: "room-1", chatId: "chat-ws-1", sandboxName: "sp-1" },
      tools: () =>
        workspaceChatTarget.tools(room, {
          sandboxName: "sp-1",
          chatId: "chat-ws-1",
          userId: "local-user",
        }),
      native: HARNESS_NATIVE,
    },
    {
      kind: "Sketch",
      binding: { roomId: "room-1", chatId: "sketch-1", sketch: true },
      tools: () =>
        sketchChatTarget.tools(room, {
          chatId: "sketch-1",
          userId: "local-user",
        }),
      native: [],
    },
  ]

  for (const { kind, binding, tools, native } of kinds) {
    it(`serves a ${kind} chat’s in-process toolset minus the harness’s own tools`, async () => {
      const res = await POST(
        rpc(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { authorization: `Bearer ${coordinatorToken(binding)}` }
        )
      )
      const served: { name: string; annotations?: object }[] = (
        await res.json()
      ).result.tools
      const inProcess = Object.keys(toolsetOn(tools(), "in-process"))

      expect(inProcess).toEqual(expect.arrayContaining(native))
      expect(served.map((t) => t.name).sort()).toEqual(
        inProcess.filter((name) => !native.includes(name)).sort()
      )
      for (const tool of served) expect(tool.annotations).toBeDefined()
    })
  }
})

/**
 * Every chat saves memory (#1515): a harness chat of each kind gets
 * `write_memory` over the route, saving account memory to the app's user
 * and refusing it on a token minted for a turn nobody sent.
 */
describe("write_memory over the MCP route", () => {
  const bindings = {
    Coordinator: binding,
    Workspace: { roomId: "room-1", chatId: "chat-ws-1", sandboxName: "sp-1" },
    Sketch: { roomId: "room-1", chatId: "sketch-1", sketch: true },
  }
  const write = async (
    token: Parameters<typeof coordinatorToken>[0],
    args: Record<string, unknown>
  ): Promise<string> => {
    const res = await POST(
      rpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "write_memory", arguments: args },
        },
        { authorization: `Bearer ${coordinatorToken(token)}` }
      )
    )
    return (await res.json()).result.content[0].text
  }
  const accountTexts = async (userId: string) =>
    (await readAccountMemory(kvAccountMemoryStore(userId))).map((m) => m.text)

  beforeEach(() => accountStores.clear())

  for (const [kind, token] of Object.entries(bindings)) {
    it(`saves account and canvas memory from a ${kind} chat on a harness`, async () => {
      expect(
        await write(token, {
          scope: "account",
          action: "add",
          text: "Prefers plain UI copy.",
        })
      ).toMatch(/^Saved to account memory: /)
      await write(token, { scope: "canvas", action: "add", text: "Use pnpm." })

      expect(await accountTexts("local-user")).toEqual([
        "Prefers plain UI copy.",
      ])
      expect(readMemory(collections).map((m) => m.text)).toEqual(["Use pnpm."])
    })

    it(`refuses account memory to a ${kind} chat’s turn nobody sent`, async () => {
      const out = await write(
        { ...token, senderless: true },
        { scope: "account", action: "add", text: "Prefers plain UI copy." }
      )

      expect(out).toMatch(/nobody sent this turn/)
      expect(await accountTexts("local-user")).toEqual([])
    })
  }
})

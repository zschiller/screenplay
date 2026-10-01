import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { baseBranch, baseRepo, makeHarness } from "@/test/canvas/harness"
import type { RoomCollections } from "@/lib/yjs/schema"

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
      readLog: async () => "Error: Cannot find module 'next'\n",
      restart: async () => ({ ok: true }),
      waitUntilAnswering: async () => true,
    }
  },
}))

import { DELETE, GET, POST } from "./route"
import { coordinatorToken } from "@/lib/agent/coordinator-mcp"

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

describe("the Coordinator's MCP route", () => {
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

  it("lists the Coordinator's tools with read-only annotations", async () => {
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

  it("runs read_canvas against the token's Room", async () => {
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

  it("opens a Workspace's pull request right away", async () => {
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
  it("returns a refusal as the call's result", async () => {
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
      "\"Fix sign-in redirect\" isn't in a GitHub repository, so it can't have a pull request."
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

  it("accepts the sidecar's own origin", async () => {
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

describe("a Workspace chat's MCP route", () => {
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

  it("lists its dev server's tools, its frame reads, its Document and Mockup tools, other Workspaces' code reads (#1315) and Question Cards", async () => {
    const { result } = await (await call(1, "tools/list")).json()
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      "read_dev_server_logs",
      "restart_dev_server",
      "view_frame",
      "read_frame_html",
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
    ])
    expect(result.tools[0].annotations).toMatchObject({ readOnlyHint: true })
    expect(result.tools[3].annotations).toMatchObject({ readOnlyHint: true })
    // read_document and the other Workspaces' code are read-only: a harness
    // never asks first.
    for (const i of [10, 11, 12, 13]) {
      expect(result.tools[i].annotations).toMatchObject({ readOnlyHint: true })
    }
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

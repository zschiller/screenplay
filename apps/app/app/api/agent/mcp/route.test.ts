import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { baseBranch, makeHarness } from "@/test/canvas/harness"
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
}))
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: (roomId: string, chatId?: string) =>
    openRoomForRoute(roomId, chatId),
}))
vi.mock("@/lib/terminal-tabs", () => ({ listTerminalTabs: async () => [] }))
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

// A document token's code reads, standing in for the Workspace's Sandbox.
const openSandbox = vi.hoisted(() => vi.fn())
vi.mock("@/lib/sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sandbox")>()),
  sandboxProvider: {
    get: async (opts: { name: string }) => {
      openSandbox(opts)
      return {
        readFileToBuffer: async ({ path }: { path: string }) =>
          path === "src/sign-in.tsx"
            ? Buffer.from("export function SignIn() {}\n")
            : null,
      }
    },
  },
}))

import { DELETE, GET, POST } from "./route"
import { coordinatorToken } from "@/lib/agent/coordinator-mcp"
import {
  registerHarnessGate,
  type HarnessGateCall,
} from "@/lib/agent/acp/harness-gate"

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

  const createCall = {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "create_workspaces",
      arguments: {
        workspaces: [
          {
            title: "Fix",
            repository: "acme/web",
            brief: "Fix it.",
            prompt: "Fix it.",
          },
        ],
      },
    },
  }

  it("hands a plan-gated call's card to the Coordinator's running turn", async () => {
    const raised: HarnessGateCall[] = []
    const unregister = registerHarnessGate(binding.chatId, async (call) => {
      raised.push(call)
      return true
    })
    try {
      const { result } = await (await POST(rpc(createCall))).json()
      expect(result.isError).toBe(false)
      expect(result.content[0].text).toMatch(/End your turn now/)
    } finally {
      unregister()
    }
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({
      toolName: "create_workspaces",
      input: {
        gate: "create_workspaces",
        workspaces: [{ title: "Fix", repository: "acme/web" }],
      },
    })
    expect(raised[0]!.plan).toContain("Fix")
  })

  it("fails a plan-gated call when no turn can show its card", async () => {
    const { result } = await (await POST(rpc(createCall))).json()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/approval/)
  })

  const toolCall = (id: number, name: string, workspace_id: string) =>
    rpc({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: { workspace_id } },
    })

  // A refusal is the call's result, not an error, so the harness shows it as
  // a finished step (#1231).
  it("returns a call its gate refuses as a result, without raising a card", async () => {
    const raised: HarnessGateCall[] = []
    const unregister = registerHarnessGate(binding.chatId, async (call) => {
      raised.push(call)
      return true
    })
    try {
      const removal = await (
        await POST(toolCall(7, "remove_workspace", "no-such"))
      ).json()
      expect(removal.result.isError).toBe(false)
      expect(removal.result.content[0].text).toMatch(
        /No Workspace has the id no-such/
      )

      // ws-1's repository isn't on GitHub.
      const pr = await (
        await POST(toolCall(8, "open_pull_request", "ws-1"))
      ).json()
      expect(pr.result.isError).toBe(false)
      expect(pr.result.content[0].text).toBe(
        "\"Fix sign-in redirect\" isn't in a GitHub repository, so it can't have a pull request."
      )
    } finally {
      unregister()
    }
    expect(raised).toEqual([])
  })

  it("still fails a call whose tool throws", async () => {
    const { result } = await (
      await POST(toolCall(9, "stop_workspace", "no-such"))
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

  it("lists only its dev server's tools", async () => {
    const { result } = await (await call(1, "tools/list")).json()
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual([
      "read_dev_server_logs",
      "restart_dev_server",
    ])
    expect(result.tools[0].annotations).toMatchObject({ readOnlyHint: true })
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

describe("a document chat's MCP route", () => {
  const document = {
    roomId: "room-1",
    chatId: "chat-doc-1",
    markdownLayerId: "doc-1",
  }
  const call = (id: number, method: string, params?: unknown) =>
    POST(
      rpc(
        { jsonrpc: "2.0", id, method, params },
        { authorization: `Bearer ${coordinatorToken(document)}` }
      )
    )

  it("lists its document tools and code reads", async () => {
    const { result } = await (await call(1, "tools/list")).json()
    const names = result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "replace_document_body",
        "append_to_document_body",
        "set_document_title",
        "read_document",
        "read_code_file",
        "search_code",
        "find_code_files",
      ])
    )
    expect(names).not.toContain("read_canvas")
    const read = result.tools.find(
      (t: { name: string }) => t.name === "read_code_file"
    )
    expect(read.annotations).toMatchObject({ readOnlyHint: true })
  })

  it("reads a Workspace's code, waking its Sandbox", async () => {
    const { result } = await (
      await call(2, "tools/call", {
        name: "read_code_file",
        arguments: { path: "src/sign-in.tsx" },
      })
    ).json()
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain("export function SignIn()")
    expect(openSandbox).toHaveBeenCalledWith({
      name: "sandbox-ws-1",
      resume: true,
    })
  })
})

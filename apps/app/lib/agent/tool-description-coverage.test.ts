import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: { get: vi.fn(), create: vi.fn() },
}))
vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: vi.fn(async () => null),
}))
vi.mock("@/lib/github-pr", () => ({ createGitHubPr: vi.fn() }))

import { SCREENPLAY_TOOLS } from "@/lib/agent/tool-description"
import { toolsetFor } from "@/lib/agent/toolset"
import { buildPrAndSkillTools } from "@/lib/agent/tools"

const room = {
  roomId: "room-1",
  readDoc: vi.fn(),
  mutateDoc: vi.fn(),
} as never
const sandbox = { sandboxName: "sandbox-a", room, userId: "user-1" }

/** Every tool any chat target serves, in-process or over MCP. */
function servedToolNames(): string[] {
  const names = new Set<string>()
  for (const tools of [
    toolsetFor({ kind: "sandbox", room, sandbox, chatId: "chat-1" }),
    toolsetFor({ kind: "sketch", room, chatId: "chat-1", userId: "user-1" }),
    toolsetFor({ kind: "room", room, ports: {} as never }),
    buildPrAndSkillTools(sandbox),
  ]) {
    for (const name of Object.keys(tools)) names.add(name)
  }
  return [...names].sort()
}

describe("SCREENPLAY_TOOLS", () => {
  it("describes every tool a chat can call", () => {
    const missing = servedToolNames().filter(
      (name) => !Object.hasOwn(SCREENPLAY_TOOLS, name)
    )
    expect(missing).toEqual([])
  })

  it("describes no tool that no chat serves", () => {
    const served = new Set(servedToolNames())
    const stale = Object.keys(SCREENPLAY_TOOLS).filter((n) => !served.has(n))
    expect(stale).toEqual([])
  })
})

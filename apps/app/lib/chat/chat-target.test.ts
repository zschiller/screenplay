import { describe, expect, it } from "vitest"

import {
  pendingProbes,
  resolveChatPanelTarget,
  resolvePendingReady,
  restoreAgentChatSelection,
} from "@/lib/chat/chat-target"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
} from "@/lib/types"

function agent(id: string, extra: Partial<BranchData> = {}): BranchData {
  return {
    id,
    repoId: "repo-1",
    sandboxName: `sb-${id}`,
    gitUrl: "",
    ref: "main",
    previewDomain: "",
    port: 3000,
    status: "running",
    createdAt: 1,
    ...extra,
  } as BranchData
}

function chat(
  id: string,
  createdAt: number,
  target: { branchId?: string; markdownLayerId?: string },
  extra: Partial<ChatSessionData> = {}
): ChatSessionData {
  return { id, label: "Untitled", createdAt, ...target, ...extra }
}

function doc(id: string): MarkdownLayerData {
  return { id, width: 200, height: 120, title: "Doc" }
}

describe("resolveChatPanelTarget", () => {
  it("packs a selected agent with a sandbox into an agent target", () => {
    const target = resolveChatPanelTarget(agent("a1"), null)
    expect(target).toEqual({ kind: "agent", agent: agent("a1") })
  })

  it("prefers the agent over a document when both are present", () => {
    const target = resolveChatPanelTarget(agent("a1"), doc("d1"))
    expect(target?.kind).toBe("agent")
  })

  it("falls through to the document when no agent has a sandbox", () => {
    const target = resolveChatPanelTarget(undefined, doc("d1"))
    expect(target).toEqual({
      kind: "layer",
      layerKind: "markdown-layer",
      layer: doc("d1"),
    })
  })

  it("ignores a selected agent that is still provisioning (no sandbox)", () => {
    const provisioning = agent("a1", { sandboxName: "" })
    expect(resolveChatPanelTarget(provisioning, doc("d1"))?.kind).toBe("layer")
    expect(resolveChatPanelTarget(provisioning, null)).toBeNull()
  })

  it("resolves to nothing when neither target is set", () => {
    expect(resolveChatPanelTarget(undefined, null)).toBeNull()
  })
})

describe("restoreAgentChatSelection", () => {
  it("keeps the remembered chat when it is still open", () => {
    const chats = [
      chat("c1", 1, { branchId: "a1" }),
      chat("c2", 2, { branchId: "a1" }),
    ]
    expect(restoreAgentChatSelection(chats, "a1", "c2")).toBe("c2")
  })

  it("falls back to the first open chat when the remembered one is closed", () => {
    const chats = [
      chat("c2", 2, { branchId: "a1" }),
      chat("c1", 1, { branchId: "a1" }),
      chat("c3", 3, { branchId: "a1" }, { closedAt: 99 }),
    ]
    // c3 (remembered) is closed → earliest open chat (c1 by createdAt).
    expect(restoreAgentChatSelection(chats, "a1", "c3")).toBe("c1")
  })

  it("falls back to the first open chat when nothing is remembered", () => {
    const chats = [
      chat("c2", 2, { branchId: "a1" }),
      chat("c1", 1, { branchId: "a1" }),
    ]
    expect(restoreAgentChatSelection(chats, "a1", undefined)).toBe("c1")
  })

  it("never restores another agent's chat or a closed chat", () => {
    const chats = [
      chat("other", 1, { branchId: "a2" }),
      chat("closed", 2, { branchId: "a1" }, { closedAt: 5 }),
    ]
    expect(restoreAgentChatSelection(chats, "a1", "other")).toBeNull()
  })

  it("returns null when the agent has no open chats", () => {
    expect(restoreAgentChatSelection([], "a1", "c1")).toBeNull()
  })
})

describe("pendingProbes", () => {
  it("probes only pending agents whose sandbox exists", () => {
    const agents = [
      agent("a1"),
      agent("a2", { sandboxName: "" }),
      agent("a3"),
    ]
    const probes = pendingProbes(["a1", "a2", "a3"], agents)
    expect(probes).toEqual([
      { agentId: "a1", sandboxName: "sb-a1" },
      { agentId: "a3", sandboxName: "sb-a3" },
    ])
  })

  it("drops pending ids whose agent is gone", () => {
    expect(pendingProbes(["missing"], [agent("a1")])).toEqual([])
  })
})

describe("resolvePendingReady", () => {
  it("selects the ready agent and drops it from the pending set", () => {
    const next = resolvePendingReady(["a1", "a2", "a3"], "a2")
    expect(next).toEqual({
      selectedAgentId: "a2",
      pendingAgentIds: ["a1", "a3"],
    })
  })

  it("leaves an unrelated pending set intact apart from the ready id", () => {
    expect(resolvePendingReady(["a1"], "a1").pendingAgentIds).toEqual([])
  })
})

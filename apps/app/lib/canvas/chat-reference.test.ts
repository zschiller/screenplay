import { describe, expect, it } from "vitest"

import {
  formatDocumentReference,
  formatFrameReference,
  resolveReference,
  type ReferenceContext,
} from "@/lib/canvas/chat-reference"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  MarkdownLayerData,
} from "@/lib/types"

function agent(id: string, extra: Partial<BranchData> = {}): BranchData {
  return {
    id,
    repoId: "repo-1",
    sandboxName: `sb-${id}`,
    gitUrl: "",
    ref: `ref-${id}`,
    previewDomain: "",
    port: 3000,
    status: "running",
    createdAt: 1,
    ...extra,
  } as BranchData
}

function frame(
  id: string,
  extra: Partial<IframeLayerData> = {}
): IframeLayerData {
  return {
    id,
    width: 400,
    height: 300,
    label: id,
    iframeState: {},
    ...extra,
  }
}

function doc(id: string, title = "Doc"): MarkdownLayerData {
  return { id, width: 200, height: 120, title }
}

function chat(
  id: string,
  target: { branchId?: string; markdownLayerId?: string }
): ChatSessionData {
  return { id, label: "Untitled", createdAt: 1, ...target }
}

const base = {
  roomId: "room-1",
  chatId: "chat-new",
  createdAt: 42,
}

describe("formatDocumentReference", () => {
  it("prepends the quoted span + line range when a selection is present", () => {
    const ctx: ReferenceContext = {
      documentId: "d1",
      quotedText: "the line",
      lineFrom: 3,
      lineTo: 3,
    }
    expect(formatDocumentReference("please fix", ctx, "Spec")).toBe(
      "**Spec · Line 3**\n> the line\n\nplease fix"
    )
  })

  it("sends the note as-is when there is no selection", () => {
    expect(formatDocumentReference("hello", { documentId: "d1" }, "Spec")).toBe(
      "hello"
    )
  })
})

describe("formatFrameReference", () => {
  it("appends the route and the element selector", () => {
    expect(formatFrameReference("tweak this", "/about", "button.cta")).toBe(
      "tweak this\n\nRoute: `/about`\nElement: `button.cta`"
    )
  })

  it("omits the element line when no selector was resolved", () => {
    expect(formatFrameReference("tweak this", "/about", null)).toBe(
      "tweak this\n\nRoute: `/about`"
    )
  })
})

describe("resolveReference — document routing", () => {
  it("routes a document selection to that document in a fresh chat", () => {
    const decision = resolveReference({
      ...base,
      note: "look here",
      ctx: {
        documentId: "d1",
        quotedText: "alpha",
        lineFrom: 1,
        lineTo: 2,
      },
      agents: [],
      iframeLayers: [],
      markdownLayers: [doc("d1", "README")],
      chatSessions: [],
    })

    expect(decision).toEqual({
      kind: "send",
      session: {
        id: "chat-new",
        markdownLayerId: "d1",
        label: "Untitled",
        createdAt: 42,
      },
      isFirstChat: true,
      select: { kind: "document", documentId: "d1", chatId: "chat-new" },
      send: {
        roomId: "room-1",
        chatId: "chat-new",
        markdownLayerId: "d1",
        message: "**README · Lines 1–2**\n> alpha\n\nlook here",
        isFirstChat: true,
      },
    })
  })

  it("resolves a doc layer named via iframeLayerId (the shared hit-test set)", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "d1" },
      agents: [],
      iframeLayers: [],
      markdownLayers: [doc("d1")],
      chatSessions: [],
    })
    expect(decision.kind).toBe("send")
    if (decision.kind === "send") {
      expect(decision.select).toEqual({
        kind: "document",
        documentId: "d1",
        chatId: "chat-new",
      })
      expect(decision.send.message).toBe("n")
    }
  })

  it("is not the first chat when the doc already has another chat", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { documentId: "d1" },
      agents: [],
      iframeLayers: [],
      markdownLayers: [doc("d1")],
      chatSessions: [chat("existing", { markdownLayerId: "d1" })],
    })
    expect(decision.kind === "send" && decision.isFirstChat).toBe(false)
  })
})

describe("resolveReference — frame-element routing", () => {
  it("routes a frame element to the frame's owning branch in a fresh chat", () => {
    const decision = resolveReference({
      ...base,
      note: "make it blue",
      ctx: { iframeLayerId: "f1", selector: "div#hero" },
      agents: [agent("a1")],
      iframeLayers: [frame("f1", { branchId: "a1", route: "/home" })],
      markdownLayers: [],
      chatSessions: [],
    })

    expect(decision).toEqual({
      kind: "send",
      session: {
        id: "chat-new",
        branchId: "a1",
        label: "Untitled",
        createdAt: 42,
      },
      isFirstChat: true,
      select: { kind: "agent", agentId: "a1", chatId: "chat-new" },
      send: {
        roomId: "room-1",
        chatId: "chat-new",
        sandboxName: "sb-a1",
        branch: "ref-a1",
        message: "make it blue\n\nRoute: `/home`\nElement: `div#hero`",
        isFirstChat: true,
        autoNamedBranch: undefined,
      },
    })
  })

  it("defaults the route to / when the frame has none", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "f1" },
      agents: [agent("a1")],
      iframeLayers: [frame("f1", { branchId: "a1" })],
      markdownLayers: [],
      chatSessions: [],
    })
    expect(decision.kind === "send" && decision.send.message).toBe(
      "n\n\nRoute: `/`"
    )
  })

  it("routes to the frame's branch — not the focused chat's branch", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "f1" },
      agents: [agent("a1"), agent("a2")],
      iframeLayers: [frame("f1", { branchId: "a2", route: "/" })],
      markdownLayers: [],
      // A chat on a different agent is "focused" — routing must ignore it.
      chatSessions: [chat("focused", { branchId: "a1" })],
    })
    expect(decision.kind === "send" && decision.select).toEqual({
      kind: "agent",
      agentId: "a2",
      chatId: "chat-new",
    })
  })

  it("does not send when the frame has no owning branch", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "f1" },
      agents: [],
      iframeLayers: [frame("f1")],
      markdownLayers: [],
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })

  it("does not send when the owning agent has no sandbox yet", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "f1" },
      agents: [agent("a1", { sandboxName: "" })],
      iframeLayers: [frame("f1", { branchId: "a1" })],
      markdownLayers: [],
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })

  it("does not send when there is no target at all", () => {
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: {},
      agents: [],
      iframeLayers: [],
      markdownLayers: [],
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })
})

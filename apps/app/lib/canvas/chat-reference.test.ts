import { describe, expect, it } from "vitest"

import {
  formatDocumentReference,
  resolveReference,
  type ReferenceContext,
} from "@/lib/canvas/chat-reference"
import type { ChatSessionData, MarkdownLayerData } from "@/lib/types"

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
      markdownLayers: [doc("d1")],
      chatSessions: [chat("existing", { markdownLayerId: "d1" })],
    })
    expect(decision.kind === "send" && decision.isFirstChat).toBe(false)
  })

  it("does not send when the context names no document", () => {
    // A frame element (iframeLayerId with no matching doc layer) no longer
    // routes anywhere — element→agent targeting moved to the composer token
    // flow (#618).
    const decision = resolveReference({
      ...base,
      note: "n",
      ctx: { iframeLayerId: "f1", selector: "div#hero" },
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
      markdownLayers: [],
      chatSessions: [],
    })
    expect(decision).toEqual({ kind: "none" })
  })
})

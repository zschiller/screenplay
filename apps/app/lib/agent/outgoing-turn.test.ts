import { describe, expect, it } from "vitest"

import {
  buildAttachmentsFooter,
  buildCanvasViewFooter,
  buildReferencedDocsFooter,
  buildTargetedElementsFooter,
  parseUserMessage,
  serializeElement,
  serializeMention,
  serializeSkill,
  type CanvasView,
  type MessageAttachment,
  type ReferencedDoc,
  type TargetedElement,
} from "@/lib/agent/message-markers"
import {
  buildOutgoingTurn,
  type OutgoingTurnParts,
} from "@/lib/agent/outgoing-turn"
import { projectUserTurn } from "@/lib/agent/user-turn"
import type { ChatQuote } from "@/lib/chat-quote-store"

const quote: ChatQuote = {
  documentId: "doc-1",
  documentTitle: "Launch plan",
  quotedText: "Ship on Friday\nAfter the review",
  lineFrom: 3,
  lineTo: 4,
}

const frameElement: TargetedElement = {
  ref: "el1",
  route: "/login",
  selector: "main > form > button#submit",
  frameLabel: "Sign in",
  iframeLayerId: "layer-1",
}

const mockupElement: TargetedElement = {
  ref: "el2",
  route: "mockup m1",
  selector: "header > h1",
  frameLabel: "Pricing",
  layerKind: "mockup",
}

const canvasView: CanvasView = {
  sender: "Maya",
  selected: [{ kind: "frame", id: "f1", name: "Checkout" }],
  onScreen: [{ kind: "document", id: "d1", name: "Spec" }],
}

const photo: MessageAttachment = {
  path: "uploads/photo.png",
  mediaType: "image/png",
  size: 2048,
}

/** Every combination of the parts a send can carry. */
function* combinations(): Generator<OutgoingTurnParts> {
  const messages: Array<{ message: string; referencedDocs: ReferencedDoc[] }> =
    [
      { message: "Fix the redirect", referencedDocs: [] },
      { message: "line one\n\nline two", referencedDocs: [] },
      {
        message: `${serializeSkill("review")} read ${serializeMention("Spec", "doc-1")}`,
        referencedDocs: [{ id: "doc-1", title: "Spec" }],
      },
      {
        message: `${serializeMention("Spec", "doc-1")} and ${serializeMention("doc-2", "doc-2")}`,
        referencedDocs: [{ id: "doc-1", title: "Spec" }, { id: "doc-2" }],
      },
    ]
  const elementSets: TargetedElement[][] = [
    [],
    [frameElement],
    [frameElement, mockupElement],
  ]
  for (const { message, referencedDocs } of messages) {
    for (const targetedElements of elementSets) {
      const withTokens =
        message +
        targetedElements
          .map((e) => ` ${serializeElement("button", e.ref)}`)
          .join("")
      for (const q of [undefined, quote]) {
        for (const view of [undefined, null, canvasView]) {
          for (const attachments of [[], [photo]]) {
            yield {
              message: withTokens,
              referencedDocs,
              targetedElements,
              attachments,
              quote: q,
              canvasView: view,
            }
          }
        }
      }
    }
  }
}

describe("buildOutgoingTurn", () => {
  const all = [...combinations()]

  it("covers every combination", () => {
    expect(all).toHaveLength(4 * 3 * 2 * 3 * 2)
  })

  it.each(all.map((parts, i) => ({ i, parts })))(
    "returns the turn its wire projects to (#$i)",
    ({ parts }) => {
      const { wire, turn } = buildOutgoingTurn(parts)
      expect(projectUserTurn(wire)).toEqual(turn)
    }
  )

  it("posts the message, then each footer the parts call for", () => {
    const view = canvasView
    const { wire } = buildOutgoingTurn({
      message: "hi",
      referencedDocs: [{ id: "doc-1", title: "Spec" }],
      targetedElements: [frameElement],
      attachments: [photo],
      canvasView: view,
    })
    expect(wire).toBe(
      "hi" +
        buildAttachmentsFooter([photo]) +
        buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }]) +
        buildTargetedElementsFooter([frameElement]) +
        buildCanvasViewFooter(view)
    )
  })

  it("leads with the quoted Document, line range and lines", () => {
    const { wire, turn } = buildOutgoingTurn({ message: "Why Friday?", quote })
    const body =
      "**Launch plan · Lines 3–4**\n> Ship on Friday  \n> After the review\n\nWhy Friday?"
    expect(wire).toBe(body)
    expect(turn).toEqual({ body })
  })

  it("sends plain text as it is", () => {
    expect(buildOutgoingTurn({ message: "ship it" })).toEqual({
      wire: "ship it",
      turn: { body: "ship it" },
    })
  })

  it("keeps the Canvas view out of what the chat shows", () => {
    const { wire, turn } = buildOutgoingTurn({ message: "this", canvasView })
    expect(parseUserMessage(wire).body).toBe("this")
    expect(turn).toEqual({ body: "this" })
  })
})

describe("a message a Mockup page drafted (#1645)", () => {
  const draftedOn = { id: "mockup-1", title: "Option B · Suggestions" }

  it("names the Mockup to the agent, out of what the chat shows", () => {
    const { wire, turn } = buildOutgoingTurn({
      message: "Picked B",
      draftedOn,
      canvasView,
    })
    expect(wire).toContain(
      'Drafted on mockup: the sender wrote this message from the page of mockup [mockup-1] "Option B · Suggestions"'
    )
    expect(parseUserMessage(wire).body).toBe("Picked B")
    expect(turn).toEqual({ body: "Picked B" })
  })

  it("strips beside the footers that run to the end", () => {
    const element: TargetedElement = {
      ref: "el1",
      route: "/",
      selector: "button",
      frameLabel: "Home",
    }
    const { wire } = buildOutgoingTurn({
      message: `Make ${serializeElement("button", "el1")} blue`,
      targetedElements: [element],
      draftedOn,
    })
    expect(parseUserMessage(wire).body).toBe(
      `Make ${serializeElement("button", "el1")} blue`
    )
  })
})

describe("an outgoing turn's attachments (#1525)", () => {
  it("show on the turn and project back from the wire", () => {
    const { wire, turn } = buildOutgoingTurn({
      message: "what's this?",
      attachments: [photo],
    })
    expect(turn).toEqual({ body: "what's this?", attachments: [photo] })
    expect(projectUserTurn(wire)).toEqual(turn)
  })

  it("make a message on their own", () => {
    const { wire, turn } = buildOutgoingTurn({
      message: "",
      attachments: [photo],
    })
    expect(wire).not.toBe("")
    expect(turn).toEqual({ body: "", attachments: [photo] })
    expect(projectUserTurn(wire)).toEqual(turn)
  })
})

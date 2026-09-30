import { describe, expect, it } from "vitest"

import {
  buildReferencedDocsFooter,
  buildTargetedElementsFooter,
  prependTurnMarkers,
  serializeElement,
  serializeMention,
  serializeSkill,
  type TargetedElement,
} from "@/lib/agent/message-markers"
import { projectUserTurn, userTurnMessage } from "@/lib/agent/user-turn"

const element: TargetedElement = {
  ref: "el1",
  route: "/login",
  selector: "main > form > button#submit",
  frameLabel: "Sign in",
  iframeLayerId: "layer-1",
}

describe("projectUserTurn", () => {
  it.each([
    {
      kind: "plain",
      wire: "Fix the redirect",
      turn: { body: "Fix the redirect" },
    },
    {
      kind: "plan mode and branch",
      wire: prependTurnMarkers("Fix the redirect", {
        planMode: true,
        branch: "fix-sign-in",
      }),
      turn: { body: "Fix the redirect" },
    },
    {
      kind: "wake",
      wire: prependTurnMarkers("Workspace finished its turn.", {
        wakeFrom: "ws-1",
      }),
      turn: { body: "Workspace finished its turn.", wakeFrom: "ws-1" },
    },
    {
      kind: "delegated",
      wire: prependTurnMarkers("Keep the next param.", {
        delegatedFrom: "room-chat-r1",
        branch: "fix-sign-in",
      }),
      turn: { body: "Keep the next param.", delegatedFrom: "room-chat-r1" },
    },
    {
      kind: "mentions",
      wire:
        `Read ${serializeMention("Spec", "doc-1")} first` +
        buildReferencedDocsFooter([{ id: "doc-1", title: "Spec" }]),
      turn: { body: "Read [@Spec](mention:doc-1) first" },
    },
    {
      kind: "skills",
      wire: `${serializeSkill("review")} this branch`,
      turn: { body: "[skill: review] this branch" },
    },
    {
      kind: "targeted elements",
      wire:
        `Make ${serializeElement("button#submit", "el1")} blue` +
        buildTargetedElementsFooter([element]),
      turn: {
        body: "Make [element: button#submit](element:el1) blue",
        targetedElements: [element],
      },
    },
  ])("projects a $kind turn", ({ wire, turn }) => {
    expect(projectUserTurn(wire)).toEqual(turn)
  })
})

describe("userTurnMessage", () => {
  it("draws the body and carries the typed fields", () => {
    const wire =
      prependTurnMarkers(`Make ${serializeElement("button", "el1")} blue`, {
        delegatedFrom: "room-chat-r1",
      }) + buildTargetedElementsFooter([element])

    expect(userTurnMessage(wire)).toEqual({
      role: "user",
      content: "Make [element: button](element:el1) blue",
      delegatedFrom: "room-chat-r1",
      targetedElements: [element],
    })
  })
})

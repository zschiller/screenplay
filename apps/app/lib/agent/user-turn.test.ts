import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
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
import { userMessageChunk } from "@/lib/agent/acp/schema"
import {
  echoedUserTurn,
  projectUserTurn,
  userTurnEcho,
  userTurnMessage,
  withPromptLast,
} from "@/lib/agent/user-turn"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"

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

describe("userTurnEcho", () => {
  it("carries the projection, which the browser reads back without parsing", () => {
    const wire =
      prependTurnMarkers(`Make ${serializeElement("button", "el1")} blue`, {
        wakeFrom: "ws-1",
        planMode: true,
      }) + buildTargetedElementsFooter([element])

    const echo = userTurnEcho(wire)
    expect(echo).toMatchObject({
      sessionUpdate: "user_message_chunk",
      content: {
        type: "text",
        text: "Make [element: button](element:el1) blue",
      },
    })
    expect(echoedUserTurn(echo)).toEqual(userTurnMessage(wire))
  })

  it("carries who sent it, which the wire text doesn't", () => {
    const echo = userTurnEcho("ship it", "user_maya")
    expect(echoedUserTurn(echo)).toEqual({
      role: "user",
      content: "ship it",
      sentBy: "user_maya",
    })
    expect(echoedUserTurn(echo)).toEqual(
      userTurnMessage("ship it", "user_maya")
    )
  })

  it("echoes a plain turn as a plain chunk", () => {
    expect(userTurnEcho("ship it")).toEqual(userMessageChunk("ship it"))
    expect(echoedUserTurn(userMessageChunk("ship it"))).toEqual({
      role: "user",
      content: "ship it",
    })
  })
})

describe("the browser parses no marker strings (#1253)", () => {
  const parsers = [
    "parseUserMessage",
    "parseTargetedElementsFooter",
    "projectUserTurn",
    "userTurnMessage",
  ]
  const appRoot = join(__dirname, "../..")
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })

  it("in components, hooks or the chat store", () => {
    const call = new RegExp(`\\b(${parsers.join("|")})\\(`)
    const offenders = [
      ...sources(join(appRoot, "components")),
      ...sources(join(appRoot, "hooks")),
      join(appRoot, "lib/chat-store.ts"),
    ].filter((path) => call.test(readFileSync(path, "utf8")))
    expect(offenders).toEqual([])
  })
})

describe("withPromptLast (#1702)", () => {
  const user = (text: string): AcpMessageRecord => ({
    role: "user",
    content: [{ type: "text", text }],
  })
  const agent: AcpMessageRecord = {
    role: "agent",
    content: [{ type: "text", text: "Done." }],
  }
  const event = user(
    prependTurnMarkers("PR #7 was merged.", {
      prEvent: { number: 7, kind: "merged" },
    })
  )

  it("moves a PR event saved after the turn's message ahead of it", () => {
    const ask = user("Fix the header")
    expect(withPromptLast([agent, ask, event])).toEqual([agent, event, ask])
  })

  it("keeps a history that already ends in a message", () => {
    const history = [agent, event, user("Thanks")]
    expect(withPromptLast(history)).toBe(history)
  })

  it("keeps a PR event as the prompt when nothing else follows the reply", () => {
    const history = [user("Hi"), agent, event]
    expect(withPromptLast(history)).toBe(history)
  })
})

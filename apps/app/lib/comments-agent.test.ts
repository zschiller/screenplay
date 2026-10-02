import { describe, expect, it } from "vitest"

import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import {
  describeElement,
  formatAgentRequest,
  lastAgentMessage,
  planAgentRequests,
  splitAgentReply,
  type AgentRequestThread,
  type SendableThread,
} from "./comments-agent"

function request(
  number: number,
  rest: Partial<AgentRequestThread> = {}
): AgentRequestThread {
  return {
    number,
    route: "/checkout",
    selector: "main > aside#summary",
    anchor: null,
    snapshot: null,
    comments: [{ authorName: "Zack", body: "Stick to the bottom" }],
    ...rest,
  }
}

describe("describeElement", () => {
  it("prefers the test id, then the id, then the selector's last step", () => {
    expect(
      describeElement(
        request(1, { anchor: { path: "p", tag: "button", testId: "pay" } })
      )
    ).toBe('button[data-testid="pay"]')
    expect(
      describeElement(
        request(1, { anchor: { path: "p", tag: "aside", id: "summary" } })
      )
    ).toBe("aside#summary")
    expect(describeElement(request(1))).toBe("aside#summary")
    expect(describeElement(request(1, { selector: null }))).toBeNull()
  })
})

describe("formatAgentRequest", () => {
  it("lists each comment's number, route, element and conversation", () => {
    const text = formatAgentRequest([
      request(3, { snapshot: "Order summary" }),
      request(5, {
        route: "/cart",
        selector: null,
        comments: [
          { authorName: "Zack", body: "Collapse the promo field" },
          { authorName: "Ana", body: "+1" },
        ],
      }),
    ])
    expect(text).toContain("Please address these 2 comments on the app.")
    expect(text).toContain(
      '#3 on /checkout, aside#summary ("Order summary"):\nZack: Stick to the bottom'
    )
    expect(text).toContain(
      "#5 on /cart:\nZack: Collapse the promo field\nAna: +1"
    )
    expect(text).toContain('like "#3: ')
  })

  it("asks for one comment in the singular", () => {
    expect(formatAgentRequest([request(2)])).toMatch(
      /^Please address this comment on the app\./
    )
  })

  it("names the Document and the text a Document comment is on (#1314)", () => {
    const text = formatAgentRequest([
      request(4, {
        route: null,
        selector: null,
        document: { id: "doc-1", title: "Launch plan" },
        quotedText: "Ship on Friday",
        comments: [{ authorName: "Zack", body: "Make it Monday" }],
      }),
    ])
    expect(text).toMatch(/^Please address this comment on a Document\./)
    expect(text).toContain(
      '#4 on the Document "Launch plan" (id doc-1), on "Ship on Friday":\nZack: Make it Monday'
    )
    expect(text).not.toContain("Commit your changes")
  })
})

describe("splitAgentReply", () => {
  it("gives each thread its own numbered line", () => {
    const reply = [
      "Done. Both changes are in.",
      "",
      "- #3: Made the summary sticky below 768px.",
      "**#5** — Collapsed the promo field by default.",
    ].join("\n")
    expect(splitAgentReply(reply, [3, 5])).toEqual(
      new Map([
        [3, "Made the summary sticky below 768px."],
        [5, "Collapsed the promo field by default."],
      ])
    )
  })

  it("falls back to the whole reply for a thread without a line", () => {
    const reply = "#3: Sticky now.\nI couldn't find the promo field."
    expect(splitAgentReply(reply, [3, 5]).get(5)).toBe(reply)
  })
})

describe("lastAgentMessage", () => {
  const text = (t: string) => [{ type: "text" as const, text: t }]
  it("takes the agent's last message of the latest turn", () => {
    const history: AcpMessageRecord[] = [
      { role: "user", content: text("old") },
      { role: "agent", content: text("old reply") },
      { role: "user", content: text("address these") },
      { role: "agent", content: text("Looking…") },
      { role: "thought", content: text("hmm") },
      { role: "agent", content: text("#3: Done.") },
    ]
    expect(lastAgentMessage(history)).toBe("#3: Done.")
  })

  it("is empty when the turn has no message", () => {
    expect(
      lastAgentMessage([
        { role: "agent", content: text("earlier") },
        { role: "user", content: text("go") },
      ])
    ).toBe("")
  })
})

describe("planAgentRequests", () => {
  const thread = (
    id: string,
    rest: Partial<SendableThread> = {}
  ): SendableThread => ({
    id,
    resolved: false,
    documentId: null,
    iframeLayerId: null,
    workspaceId: "w1",
    agentStatus: null,
    ...rest,
  })
  const frames: Record<string, string> = { f2: "w2" }

  it("makes one request per Workspace, skipping what can't be sent", () => {
    const plan = planAgentRequests(
      [
        thread("a"),
        thread("b", { workspaceId: null, iframeLayerId: "f2" }),
        thread("c"),
        thread("resolved", { resolved: true }),
        thread("working", { agentStatus: "working" }),
        thread("doc", { workspaceId: null, documentId: "d1" }),
        thread("stopped", { workspaceId: "w3" }),
        thread("again", { agentStatus: "addressed" }),
      ],
      (id) => frames[id],
      (w) => w !== "w3"
    )
    expect([...plan].map(([w, list]) => [w, list.map((t) => t.id)])).toEqual([
      ["w1", ["a", "c", "again"]],
      ["w2", ["b"]],
    ])
  })

  it("sends a Document thread where its Document's chat is (#1314)", () => {
    const docs: Record<string, string> = { owned: "w2" }
    const plan = planAgentRequests(
      [
        thread("mine", { workspaceId: null, documentId: "owned" }),
        thread("hand-made", { workspaceId: null, documentId: "loose" }),
      ],
      (id) => frames[id],
      () => true,
      (id) => docs[id]
    )
    expect([...plan].map(([w, list]) => [w, list.map((t) => t.id)])).toEqual([
      ["w2", ["mine"]],
    ])
  })
})

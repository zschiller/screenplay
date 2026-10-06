import { describe, expect, it } from "vitest"
import type { AgentMessage } from "@/lib/agent/types"
import type { DraftSource } from "@/lib/chat-draft-source-store"
import {
  createMockupChatLink,
  pageAnswers,
  pageVoice,
  type ShownChat,
} from "./mockup-chat-link"

const ROOM = "room-chat-r1"
// The chat store hands out the same transcript until it changes.
const NO_MESSAGES: AgentMessage[] = []

/** A question call, as a chat's transcript holds it. */
function asked(id: string, mockupId: string): AgentMessage {
  return {
    role: "tool_call",
    toolCallId: id,
    title: "ask_question",
    status: "completed",
    content: [],
    rawInput: {
      question: "Which row?",
      options: ["Prices", "Names only"],
      mockup_id: mockupId,
    },
  }
}

function reply(content: string): AgentMessage {
  return { role: "user", content } as AgentMessage
}

/** A canvas in memory: its chats, their transcripts and the panel. */
function canvas(opts: { shown?: ShownChat } = {}) {
  const chats = [
    { id: ROOM, target: "room" as const, createdAt: 0 },
    { id: "sketch-1", target: "sketch" as const, createdAt: 1 },
    // An earlier chat of a Workspace: what it made is the Workspace chat's.
    { id: "ws-early", branchId: "branch-1", createdAt: 2 },
    { id: "ws-chat", branchId: "branch-1", createdAt: 3 },
  ]
  const mockups = [
    { id: "sketched", title: "Pricing", lastChangedByChatId: "sketch-1" },
    { id: "workspaced", title: "Cart", lastChangedByChatId: "ws-early" },
    // Made by the Sketch Chat, changed since by the Workspace's chat (#1724).
    {
      id: "taken-over",
      title: "Receipt",
      ownerChatId: "sketch-1",
      lastChangedByChatId: "ws-chat",
    },
    // From before #1724: only the chat that made it is recorded.
    { id: "legacy", title: "Banner", ownerChatId: "sketch-1" },
    { id: "orphaned", title: "Old", lastChangedByChatId: "deleted-chat" },
    { id: "by-coordinator", title: "Plan", lastChangedByChatId: ROOM },
    { id: "by-hand", title: "" },
  ]
  const messages = new Map<string, AgentMessage[]>()
  const listeners = new Map<string, Set<() => void>>()
  const log: string[] = []
  const prefills: [string, string][] = []
  const sends: [string, string][] = []
  const sources: [string, DraftSource][] = []
  const link = () =>
    createMockupChatLink({
      mockups,
      chats,
      transcripts: {
        messages: (id) => messages.get(id) ?? NO_MESSAGES,
        subscribe: (id, cb) => {
          if (!listeners.has(id)) listeners.set(id, new Set())
          listeners.get(id)!.add(cb)
          return () => listeners.get(id)!.delete(cb)
        },
      },
      panel: {
        shown: () => opts.shown ?? null,
        showSketchChat: (id) => log.push(`sketch ${id}`),
        showWorkspaceChat: (branchId, id) =>
          log.push(`workspace ${branchId} ${id}`),
        showRoomChat: () => log.push("room"),
        openWorkspaceChat: (branchId) => {
          log.push(`open workspace ${branchId}`)
          return "ws-chat"
        },
        newSketchChat: () => {
          log.push("new sketch")
          return "new-sketch"
        },
      },
      input: {
        prefill: (id, text) => prefills.push([id, text]),
        sendWhenOpen: (id, text) => sends.push([id, text]),
      },
      draftSource: { set: (id, source) => sources.push([id, source]) },
      answered,
    })
  const answered = new Set<string>()
  /** A chat's transcript changes, as the chat store tells it. */
  const say = (chatId: string, ...more: AgentMessage[]) => {
    messages.set(chatId, [...(messages.get(chatId) ?? []), ...more])
    listeners.get(chatId)?.forEach((cb) => cb())
  }
  return { link, log, prefills, sends, sources, say }
}

describe("which chat a Mockup's page talks to (#1662)", () => {
  it("drafts in the Sketch Chat that last changed it", () => {
    const c = canvas()
    c.link().draft("sketched", "Picked B")
    expect(c.log).toEqual(["sketch sketch-1"])
    expect(c.prefills).toEqual([["sketch-1", "Picked B"]])
    expect(c.sources).toEqual([
      ["sketch-1", { mockupId: "sketched", title: "Pricing" }],
    ])
  })

  it("drafts in the chat that changed it last, not the one that made it", () => {
    const c = canvas()
    c.link().draft("taken-over", "Picked B")
    expect(c.log).toEqual(["workspace branch-1 ws-chat"])
    expect(c.prefills).toEqual([["ws-chat", "Picked B"]])
  })

  it("drafts in the chat that made a Mockup from before #1724", () => {
    const c = canvas()
    c.link().draft("legacy", "Picked B")
    expect(c.prefills).toEqual([["sketch-1", "Picked B"]])
  })

  it("drafts in its Workspace's chat, whichever of its chats changed it", () => {
    const c = canvas()
    c.link().draft("workspaced", "Picked B")
    expect(c.log).toEqual(["workspace branch-1 ws-chat"])
    expect(c.prefills).toEqual([["ws-chat", "Picked B"]])
  })

  it("drafts in the chat the panel shows when no chat on the canvas changed it", () => {
    for (const id of ["orphaned", "by-coordinator", "by-hand"]) {
      const sketch = canvas({ shown: { kind: "sketch", chatId: "sketch-1" } })
      sketch.link().draft(id, "Hi")
      expect(sketch.prefills).toEqual([["sketch-1", "Hi"]])

      const workspace = canvas({ shown: { kind: "agent", branchId: "b2" } })
      workspace.link().draft(id, "Hi")
      expect(workspace.log).toEqual(["open workspace b2"])

      // The Coordinator has no Mockup tools: a new Sketch Chat takes it.
      const room = canvas({ shown: { kind: "room" } })
      room.link().draft(id, "Hi")
      expect(room.log).toEqual(["new sketch"])
      expect(room.prefills).toEqual([["new-sketch", "Hi"]])
    }
  })

  it("asks for a Knob in the same chat a draft goes to", () => {
    const c = canvas({ shown: { kind: "room" } })
    const link = c.link()
    link.askForKnob("sketched")
    link.askForKnob("workspaced")
    link.askForKnob("orphaned")
    link.askForKnob("by-hand")
    expect(c.prefills.map(([id]) => id)).toEqual([
      "sketch-1",
      "ws-chat",
      "new-sketch",
      "new-sketch",
    ])
    expect(c.prefills[0]![1]).toBe(
      'Add a knob to the mockup "Pricing" that controls '
    )
  })

  it("offers the Knobs Ask on every Mockup (#1724)", () => {
    const link = canvas().link()
    for (const id of ["sketched", "workspaced", "orphaned", "by-hand"]) {
      expect(link.canAsk(id)).toBe(true)
    }
    expect(link.canAsk("missing")).toBe(false)
  })
})

describe("a question about a Mockup (#1644, #1662)", () => {
  it("reaches the page and is answered in its chat", () => {
    const c = canvas()
    c.say("sketch-1", asked("q1", "sketched"))
    const link = c.link()
    const found = link.question("sketched")!
    expect(found).toMatchObject({ toolCallId: "q1", chatId: "sketch-1" })
    link.answer(found, 1)
    expect(c.log).toEqual(["sketch sketch-1"])
    expect(c.sends).toEqual([["sketch-1", "Names only"]])
  })

  it("answers in the Workspace chat that asked it", () => {
    const c = canvas()
    c.say("ws-chat", asked("q1", "workspaced"))
    const link = c.link()
    link.answer(link.question("workspaced")!, 0)
    expect(c.log).toEqual(["workspace branch-1 ws-chat"])
    expect(c.sends).toEqual([["ws-chat", "Prices"]])
  })

  it("reaches the page when the Coordinator asked it, and the tap answers in the Coordinator", () => {
    const c = canvas()
    c.say(ROOM, asked("q1", "sketched"))
    const link = c.link()
    const found = link.question("sketched")
    expect(found).toMatchObject({ toolCallId: "q1", chatId: ROOM })
    link.answer(found!, 0)
    expect(c.log).toEqual(["room"])
    expect(c.sends).toEqual([[ROOM, "Prices"]])
  })

  it("answers a question about a Mockup no chat changed in the chat that asked it", () => {
    const c = canvas()
    c.say("sketch-1", asked("q1", "by-hand"))
    const link = c.link()
    link.answer(link.question("by-hand")!, 0)
    expect(c.sends).toEqual([["sketch-1", "Prices"]])
  })

  it("prefers an open question to an answered one, then the last changer’s", () => {
    const c = canvas()
    c.say("sketch-1", asked("own-answered", "sketched"), reply("Prices"))
    c.say(ROOM, asked("room-open", "sketched"))
    expect(c.link().question("sketched")?.toolCallId).toBe("room-open")

    c.say("sketch-1", asked("own-open", "sketched"))
    expect(c.link().question("sketched")?.toolCallId).toBe("own-open")
  })

  it("keeps the same question until a transcript changes, and says when one does", () => {
    const c = canvas()
    c.say(ROOM, asked("q1", "sketched"))
    const link = c.link()
    const first = link.question("sketched")
    expect(link.question("sketched")).toBe(first)

    let heard = 0
    const off = link.watchQuestions(() => heard++)
    c.say(ROOM, reply("Prices"))
    expect(heard).toBe(1)
    expect(link.question("sketched")).not.toBe(first)
    expect(link.question("sketched")?.answer).toEqual({ chosen: 0 })
    off()
    c.say(ROOM, reply("again"))
    expect(heard).toBe(1)
  })

  it("answers each question once, and never an answered one", () => {
    const c = canvas()
    c.say("sketch-1", asked("q1", "sketched"))
    const link = c.link()
    const found = link.question("sketched")!
    link.answer(found, 0)
    link.answer(found, 1)
    // The link is rebuilt as chats change; what was answered stays answered.
    c.link().answer(found, 1)
    link.answer({ ...found, toolCallId: "q2", answer: { chosen: 0 } }, 0)
    link.answer({ ...found, toolCallId: "q3" }, 7)
    expect(c.sends).toEqual([["sketch-1", "Prices"]])
  })

  it("drafts in the chat whose question is open, so sending it answers the question", () => {
    const c = canvas()
    c.say(ROOM, asked("q1", "sketched"))
    c.link().draft("sketched", "Round 1\n→ Which row?: B")
    expect(c.log).toEqual(["room"])
    expect(c.prefills).toEqual([[ROOM, "Round 1\n→ Which row?: B"]])
    expect(c.sources).toEqual([[ROOM, { mockupId: "sketched", title: "Pricing" }]])

    // Once it's answered, a draft goes back to the chat that changed it
    c.say(ROOM, reply("Round 1\n→ Which row?: B"))
    c.link().draft("sketched", "Picked A")
    expect(c.prefills.at(-1)).toEqual(["sketch-1", "Picked A"])
  })

  it("doesn't answer for a chat that was deleted", () => {
    const c = canvas()
    const link = c.link()
    link.answer(
      {
        toolCallId: "q1",
        chatId: "deleted-chat",
        question: {
          question: "Which?",
          options: [{ label: "A" }, { label: "B" }],
        },
      },
      0
    )
    expect(c.sends).toEqual([])
  })
})

describe("what a tap on the page says for this viewer (#1662)", () => {
  const you = { kind: "you" } as const
  const agent = { kind: "agent" } as const
  const none = { kind: "none" } as const
  const both = { draft: true, answer: true }
  const neither = { draft: false, answer: false }

  it("drafts and answers in their own copy while they interact and the agent isn't driving", () => {
    const own = { live: false, liveDriver: none }
    expect(pageVoice({ ...own, focused: true, driver: none })).toEqual(both)
    expect(pageVoice({ ...own, focused: true, driver: you })).toEqual(both)
    expect(pageVoice({ ...own, focused: false, driver: none })).toEqual(neither)
    expect(pageVoice({ ...own, focused: true, driver: agent })).toEqual(neither)
  })

  it("drafts and answers on a live page only while they have control", () => {
    const live = { live: true, focused: true, driver: none }
    expect(pageVoice({ ...live, liveDriver: you })).toEqual(both)
    expect(pageVoice({ ...live, liveDriver: none })).toEqual(neither)
    expect(pageVoice({ ...live, liveDriver: agent })).toEqual(neither)
    expect(
      pageVoice({
        ...live,
        liveDriver: { kind: "person", id: "u2", name: "Sam", color: "#f80" },
      })
    ).toEqual(neither)
  })
})

describe("whether a tap on the page can answer at all", () => {
  const you = { kind: "you" } as const
  const agent = { kind: "agent" } as const
  const none = { kind: "none" } as const
  const sam = { kind: "person", id: "u2", name: "Sam", color: "#f80" } as const

  it("can in their own copy unless the agent drives it, focused or not", () => {
    const own = { live: false, liveDriver: none }
    expect(pageAnswers({ ...own, focused: true, driver: none })).toBe(true)
    expect(pageAnswers({ ...own, focused: false, driver: none })).toBe(true)
    expect(pageAnswers({ ...own, focused: true, driver: agent })).toBe(false)
  })

  it("can on a live page while a person has control, the same for every viewer", () => {
    const live = { live: true, driver: none, focused: false }
    expect(pageAnswers({ ...live, liveDriver: you })).toBe(true)
    expect(pageAnswers({ ...live, liveDriver: sam })).toBe(true)
    expect(pageAnswers({ ...live, liveDriver: none })).toBe(false)
    expect(pageAnswers({ ...live, liveDriver: agent })).toBe(false)
  })

  it("on a live page, reads only who has control, not this viewer's own copy", () => {
    const live = { live: true, liveDriver: sam }
    for (const focused of [true, false])
      for (const driver of [you, none, agent] as const)
        expect(pageAnswers({ ...live, focused, driver })).toBe(true)
  })
})

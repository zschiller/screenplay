import { describe, expect, it } from "vitest"

import {
  hasOpenQuestion,
  mockupQuestion,
  parseQuestion,
  questionAnswers,
} from "./question"
import type { AgentMessage } from "@/lib/agent/types"

const ask = (
  toolCallId: string,
  rawInput: unknown,
  title = "ask_question"
): AgentMessage => ({
  role: "tool_call",
  toolCallId,
  title,
  status: "completed",
  content: [],
  rawInput,
})

const layout = {
  question: "Which layout?",
  options: [{ label: "Compact", detail: "One row" }, { label: "Roomy" }],
  recommended: 0,
}

describe("parseQuestion (#1312)", () => {
  it("reads a question with options and a recommendation", () => {
    expect(parseQuestion(layout)).toEqual({
      question: "Which layout?",
      options: [{ label: "Compact", detail: "One row" }, { label: "Roomy" }],
      recommended: 0,
    })
  })

  it("takes plain string options, as a harness may send them", () => {
    expect(
      parseQuestion({ question: "Ship it?", options: ["Yes", "No"] })
    ).toEqual({
      question: "Ship it?",
      options: [{ label: "Yes" }, { label: "No" }],
      recommended: undefined,
    })
  })

  it("makes no card from fewer than 2 or more than 4 options", () => {
    expect(parseQuestion({ question: "Q", options: ["A"] })).toBeNull()
    expect(
      parseQuestion({ question: "Q", options: ["A", "B", "C", "D", "E"] })
    ).toBeNull()
  })

  it("makes no card while the arguments are still streaming", () => {
    expect(parseQuestion(undefined)).toBeNull()
    expect(parseQuestion({ question: "Which" })).toBeNull()
  })

  it("drops a recommendation that names no option", () => {
    expect(parseQuestion({ ...layout, recommended: 5 })?.recommended).toBe(
      undefined
    )
  })
})

describe("questionAnswers (#1312)", () => {
  it("leaves a question no user message follows open", () => {
    expect(questionAnswers([ask("q1", layout)]).has("q1")).toBe(false)
  })

  it("answers a question with the option the next user message names", () => {
    const answers = questionAnswers([
      ask("q1", layout),
      { role: "user", content: " roomy " },
    ])
    expect(answers.get("q1")).toEqual({ chosen: 1 })
  })

  it("closes a question answered in words with no option chosen", () => {
    const answers = questionAnswers([
      ask("q1", layout),
      { role: "user", content: "Neither, try a sidebar" },
    ])
    expect(answers.get("q1")).toEqual({ chosen: null })
  })

  it("matches a harness's namespaced call", () => {
    const answers = questionAnswers([
      ask("q1", layout, "mcp__screenplay__ask_question"),
      { role: "user", content: "Compact" },
    ])
    expect(answers.get("q1")).toEqual({ chosen: 0 })
  })

  it("names who answered, when the server recorded a sender", () => {
    const answers = questionAnswers([
      ask("q1", layout),
      { role: "user", content: "Compact", sentBy: "user_maya" },
    ])
    expect(answers.get("q1")).toEqual({ chosen: 0, by: "user_maya" })
  })

  it("doesn't credit a Delegated Message's sender with the answer", () => {
    const answers = questionAnswers([
      ask("q1", layout),
      {
        role: "user",
        content: "Compact",
        sentBy: "user_maya",
        delegatedFrom: "room-chat-r1",
      },
    ])
    expect(answers.get("q1")).toEqual({ chosen: 0 })
  })

  it("isn't answered by a Coordinator wake", () => {
    const answers = questionAnswers([
      ask("q1", layout),
      { role: "user", content: "Compact", wakeFrom: "branch-1" },
    ])
    expect(answers.has("q1")).toBe(false)
  })
})

describe("hasOpenQuestion", () => {
  it("is open while no user message follows the question", () => {
    expect(
      hasOpenQuestion([
        { role: "user", content: "Make it nicer" },
        ask("q1", layout),
        { role: "assistant", content: "Pick one and I'll carry on." },
      ])
    ).toBe(true)
  })

  it("closes once the user answers", () => {
    expect(
      hasOpenQuestion([ask("q1", layout), { role: "user", content: "Roomy" }])
    ).toBe(false)
  })

  it("stays open through a Coordinator wake", () => {
    expect(
      hasOpenQuestion([
        ask("q1", layout),
        { role: "user", content: "Status?", wakeFrom: "branch-1" },
      ])
    ).toBe(true)
  })

  it("is closed in a transcript with no question", () => {
    expect(hasOpenQuestion([{ role: "user", content: "Hi" }])).toBe(false)
  })
})

const reply = (content: string): AgentMessage => ({ role: "user", content })

describe("mockupQuestion (#1644)", () => {
  const about = { ...layout, mockup_id: "mock-1" }

  it("reads the Mockup a question is about", () => {
    expect(parseQuestion(about)?.mockupId).toBe("mock-1")
    expect(parseQuestion(layout)).not.toHaveProperty("mockupId")
  })

  it("finds the latest question about the Mockup, open until a reply", () => {
    const messages = [
      ask("q1", { ...about, question: "Earlier?" }),
      reply("Roomy"),
      ask("q2", about),
      ask("q3", { ...layout, mockup_id: "mock-2" }),
    ]
    const found = mockupQuestion(messages, "mock-1")
    expect(found?.toolCallId).toBe("q2")
    expect(found?.question.question).toBe("Which layout?")
    expect(found).not.toHaveProperty("answer")
    expect(mockupQuestion(messages, "mock-3")).toBeNull()
  })

  it("carries the answer once a reply follows", () => {
    const found = mockupQuestion([ask("q1", about), reply("compact")], "mock-1")
    expect(found?.answer).toEqual({ chosen: 0 })
  })
})

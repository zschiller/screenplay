// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"
import { viewRequests, type ViewRequest } from "@/lib/canvas/view-requests"
import { QuestionCard } from "./question-card"

// The Mockups on the canvas, by id, as the room doc would hold them.
const titles = new Map<string, string>([["mock-1", "Option B · Suggestions"]])
vi.mock("@/lib/yjs/react", () => ({
  useMockupTitle: (id: string) => titles.get(id),
}))

afterEach(cleanup)

const ask = (rawInput: object) =>
  ({
    role: "tool_call",
    toolCallId: "q1",
    title: "ask_question",
    kind: "other",
    status: "completed",
    content: [],
    rawInput: {
      question: "How should the row show each product?",
      options: [{ label: "Show prices" }, { label: "Names only" }],
      recommended: 1,
      ...rawInput,
    },
  }) as AgentMessage & { role: "tool_call" }

const choice = (name: RegExp) =>
  screen.getByRole("radio", { name }) as HTMLInputElement

describe("QuestionCard on a Mockup (#1644)", () => {
  it("names the Mockup under the question and brings it into view", () => {
    const requests: ViewRequest[] = []
    const unsubscribe = viewRequests.subscribe((r) => requests.push(r))
    render(<QuestionCard message={ask({ mockup_id: "mock-1" })} chatId="c" />)

    const line = screen.getByTestId("question-mockup")
    expect(line.textContent).toBe("On Option B · Suggestions")
    fireEvent.click(screen.getByRole("button", { name: /Option B/ }))
    unsubscribe()

    expect(requests).toEqual([{ ids: ["mock-1"] }])
  })

  it("draws no line for a question about nothing, or a Mockup that's gone", () => {
    render(<QuestionCard message={ask({})} chatId="c" />)
    expect(screen.queryByTestId("question-mockup")).toBeNull()
    cleanup()
    render(<QuestionCard message={ask({ mockup_id: "deleted" })} chatId="c" />)
    expect(screen.queryByTestId("question-mockup")).toBeNull()
  })

  it("shows an answer given on the page as it does a click on the card", () => {
    // The page sent the option's label as the person's message, so the
    // transcript's answer is the same as a click's.
    render(
      <QuestionCard
        message={ask({ mockup_id: "mock-1" })}
        chatId="c"
        answer={{ chosen: 1 }}
      />
    )
    expect(choice(/Names only/).checked).toBe(true)
    expect(choice(/Show prices/).disabled).toBe(true)
    expect(screen.queryByTestId("question-answered-by")).toBeNull()
  })
})

describe("QuestionCard keys", () => {
  const listen = (result: boolean | Promise<boolean> = true) => {
    const sent: string[] = []
    const unsubscribe = inputStore.subscribeSend("c", (t) => {
      sent.push(t)
      return result
    })
    return { sent, unsubscribe }
  }

  it("moves between choices with the arrow keys without sending", () => {
    const { sent, unsubscribe } = listen()
    render(<QuestionCard message={ask({})} chatId="c" />)

    choice(/Show prices/).focus()
    fireEvent.keyDown(choice(/Show prices/), { key: "ArrowDown" })
    expect(document.activeElement).toBe(choice(/Names only/))
    fireEvent.keyDown(choice(/Names only/), { key: "ArrowDown" })
    expect(document.activeElement).toBe(choice(/Show prices/))
    fireEvent.keyDown(choice(/Show prices/), { key: "ArrowUp" })
    expect(document.activeElement).toBe(choice(/Names only/))
    unsubscribe()

    expect(sent).toEqual([])
    expect(choice(/Show prices/).checked).toBe(false)
    expect(choice(/Names only/).checked).toBe(false)
  })

  it("sends the focused choice on Enter", () => {
    const { sent, unsubscribe } = listen()
    render(<QuestionCard message={ask({})} chatId="c" />)

    choice(/Names only/).focus()
    fireEvent.keyDown(choice(/Names only/), { key: "Enter" })
    unsubscribe()

    expect(sent).toEqual(["Names only"])
    expect(choice(/Names only/).checked).toBe(true)
    expect(choice(/Show prices/).disabled).toBe(true)
  })

  it("opens again when the send is refused", async () => {
    const { sent, unsubscribe } = listen(Promise.resolve(false))
    render(<QuestionCard message={ask({})} chatId="c" />)

    fireEvent.click(choice(/Names only/))
    expect(choice(/Show prices/).disabled).toBe(true)
    await waitFor(() => expect(choice(/Show prices/).disabled).toBe(false))
    expect(choice(/Names only/).checked).toBe(false)

    fireEvent.click(choice(/Show prices/))
    unsubscribe()
    expect(sent).toEqual(["Names only", "Show prices"])
  })

  it("opens again when no chat takes the send", async () => {
    render(<QuestionCard message={ask({})} chatId="nobody" />)
    fireEvent.click(choice(/Names only/))
    await waitFor(() => expect(choice(/Show prices/).disabled).toBe(false))
  })
})

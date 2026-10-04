// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// The question runtime is a plain script inlined into every Mockup page
// (#1644). In jsdom the page is its own parent, so what it posts up arrives
// here, and the canvas's side is played by dispatching its messages.
const RUNTIME = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "mockup-question.js"),
  "utf8"
)

type Question = {
  id: string
  question: string
  options: { label: string; detail?: string }[]
  recommended: number | null
  answer: { index: number | null } | null
}
const screenplay = () =>
  (
    window as unknown as {
      screenplay: {
        question: (cb?: (q: Question | null) => void) => Question | null
        answer: (index: number) => boolean
      }
    }
  ).screenplay

const posted: { type: string; [key: string]: unknown }[] = []
const flush = () => new Promise((r) => setTimeout(r, 0))

function apply(question: Question | null) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "screenplay:question-apply", question },
    })
  )
}

// A tap in progress, as the browser reports it.
function gesture(active: boolean) {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive: active, hasBeenActive: active },
  })
}

const open: Question = {
  id: "call-1",
  question: "How should the row show each product?",
  options: [{ label: "Show prices" }, { label: "Names only" }],
  recommended: 1,
  answer: null,
}

beforeAll(() => {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "screenplay:question-answer") posted.push(e.data)
  })
  new Function(RUNTIME)()
})

afterEach(() => {
  posted.length = 0
  gesture(false)
})

describe("Mockup question runtime (#1644)", () => {
  it("calls back at once and on every change", () => {
    const seen: (Question | null)[] = []
    screenplay().question((q) => seen.push(q))
    apply(open)
    apply({ ...open, answer: { index: 0 } })
    expect(seen).toEqual([null, open, { ...open, answer: { index: 0 } }])
    expect(screenplay().question()?.answer).toEqual({ index: 0 })
  })

  it("answers from a tap, naming the question", async () => {
    apply(open)
    gesture(true)
    expect(screenplay().answer(1)).toBe(true)
    await flush()
    expect(posted).toEqual([
      { type: "screenplay:question-answer", id: "call-1", index: 1 },
    ])
  })

  it("does nothing without a tap", async () => {
    apply(open)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(screenplay().answer(1)).toBe(false)
    warn.mockRestore()
    await flush()
    expect(posted).toEqual([])
  })

  it("does nothing once answered, with no question, or out of range", async () => {
    gesture(true)
    apply({ ...open, answer: { index: 0 } })
    expect(screenplay().answer(1)).toBe(false)
    apply(null)
    expect(screenplay().answer(0)).toBe(false)
    apply(open)
    expect(screenplay().answer(2)).toBe(false)
    expect(screenplay().answer(-1)).toBe(false)
    await flush()
    expect(posted).toEqual([])
  })
})

describe("Mockup question runtime's first request", () => {
  it("was posted on load", async () => {
    const seen: unknown[] = []
    const listener = (e: MessageEvent) => seen.push(e.data)
    window.addEventListener("message", listener)
    // A fresh copy of the runtime in a page that hasn't one yet.
    const saved = (window as unknown as { screenplay?: object }).screenplay
    delete (window as unknown as { screenplay?: object }).screenplay
    new Function(RUNTIME)()
    await flush()
    window.removeEventListener("message", listener)
    ;(window as unknown as { screenplay?: object }).screenplay = saved
    expect(seen).toContainEqual({ type: "screenplay:question-request" })
  })
})

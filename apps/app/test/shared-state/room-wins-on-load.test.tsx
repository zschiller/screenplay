// @vitest-environment jsdom
import { act, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// @screenplay.space/state evaluates its gate (development build, inside an
// iframe) once at module load, so each test stubs the parent frame and
// imports a fresh copy.
type StateModule =
  typeof import("../../../../packages/screenplay-state/index.js")

let posted: unknown[]
let originalEnv: string | undefined
// NODE_ENV is typed read-only; the package reads it at load time.
const env = process.env as Record<string, string | undefined>

async function loadPackage(): Promise<StateModule> {
  vi.resetModules()
  return import("../../../../packages/screenplay-state/index.js")
}

function publishes() {
  return posted
    .filter(
      (m): m is { type: string; state: Record<string, unknown> } =>
        (m as { type?: string }).type === "screenplay:shared-state"
    )
    .map((m) => m.state)
}

function roomAnswers(state: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "screenplay:shared-state-apply", state, initial: true },
    })
  )
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout"] })
  posted = []
  originalEnv = process.env.NODE_ENV
  env.NODE_ENV = "development"
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: { postMessage: (m: unknown) => posted.push(m) },
  })
})

afterEach(() => {
  vi.useRealTimers()
  env.NODE_ENV = originalEnv
  Object.defineProperty(window, "parent", { configurable: true, value: window })
})

function makeBilling(useSharedState: StateModule["useSharedState"]) {
  return function Billing() {
    const [annual, setAnnual] = useState(false)
    useSharedState<string>("billing", annual ? "annual" : "monthly", (v) =>
      setAnnual(v === "annual")
    )
    return <span>{annual ? "annual" : "monthly"}</span>
  }
}

describe("room state wins when a frame loads", () => {
  it("asks the room first and keeps the room's value", async () => {
    const { useSharedState } = await loadPackage()
    expect(posted).toContainEqual({ type: "screenplay:shared-state-request" })
    const Billing = makeBilling(useSharedState)
    const { container } = render(<Billing />)
    await flush()
    // Nothing goes out until the room answers.
    expect(publishes()).toEqual([])

    await act(async () => roomAnswers({ billing: "annual", other: 1 }))
    await flush()
    expect(container.textContent).toBe("annual")
    expect(publishes()).toEqual([{ billing: "annual", other: 1 }])
  })

  it("adopts the room's value in a component that mounts later", async () => {
    const { useSharedState } = await loadPackage()
    await act(async () => roomAnswers({ billing: "annual" }))
    await flush()
    const Billing = makeBilling(useSharedState)
    const { container } = render(<Billing />)
    await flush()
    expect(container.textContent).toBe("annual")
    expect(publishes().every((s) => s.billing === "annual")).toBe(true)
  })

  it("a fresh room takes the frame's initial values", async () => {
    const { useSharedState } = await loadPackage()
    const Billing = makeBilling(useSharedState)
    const { container } = render(<Billing />)
    await flush()
    await act(async () => roomAnswers({}))
    await flush()
    expect(container.textContent).toBe("monthly")
    expect(publishes()).toEqual([{ billing: "monthly" }])
  })

  it("publishes after a timeout when the room never answers", async () => {
    const { useSharedState } = await loadPackage()
    const Billing = makeBilling(useSharedState)
    render(<Billing />)
    await flush()
    expect(publishes()).toEqual([])
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    await flush()
    expect(publishes()).toEqual([{ billing: "monthly" }])
  })
})

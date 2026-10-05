import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createPageAnswerer,
  pageAskMessage,
  type BridgePageAsk,
  type TakenInput,
} from "@/lib/frame-drive/canvas/page-answerer"

const MAX_MS = 15_000

/** An answerer whose takes hand out inputs that record each release, and
 *  call `setTakesPointer` as `takeFrameInput` does. */
function setup() {
  const pointer: boolean[] = []
  const inputs: { releases: (boolean | undefined)[] }[] = []
  const bridge = vi.fn(async (_ask: BridgePageAsk) => "answered")
  let frame = true
  const answerer = createPageAnswerer({
    bridge,
    take: async (at): Promise<TakenInput | null> => {
      if (!frame) return null
      if (at) pointer.push(true)
      const input = { releases: [] as (boolean | undefined)[] }
      inputs.push(input)
      return {
        window: at ? { x: at.x * 2, y: at.y * 2 } : null,
        release(rest) {
          input.releases.push(rest)
          if (at && !rest) pointer.push(false)
        },
      }
    },
    maxTakenMs: MAX_MS,
  })
  return {
    answerer,
    bridge,
    pointer,
    inputs,
    removeFrame: () => {
      frame = false
    },
  }
}

describe("page answerer", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("asks the bridge for locate, cursor and state", async () => {
    const { answerer, bridge } = setup()
    const locate = {
      kind: "locate" as const,
      target: { selector: "#name" },
      focus: "field" as const,
    }
    expect(await answerer.answer(locate)).toBe("answered")
    await answerer.answer({ kind: "cursor", what: { press: true } })
    await answerer.answer({ kind: "state", selector: "#name" })
    expect(bridge.mock.calls.map(([ask]) => ask)).toEqual([
      locate,
      { kind: "cursor", what: { press: true } },
      { kind: "state", selector: "#name" },
    ])
  })

  it("answers a take with where the pointer lands", async () => {
    const { answerer } = setup()
    expect(
      await answerer.answer({ kind: "take", at: { x: 10, y: 20 } })
    ).toEqual({ window: { x: 20, y: 40 } })
    expect(await answerer.answer({ kind: "take" })).toEqual({ window: null })
  })

  it("answers null when the frame isn't there to take", async () => {
    const { answerer, removeFrame } = setup()
    removeFrame()
    expect(await answerer.answer({ kind: "take" })).toBeNull()
  })

  it("hands the input back after the longest a gesture may hold it", async () => {
    const { answerer, pointer, inputs } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    await vi.advanceTimersByTimeAsync(MAX_MS - 1)
    expect(inputs[0].releases).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(inputs[0].releases).toEqual([false])
    expect(pointer).toEqual([true, false])
  })

  it("times each take from its own start", async () => {
    const { answerer, inputs } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    await vi.advanceTimersByTimeAsync(MAX_MS / 2)
    await answerer.answer({ kind: "release" })
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    // When the first take's time would have run out.
    await vi.advanceTimersByTimeAsync(MAX_MS / 2 + 1)
    expect(inputs[1].releases).toEqual([])
    await vi.advanceTimersByTimeAsync(MAX_MS / 2)
    expect(inputs[1].releases).toEqual([false])
  })

  it("releases the last take before the next one takes the input", async () => {
    const { answerer, inputs, pointer } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    await answerer.answer({ kind: "take", at: { x: 2, y: 2 } })
    expect(inputs[0].releases).toEqual([false])
    expect(pointer).toEqual([true, false, true])
  })

  it("keeps a hover's resting pointer until the next take ends it", async () => {
    const { answerer, inputs, pointer } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    await answerer.answer({ kind: "release", rest: true })
    expect(inputs[0].releases).toEqual([true])
    expect(pointer).toEqual([true])
    // A resting hover has no time limit.
    await vi.advanceTimersByTimeAsync(MAX_MS * 2)
    expect(inputs[0].releases).toEqual([true])
    await answerer.answer({ kind: "take", at: { x: 2, y: 2 } })
    expect(inputs[0].releases).toEqual([true, false])
    expect(pointer).toEqual([true, false, true])
  })

  it("hands back held input and clears the timer on dispose", async () => {
    const { answerer, inputs, pointer } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    answerer.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(inputs[0].releases).toEqual([false])
    expect(pointer).toEqual([true, false])
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ends a resting hover on dispose", async () => {
    const { answerer, inputs } = setup()
    await answerer.answer({ kind: "take", at: { x: 1, y: 1 } })
    await answerer.answer({ kind: "release", rest: true })
    answerer.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(inputs[0].releases).toEqual([true, false])
  })
})

describe("pageAskMessage", () => {
  it("maps each bridge ask to its bridge message", () => {
    expect(
      pageAskMessage({
        kind: "locate",
        target: { text: "Save" },
        focus: "element",
        replace: true,
        show: true,
      })
    ).toEqual({
      type: "screenplay:drive-locate",
      target: { text: "Save" },
      focus: "element",
      replace: true,
      show: true,
    })
    expect(
      pageAskMessage({ kind: "cursor", what: { to: { x: 1, y: 2 } } })
    ).toEqual({ type: "screenplay:drive-cursor", to: { x: 1, y: 2 } })
    expect(pageAskMessage({ kind: "state", selector: "#a" })).toEqual({
      type: "screenplay:drive-state",
      selector: "#a",
    })
  })
})

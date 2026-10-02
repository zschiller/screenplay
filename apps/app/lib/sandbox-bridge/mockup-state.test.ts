// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"

// The shared-state runtime is a plain script inlined into every Mockup page.
// In jsdom the page is its own parent, so what it posts up arrives here.
const RUNTIME = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "mockup-state.js"),
  "utf8"
)

type Shared = { get: () => unknown; set: (v: unknown) => void }
const shareState = (key: string, initial: unknown, cb?: (v: unknown) => void) =>
  (
    window as unknown as {
      screenplay: {
        shareState: (k: string, i: unknown, cb?: (v: unknown) => void) => Shared
      }
    }
  ).screenplay.shareState(key, initial, cb)

const published: unknown[] = []
const flush = () => new Promise((r) => setTimeout(r, 0))

function apply(state: object, initial = false) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "screenplay:shared-state-apply", state, initial },
    })
  )
}

beforeAll(() => {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "screenplay:shared-state") published.push(e.data.state)
  })
  new Function(RUNTIME)()
})

describe("mockup shared state runtime", () => {
  it("waits for the room, takes its value over the default, then syncs both ways", async () => {
    const onChange = vi.fn()
    const count = shareState("count", 0, onChange)
    expect(onChange).toHaveBeenLastCalledWith(0)
    await flush()
    // Nothing goes up before the room answers.
    expect(published).toEqual([])

    apply({ count: 5 }, true)
    expect(onChange).toHaveBeenLastCalledWith(5)
    expect(count.get()).toBe(5)

    count.set(6)
    expect(onChange).toHaveBeenLastCalledWith(6)
    await flush()
    expect(published.at(-1)).toEqual({ count: 6 })

    apply({ count: 9 })
    expect(onChange).toHaveBeenLastCalledWith(9)
  })

  it("publishes a new key's default once the room has answered", async () => {
    const tab = shareState("tab", "home")
    expect(tab.get()).toBe("home")
    await flush()
    expect(published.at(-1)).toEqual({ count: 9, tab: "home" })
  })
})

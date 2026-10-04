// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// The chat runtime is a plain script inlined into every Mockup page. In jsdom
// the page is its own parent, so what it posts up arrives here.
const RUNTIME = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "mockup-chat.js"),
  "utf8"
)

const draft = (text: unknown) =>
  (
    window as unknown as { screenplay: { draft: (t: unknown) => boolean } }
  ).screenplay.draft(text)

const posted: unknown[] = []
const flush = () => new Promise((r) => setTimeout(r, 0))

// jsdom has no user activation; a tap is `isActive` while it's handled.
function activation(isActive: boolean) {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { isActive, hasBeenActive: isActive },
  })
}

beforeAll(() => {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "screenplay:draft") posted.push(e.data)
  })
  new Function(RUNTIME)()
})
afterEach(() => {
  posted.length = 0
  vi.restoreAllMocks()
})

describe("mockup chat runtime", () => {
  it("drafts the text into the chat from a tap", async () => {
    activation(true)
    expect(draft("Picked B. Note on C: too dense")).toBe(true)
    await flush()
    expect(posted).toEqual([
      { type: "screenplay:draft", text: "Picked B. Note on C: too dense" },
    ])
  })

  it("does nothing on its own, without a tap", async () => {
    activation(false)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(draft("Picked B")).toBe(false)
    await flush()
    expect(posted).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })

  it("needs some text", () => {
    activation(true)
    expect(() => draft("  ")).toThrow()
    expect(() => draft(42)).toThrow()
  })
})

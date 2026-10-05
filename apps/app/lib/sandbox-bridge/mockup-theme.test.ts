// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

// The theme runtime is a plain script inlined into every Mockup page. In
// jsdom the page is its own parent, so what it posts up arrives here, and the
// canvas's side is played by dispatching its messages.
const RUNTIME = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "mockup-theme.js"),
  "utf8"
)

type Scheme = "light" | "dark"
const screenplay = () =>
  (
    window as unknown as {
      screenplay: { theme: (cb?: (s: Scheme) => void) => Scheme | null }
    }
  ).screenplay

const posted: unknown[] = []
const flush = () => new Promise((r) => setTimeout(r, 0))

function apply(scheme: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "screenplay:theme-apply", scheme },
    })
  )
}

beforeAll(() => {
  window.addEventListener("message", (e) => posted.push(e.data))
  new Function(RUNTIME)()
})

describe("Mockup theme runtime", () => {
  it("asks the canvas for the app's theme on load", async () => {
    await flush()
    expect(posted).toContainEqual({ type: "screenplay:theme-request" })
  })

  it("stays quiet until the canvas says, then calls back on every change", () => {
    const seen: Scheme[] = []
    expect(screenplay().theme((s) => seen.push(s))).toBeNull()
    expect(seen).toEqual([])
    apply("dark")
    apply("dark")
    apply("light")
    expect(seen).toEqual(["dark", "light"])
  })

  it("calls a late listener at once with the theme it knows", () => {
    apply("dark")
    const seen: Scheme[] = []
    screenplay().theme((s) => seen.push(s))
    expect(seen).toEqual(["dark"])
  })

  it("ignores anything but light or dark", () => {
    apply("light")
    apply("sepia")
    expect(screenplay().theme()).toBe("light")
  })
})

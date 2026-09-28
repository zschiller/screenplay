// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

// The bridge is a plain script injected into every frame; run it in jsdom and
// talk to it over postMessage the way the canvas does.
const BRIDGE = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "bridge.js"),
  "utf8"
)

let nextId = 1

function query(op: string, payload: Record<string, unknown>) {
  const id = `q${nextId++}`
  return new Promise<unknown>((resolve, reject) => {
    function onMessage(e: MessageEvent) {
      const d = e.data
      if (d?.type !== "screenplay:dom-result" || d.id !== id) return
      window.removeEventListener("message", onMessage)
      if (d.ok) resolve(d.value)
      else reject(new Error(d.error))
    }
    window.addEventListener("message", onMessage)
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "screenplay:dom-query", op, id, ...payload },
        source: window,
      })
    )
  })
}

type Resolved = { path: string; rects: (object | null)[] }

beforeAll(() => {
  // jsdom lacks CSS.escape.
  const g = globalThis as { CSS?: { escape?: (s: string) => string } }
  g.CSS ??= {}
  g.CSS.escape ??= (s: string) => s.replace(/["\\]/g, "\\$&")
  new Function(BRIDGE)()
})

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <button id="pay">Pay now</button>
      <button data-testid="apply">Apply</button>
      <ul><li><a>Shoes</a></li><li><a>Hats</a></li></ul>
    </main>`
})

describe("bridge resolveAnchors", () => {
  it("finds an element by id, test id, text, then path", async () => {
    const res = (await query("resolveAnchors", {
      anchors: [
        { path: "nope", tag: "button", id: "pay" },
        { path: "nope", tag: "button", testId: "apply" },
        { path: "nope", tag: "a", text: "Hats" },
        { path: "main > ul > li:nth-of-type(1) > a", tag: "a" },
        { path: "main > button:nth-of-type(1)", tag: "a" },
        { path: "nope", tag: "a", text: "Socks" },
      ],
    })) as Resolved
    expect(res.path).toBe(window.location.pathname)
    expect(res.rects.map((r) => r !== null)).toEqual([
      true,
      true,
      true,
      true,
      // A path that now lands on another kind of element isn't a match.
      false,
      false,
    ])
  })

  it("reports the anchor keys for an element at a point", async () => {
    document.elementFromPoint = () => document.getElementById("pay")
    const res = (await query("elementAtPoint", { x: 1, y: 1 })) as {
      anchor: Record<string, string>
      path: string
    }
    expect(res.anchor).toEqual({
      path: "#pay",
      tag: "button",
      id: "pay",
      text: "Pay now",
    })
    expect(res.path).toBe(window.location.pathname)
  })
})

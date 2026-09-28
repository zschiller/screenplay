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
  return send({ type: "screenplay:dom-query", op, ...payload })
}

function send(msg: Record<string, unknown>) {
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
        data: { ...msg, id },
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

describe("bridge navigate", () => {
  const navigate = (path: string) =>
    send({ type: "screenplay:navigate", path }) as Promise<boolean>
  const reported: { path: string; replace: boolean }[] = []
  function onNavigation(e: MessageEvent) {
    if (e.data?.type === "screenplay:navigation") reported.push(e.data)
  }

  beforeEach(() => {
    history.replaceState(null, "", "/start")
    reported.length = 0
    window.addEventListener("message", onNavigation)
    return () => {
      window.removeEventListener("message", onNavigation)
      delete (window as { next?: unknown }).next
    }
  })

  it("drives Next's router when the page exposes one", async () => {
    const pushed: string[] = []
    ;(window as { next?: unknown }).next = {
      router: { push: (href: string) => pushed.push(href) },
    }
    await expect(navigate("/pricing?plan=team")).resolves.toBe(true)
    expect(pushed).toEqual(["/pricing?plan=team"])
  })

  it("routes a popstate router without reloading, keeping typed input", async () => {
    document.body.innerHTML = `<input id="name" /><main>Home</main>`
    const input = document.getElementById("name") as HTMLInputElement
    input.value = "Ada"
    const route = () => {
      document.querySelector("main")!.textContent = location.pathname
    }
    window.addEventListener("popstate", route)
    try {
      await expect(navigate("/customers")).resolves.toBe(true)
    } finally {
      window.removeEventListener("popstate", route)
    }
    expect(location.pathname).toBe("/customers")
    expect(document.querySelector("main")!.textContent).toBe("/customers")
    expect(input.value).toBe("Ada")
    // The page reports the route like any navigation of its own.
    await new Promise((r) => setTimeout(r, 0))
    expect(reported.map((r) => r.path)).toContain("/customers")
  })

  it("asks for the reload when nothing on the page takes the route", async () => {
    await expect(navigate("/about")).resolves.toBe(false)
  })

  it("moves to an anchor on the same page without a router", async () => {
    await expect(navigate("/start#faq")).resolves.toBe(true)
    expect(location.hash).toBe("#faq")
  })

  it("does nothing for the route the page is already on", async () => {
    await expect(navigate("/start")).resolves.toBe(true)
    expect(location.pathname).toBe("/start")
  })
})

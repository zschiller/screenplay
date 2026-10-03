// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  FrameStreamConnection,
  type FrameStreamDeps,
} from "@/lib/frame-stream/client"
import type {
  FrameStreamClientMessage,
  FrameStreamServerMessage,
} from "@/lib/frame-stream/protocol"
import type { CanvasToIframeMessage } from "@/lib/postmessage-protocol"
import { pageSnapshotScript } from "./page-snapshot"

// The bridge is a plain script injected into every frame; run it in jsdom and
// talk to it the ways the canvas does: postMessage into a local iframe, and
// for a Shared Frame (#1394) the Frame Stream, whose service relays the same
// messages to the page in the Sandbox (frame-stream.test.ts runs that relay
// in a real browser).
const BRIDGE = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "bridge.js"),
  "utf8"
)

let nextId = 1

type Send = (msg: Record<string, unknown>) => Promise<unknown>

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

// The Frame Stream from the canvas's side: the real client connection, over
// a socket that stands in for the service. Every message crosses it as JSON,
// as on the wire; the stand-in hands the bridge's messages to the page and
// what the page posts to its parent back to the canvas.
const FRAME = "f1"
const relayed = new WeakSet<object>()
let stream: FrameStreamConnection | null = null

async function openStream(): Promise<FrameStreamConnection> {
  if (stream) return stream
  const socket: ReturnType<FrameStreamDeps["openSocket"]> = {
    binaryType: "",
    readyState: 1,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    close() {},
    send(data: string) {
      const msg = JSON.parse(data) as FrameStreamClientMessage
      if (msg.t === "auth") reply({ t: "ready", codec: "h264" })
      if (msg.t !== "bridge") return
      const message = msg.message as object
      relayed.add(message)
      window.dispatchEvent(
        new MessageEvent("message", { data: message, source: window })
      )
    },
  }
  const reply = (msg: FrameStreamServerMessage) =>
    socket.onmessage?.({ data: JSON.stringify(msg) })
  window.addEventListener("message", (e) => {
    const d = e.data
    if (typeof d?.type !== "string" || !d.type.startsWith("screenplay:")) return
    if (relayed.has(d)) return
    reply({ t: "bridge", frame: FRAME, message: d })
  })
  const conn = new FrameStreamConnection({
    fetchEndpoint: async () => ({
      shared: true,
      url: "ws://stream",
      token: "t",
    }),
    openSocket: () => {
      setTimeout(() => socket.onopen?.({}), 0)
      return socket
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  })
  conn.watch(
    FRAME,
    { route: "/", width: 800, height: 600 },
    { onMessage() {}, onVideo() {} }
  )
  while (!conn.isReady()) await new Promise((r) => setTimeout(r, 0))
  stream = conn
  return conn
}

async function sendOverStream(msg: Record<string, unknown>) {
  const port = (await openStream()).bridgePort(FRAME)
  const id = `s${nextId++}`
  return new Promise<unknown>((resolve, reject) => {
    const off = port.subscribe((d) => {
      if (d.type !== "screenplay:dom-result" || d.id !== id) return
      off()
      if (d.ok) resolve(d.value)
      else reject(new Error(d.error))
    })
    if (!port.post({ ...msg, id } as CanvasToIframeMessage))
      reject(new Error("not sent"))
  })
}

type Resolved = { path: string; rects: (object | null)[] }

type Snapshot = {
  url: string
  title: string
  htmlAttributes: string
  bodyAttributes: string
  markup: string
  css: string
  stylesheetLinks: string[]
}

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

// The reads the canvas's frame features make (comment pins, the element
// picker, Element References, Fit to content, a chat's page read) go over
// both transports.
describe.each<{ transport: string; send: Send }>([
  { transport: "postMessage", send },
  { transport: "the Frame Stream", send: sendOverStream },
])("bridge reads over $transport", ({ send }) => {
  const query = (op: string, payload: Record<string, unknown>) =>
    send({ type: "screenplay:dom-query", op, ...payload })

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

  describe("bridge getPageSnapshot", () => {
    function addStyle(css: string) {
      const style = document.createElement("style")
      style.textContent = css
      document.head.appendChild(style)
      return style
    }

    it("returns the markup without scripts and the CSS that styles it", async () => {
      const style = addStyle(`
      .card { color: red; }
      .unused { color: blue; }
      button:hover { color: green; }
      @media (min-width: 1px) { .card { padding: 4px; } .gone { margin: 0; } }
      @media (min-width: 2px) { .gone { margin: 0; } }
      .hero { background: url(/img/hero.png); }
    `)
      document.documentElement.className = "dark"
      document.body.innerHTML = `
      <div class="card hero">Hi<script>alert(1)</script></div>
      <button>Go</button>`
      try {
        const snap = (await query("getPageSnapshot", {})) as Snapshot
        expect(snap.htmlAttributes).toBe('class="dark"')
        expect(snap.markup).toContain('<div class="card hero">Hi</div>')
        expect(snap.markup).not.toContain("<script")
        expect(snap.markup).not.toContain("<style")
        expect(snap.css).toContain(".card")
        expect(snap.css).toContain("button:hover")
        expect(snap.css).not.toContain(".unused")
        expect(snap.css).not.toContain(".gone")
        expect(snap.css).toMatch(/@media \(min-width: 1px\)/)
        expect(snap.css).not.toMatch(/@media \(min-width: 2px\)/)
        expect(snap.css).toContain(`url("${location.origin}/img/hero.png")`)
      } finally {
        style.remove()
        document.documentElement.className = ""
      }
    })

    it("scopes to one element, keeping only the rules under it", async () => {
      const style = addStyle(
        `#pay { color: red; } main li { color: blue; } body { font-family: serif; }`
      )
      try {
        const snap = (await query("getPageSnapshot", {
          selector: "#pay",
        })) as Snapshot
        expect(snap.markup).toBe('<button id="pay">Pay now</button>')
        expect(snap.css).toContain("#pay")
        expect(snap.css).not.toContain("li")
        // The body's rules still reach the element through inheritance.
        expect(snap.css).toContain("font-family: serif")
      } finally {
        style.remove()
      }
    })

    it("returns null when the selector matches nothing", async () => {
      await expect(
        query("getPageSnapshot", { selector: "#nope" })
      ).resolves.toBeNull()
    })
  })
})

describe("bridge headless read", () => {
  it("answers the headless read script, where the page is its own parent", async () => {
    const run = new Function(
      `return (async () => {${pageSnapshotScript("#pay")}})()`
    ) as () => Promise<string>
    const snap = JSON.parse(await run()) as Snapshot
    expect(snap.markup).toBe('<button id="pay">Pay now</button>')
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

describe("bridge Space with the pointer outside the page", () => {
  const posted: string[] = []
  function onMessage(e: MessageEvent) {
    const type = e.data?.type
    if (type === "screenplay:space-down" || type === "screenplay:space-up")
      posted.push(type)
  }
  const press = (type: "keydown" | "keyup", init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent(type, {
      key: " ",
      bubbles: true,
      cancelable: true,
      ...init,
    })
    ;(document.activeElement ?? document.body).dispatchEvent(e)
    return e
  }
  // postMessage delivers asynchronously.
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const leave = () =>
    window.dispatchEvent(new MouseEvent("mouseout", { relatedTarget: null }))
  const enter = () =>
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))

  beforeEach(() => {
    posted.length = 0
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      enter()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    }
  })

  it("hands Space to the canvas, and keeps it from the page", async () => {
    leave()
    const down = press("keydown")
    const up = press("keyup")
    await flush()
    expect(down.defaultPrevented).toBe(true)
    expect(up.defaultPrevented).toBe(true)
    expect(posted).toEqual(["screenplay:space-down", "screenplay:space-up"])
  })

  it("leaves Space to the page while the pointer is over it", async () => {
    enter()
    const down = press("keydown")
    press("keyup")
    await flush()
    expect(down.defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })

  it("leaves Space to a text field being typed in", async () => {
    document.body.innerHTML = `<input id="q" />`
    document.getElementById("q")!.focus()
    leave()
    const down = press("keydown")
    press("keyup")
    await flush()
    expect(down.defaultPrevented).toBe(false)
    expect(posted).toEqual([])
  })
})

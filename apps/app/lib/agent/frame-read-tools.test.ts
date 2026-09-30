import { describe, expect, it, vi } from "vitest"

import {
  buildFrameReadTools,
  FRAME_HTML_LIMITS,
  renderFrameHtml,
  type FrameReadPorts,
  type FrameReadScope,
} from "@/lib/agent/frame-read-tools"
import type { PageSnapshot } from "@/lib/sandbox-bridge/page-snapshot"
import { baseBranch, baseLayer, makeHarness } from "@/test/canvas/harness"

/**
 * The frame reads against a bare Room doc, with fake capture and page-read
 * ports standing in for the Thumbnail Capturer's browser.
 */
function setup(overrides: Partial<FrameReadPorts> = {}) {
  const { collections } = makeHarness()
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", {
      title: "Fix sign-in",
      previewDomain: "https://ws-1.preview.test",
    })
  )
  collections.branches.set(
    "ws-2",
    baseBranch("ws-2", {
      title: "Pricing",
      previewDomain: "https://ws-2.preview.test",
    })
  )
  collections.iframeLayers.set(
    "frame-1",
    baseLayer("frame-1", {
      branchId: "ws-1",
      route: "/login",
      width: 1280,
      height: 800,
    })
  )
  collections.iframeLayers.set(
    "frame-2",
    baseLayer("frame-2", { branchId: "ws-2", route: "/", width: 390 })
  )
  const ports = {
    readDoc: async <T>(fn: (c: typeof collections) => T | Promise<T>) =>
      fn(collections),
    captureFrame: vi.fn(async () => ({
      data: Buffer.from("png"),
      mediaType: "image/webp",
    })),
    readFrameCapture: vi.fn(async () => null),
    readFramePage: vi.fn(async (): Promise<PageSnapshot | null> => snapshot()),
    ...overrides,
  }
  return { collections, ports }
}

function snapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://ws-1.preview.test/login",
    title: "Sign in",
    htmlAttributes: 'class="dark" lang="en"',
    bodyAttributes: "",
    markup: '<main><button class="btn">Sign in</button></main>',
    css: ".btn { color: red; }",
    stylesheetLinks: [],
    ...overrides,
  }
}

async function run(
  ports: ReturnType<typeof setup>["ports"],
  scope: FrameReadScope,
  name: "view_frame" | "read_frame_html",
  input: Record<string, unknown>
): Promise<unknown> {
  const tools = buildFrameReadTools(ports, scope)
  return tools[name].execute!(input as never, {
    toolCallId: "t1",
    messages: [],
  })
}

const own: FrameReadScope = { kind: "chat", sandboxName: "sandbox-ws-1" }
const doc: FrameReadScope = { kind: "chat" }
const canvas: FrameReadScope = { kind: "canvas" }

describe("read_frame_html", () => {
  it("reads the live page and returns it as one self-contained document", async () => {
    const { ports } = setup()

    const out = await run(ports, canvas, "read_frame_html", {
      frameId: "frame-1",
    })

    expect(ports.readFramePage).toHaveBeenCalledWith(
      {
        url: "https://ws-1.preview.test/login",
        width: 1280,
        height: 800,
        sandboxName: "sandbox-ws-1",
      },
      undefined
    )
    expect(out).toBe(
      [
        'Page HTML of frame [frame-1] (/login in Workspace "Fix sign-in"), read live at 1280×800.',
        "",
        "<!doctype html>",
        '<html class="dark" lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<base href="https://ws-1.preview.test/login">',
        "<title>Sign in</title>",
        "<style>\n.btn { color: red; }\n</style>",
        "</head>",
        "<body>",
        '<main><button class="btn">Sign in</button></main>',
        "</body>",
        "</html>",
      ].join("\n")
    )
  })

  it("passes a selector through and says when it matches nothing", async () => {
    const { ports } = setup({ readFramePage: vi.fn(async () => null) })

    const out = await run(ports, canvas, "read_frame_html", {
      frameId: "frame-1",
      selector: "#pricing",
    })

    expect(ports.readFramePage).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-1.preview.test/login" }),
      "#pricing"
    )
    expect(out).toBe(
      'Nothing in the page of frame [frame-1] (/login in Workspace "Fix sign-in") matches the selector #pricing.'
    )
  })

  it("says why when the page can't be read", async () => {
    const { collections, ports } = setup({
      readFramePage: vi.fn(async () => {
        throw new Error("the page has no Sandbox Bridge")
      }),
    })
    expect(
      await run(ports, canvas, "read_frame_html", { frameId: "frame-1" })
    ).toBe(
      'Couldn\'t read the page in frame [frame-1] (/login in Workspace "Fix sign-in"): the page has no Sandbox Bridge'
    )

    collections.branches.update("ws-1", { previewDomain: "" })
    expect(
      await run(ports, canvas, "read_frame_html", { frameId: "frame-1" })
    ).toBe(
      'Can\'t read the page in frame [frame-1] (/login in Workspace "Fix sign-in"): its Workspace has no running preview.'
    )
  })
})

describe("a Workspace agent's frame reads", () => {
  it("reads its only frame when no frame id is given", async () => {
    const { ports } = setup()

    await run(ports, own, "read_frame_html", {})
    await run(ports, own, "view_frame", {})

    expect(ports.readFramePage).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-1.preview.test/login" }),
      undefined
    )
    expect(ports.captureFrame).toHaveBeenCalledWith({
      url: "https://ws-1.preview.test/login",
      width: 1280,
      height: 800,
    })
  })

  it("lists its frames when it has several", async () => {
    const { collections, ports } = setup()
    collections.iframeLayers.set(
      "frame-3",
      baseLayer("frame-3", {
        branchId: "ws-1",
        route: "/signup",
        width: 390,
        height: 844,
      })
    )

    const out = await run(ports, own, "read_frame_html", {})

    expect(out).toBe(
      [
        "Your Workspace has several frames; pass the frameId of one:",
        '- frame-1: /login in Workspace "Fix sign-in" at 1280×800',
        '- frame-3: /signup in Workspace "Fix sign-in" at 390×844',
        '- frame-2: / in Workspace "Pricing" at 390×300',
      ].join("\n")
    )
    expect(ports.readFramePage).not.toHaveBeenCalled()
  })

  it("reads another Workspace's frame by id", async () => {
    const { ports } = setup()

    await run(ports, own, "read_frame_html", { frameId: "frame-2" })
    await run(ports, own, "view_frame", { frameId: "frame-2" })

    expect(ports.readFramePage).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-2.preview.test/" }),
      undefined
    )
    expect(ports.captureFrame).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-2.preview.test/" })
    )
  })

  it("lists the canvas's frames when its Workspace has none", async () => {
    const { collections, ports } = setup()
    collections.iframeLayers.delete("frame-1")
    collections.iframeLayers.set(
      "frame-3",
      baseLayer("frame-3", { branchId: "ws-2", route: "/about" })
    )

    expect(await run(ports, own, "read_frame_html", {})).toBe(
      [
        "Pass the frameId of the frame to read:",
        '- frame-2: / in Workspace "Pricing" at 390×300',
        '- frame-3: /about in Workspace "Pricing" at 400×300',
      ].join("\n")
    )
  })

  it("the Coordinator reads any frame", async () => {
    const { ports } = setup()

    await run(ports, canvas, "read_frame_html", { frameId: "frame-2" })

    expect(ports.readFramePage).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-2.preview.test/" }),
      undefined
    )
  })
})

describe("a document chat's frame reads", () => {
  it("reads the canvas's only frame when no frame id is given", async () => {
    const { collections, ports } = setup()
    collections.iframeLayers.delete("frame-1")

    await run(ports, doc, "view_frame", {})

    expect(ports.captureFrame).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://ws-2.preview.test/" })
    )
  })

  it("says so when the canvas has no frames", async () => {
    const { collections, ports } = setup()
    collections.iframeLayers.delete("frame-1")
    collections.iframeLayers.delete("frame-2")

    expect(await run(ports, doc, "read_frame_html", {})).toBe(
      "There are no frames on the canvas."
    )
  })
})

describe("renderFrameHtml", () => {
  it("caps the markup and the CSS apart and says what it cut", () => {
    const css = Array.from(
      { length: 5_000 },
      (_, i) => `.rule-${i} { color: red; }`
    ).join("\n")
    const markup = "<p>x</p>".repeat(10_000)

    const out = renderFrameHtml(
      snapshot({
        markup,
        css,
        stylesheetLinks: ["https://fonts.example/css?a=1&b=2"],
      }),
      { caption: "Page HTML." }
    )
    const lines = out.split("\n")

    expect(lines[0]).toBe("Page HTML.")
    expect(lines[1]).toBe(
      `The markup was cut after ${FRAME_HTML_LIMITS.markup} of ${markup.length} characters; pass a selector to read one part of the page.`
    )
    expect(lines[2]).toMatch(
      new RegExp(`^The CSS was cut after \\d+ of ${css.length} characters\\.$`)
    )
    expect(out).toContain(
      '<link rel="stylesheet" href="https://fonts.example/css?a=1&amp;b=2">'
    )
    // The CSS is cut between rules, never inside one.
    const style = out.slice(
      out.indexOf("<style>\n") + 8,
      out.indexOf("\n</style>")
    )
    expect(style.length).toBeLessThanOrEqual(FRAME_HTML_LIMITS.css)
    expect(style.endsWith("{ color: red; }")).toBe(true)
    expect(out.endsWith("</body>\n</html>")).toBe(true)
  })
})

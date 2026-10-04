import { describe, expect, it, vi } from "vitest"

import { isImageToolOutput } from "@/lib/agent/image-output"
import {
  buildPageScreenshotTools,
  documentImage,
  pngPath,
  type PageScreenshotPorts,
  type PageScreenshotScope,
} from "@/lib/agent/page-screenshot-tools"
import type { Files } from "@/lib/files/files"
import { baseBranch, makeHarness } from "@/test/canvas/harness"

/**
 * `screenshot_page` against a bare Room doc, with a fake capture port
 * standing in for the Thumbnail Capturer's browser and fake saved files.
 */
function setup(overrides: Partial<PageScreenshotPorts> = {}) {
  const { collections } = makeHarness()
  collections.branches.set(
    "ws-1",
    baseBranch("ws-1", {
      title: "Fix sign-in",
      sandboxName: "sandbox-ws-1",
      previewDomain: "https://ws-1.preview.test",
    })
  )
  collections.branches.set(
    "ws-2",
    baseBranch("ws-2", {
      title: "Pricing",
      sandboxName: "sandbox-ws-2",
      previewDomain: "https://ws-2.preview.test/",
    })
  )
  const ports = {
    readDoc: async <T>(fn: (c: typeof collections) => T | Promise<T>) =>
      fn(collections),
    capturePage: vi.fn(async (req: { width: number; height: number }) => ({
      png: Buffer.from("png"),
      width: req.width,
      height: req.height,
    })),
    toModelImage: vi.fn(async () => ({
      data: Buffer.from("webp"),
      mediaType: "image/webp",
    })),
    ...overrides,
  }
  const save = vi.fn(async (input: { path: string; bytes: Uint8Array }) => ({
    ok: true as const,
    value: {
      entry: {
        path: input.path,
        size: input.bytes.byteLength,
        mediaType: "image/png",
      },
      replaced: false,
    },
  }))
  const canvas = { save } as unknown as Files
  return { collections, ports, save, canvas }
}

async function run(
  ctx: ReturnType<typeof setup>,
  scope: PageScreenshotScope,
  input: Record<string, unknown>,
  account: Files | null = null
): Promise<unknown> {
  const tools = buildPageScreenshotTools(
    ctx.ports,
    { canvas: ctx.canvas, account, chatId: "chat-1" },
    scope
  )
  return tools.screenshot_page.execute!(input as never, {
    toolCallId: "t1",
    messages: [],
    context: {},
  })
}

const own: PageScreenshotScope = { sandboxName: "sandbox-ws-1" }

describe("screenshot_page", () => {
  it("renders a route of the chat’s own Workspace at the default size", async () => {
    const ctx = setup()
    const out = await run(ctx, own, { route: "/login" })
    expect(ctx.ports.capturePage).toHaveBeenCalledWith({
      url: "https://ws-1.preview.test/login",
      width: 1280,
      height: 800,
      fullPage: false,
    })
    expect(isImageToolOutput(out)).toBe(true)
    expect((out as { caption: string }).caption).toBe(
      'Screenshot of /login in Workspace "Fix sign-in", at 1280×800.'
    )
  })

  it("takes another Workspace’s route, at a phone width, the whole page", async () => {
    const ctx = setup()
    await run(ctx, own, {
      workspaceId: "ws-2",
      route: "pricing",
      width: 390,
      fullPage: true,
    })
    expect(ctx.ports.capturePage).toHaveBeenCalledWith({
      url: "https://ws-2.preview.test/pricing",
      width: 390,
      height: 800,
      fullPage: true,
    })
  })

  it("asks which Workspace when a chat with none of its own leaves it out", async () => {
    const ctx = setup()
    const out = await run(ctx, {}, { route: "/" })
    expect(out).toContain("Pass the workspaceId")
    expect(out).toContain('- ws-2: "Pricing"')
    expect(ctx.ports.capturePage).not.toHaveBeenCalled()
  })

  it("renders a public URL", async () => {
    const ctx = setup()
    await run(ctx, {}, { url: "https://example.com/a?b=1" })
    expect(ctx.ports.capturePage).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/a?b=1" })
    )
  })

  it("refuses a URL that isn’t http(s), and a route that is a URL", async () => {
    const ctx = setup()
    expect(await run(ctx, own, { url: "file:///etc/passwd" })).toContain(
      "Only http(s) pages"
    )
    expect(await run(ctx, own, { route: "https://example.com" })).toContain(
      "pass a full address as `url`"
    )
    expect(
      await run(ctx, own, { url: "https://example.com", route: "/" })
    ).toContain("not both")
    expect(ctx.ports.capturePage).not.toHaveBeenCalled()
  })

  it("saves the PNG to canvas files when asked", async () => {
    const ctx = setup()
    const out = await run(ctx, own, { saveAs: "shots/login" })
    expect(ctx.save).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "shots/login.png",
        mediaType: "image/png",
        author: { addedBy: "agent", addedById: "chat-1" },
      })
    )
    expect((out as { caption: string }).caption).toContain(
      "Saved shots/login.png in canvas files"
    )
    expect((out as { caption: string }).caption).toContain(
      'put this on its own line: ![Screenshot of / in Workspace "Fix sign-in"](shots/login.png)'
    )
  })

  it("refuses account files on a turn nobody sent, before rendering", async () => {
    const ctx = setup()
    const out = await run(ctx, own, { saveAs: "a.png", scope: "account" })
    expect(out).toContain("no account files")
    expect(ctx.ports.capturePage).not.toHaveBeenCalled()
  })

  it("says when the render fails", async () => {
    const ctx = setup({
      capturePage: vi.fn(async () => {
        throw new Error("only public pages can be screenshot here")
      }),
    })
    expect(await run(ctx, {}, { url: "http://10.0.0.1/" })).toBe(
      "Couldn’t take a screenshot of http://10.0.0.1/: only public pages can be screenshot here"
    )
  })

  it("says when a whole page was cut", async () => {
    const ctx = setup({
      capturePage: vi.fn(async () => ({
        png: Buffer.from("png"),
        width: 1280,
        height: 12_000,
        cut: true,
      })),
    })
    const out = await run(ctx, own, { fullPage: true })
    expect((out as { caption: string }).caption).toContain("its bottom was cut")
  })
})

describe("documentImage", () => {
  it("wraps a path with spaces or parentheses and drops brackets from the alt", () => {
    expect(documentImage("a/b.png", "B")).toBe("![B](a/b.png)")
    expect(documentImage("a/b c (2).png", "[x] y")).toBe(
      "![x y](<a/b c (2).png>)"
    )
  })
})

describe("pngPath", () => {
  it("ends the path in .png", () => {
    expect(pngPath("a/b.png")).toBe("a/b.png")
    expect(pngPath("a/b.PNG")).toBe("a/b.PNG")
    expect(pngPath("a/b")).toBe("a/b.png")
    expect(pngPath("a/b.jpg")).toBe("a/b.png")
  })
})

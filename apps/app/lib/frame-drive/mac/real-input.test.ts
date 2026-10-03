import { describe, expect, it } from "vitest"

import type { DriveGesture } from "@/lib/frame-drive/contract"
import type { PageAsk, PageLocated } from "@/lib/frame-drive/canvas/protocol"
import {
  editAction,
  runRealInput,
  type NativeEvent,
  type NativeInput,
  type RealInputDeps,
} from "@/lib/frame-drive/mac/real-input"

/**
 * How a gesture becomes real input on the Mac (#1385), against a stand-in
 * canvas and shell. The browser test (`mac-backend.browser.test.ts`) plays the
 * same gestures as real input in Chrome.
 */

const SAVE: PageLocated = {
  target: { selector: "#save", tag: "button", label: "Save" },
  x: 40,
  y: 30,
}

function harness(
  opts: {
    located?: PageLocated | null | "taken"
    window?: { x: number; y: number } | null
    copies?: string | null
    takesFiles?: boolean
    fail?: "hold" | "send"
    taken?: PageAsk["kind"]
  } = {}
) {
  const asks: PageAsk[] = []
  const calls: string[] = []
  const sent: NativeEvent[] = []
  const native: NativeInput = {
    async send(events) {
      if (opts.fail === "send") throw new Error("shell gone")
      calls.push("send")
      sent.push(...events)
    },
    async holdClipboard(text) {
      if (opts.fail === "hold") throw new Error("no endpoint")
      calls.push(text === undefined ? "hold" : `hold:${text}`)
    },
    async releaseClipboard() {
      calls.push("release-clipboard")
      return opts.copies ?? null
    },
    async offerFiles(paths) {
      calls.push(`offer:${paths.join(",")}`)
    },
    async withdrawFiles() {
      calls.push("withdraw")
      return !!opts.takesFiles
    },
  }
  const deps: RealInputDeps = {
    native,
    clipboard: { text: null },
    wait: async () => {},
    files: async (paths) =>
      paths.every((p) => !p.startsWith(".."))
        ? paths.map((p) => `/ws/${p}`)
        : null,
    page: (async (ask: PageAsk) => {
      asks.push(ask)
      if (opts.taken === ask.kind) return "taken"
      switch (ask.kind) {
        case "locate":
          return opts.located === undefined ? SAVE : opts.located
        case "take":
          return {
            window:
              opts.window === undefined ? { x: 140, y: 230 } : opts.window,
          }
        case "state":
          return { path: "/settings", value: ask.selector ? "Ada" : undefined }
        default:
          return null
      }
    }) as RealInputDeps["page"],
  }
  const run = (op: DriveGesture) => runRealInput(op, deps)
  return { run, asks, calls, sent, deps }
}

describe("real input on the Mac", () => {
  it("clicks at the frame's point in the window, and hands the input back", async () => {
    const h = harness()
    const result = await h.run({ op: "click", target: { text: "Save" } })
    expect(result).toEqual({
      status: "done",
      value: { op: "click", target: SAVE.target, path: "/settings" },
    })
    expect(h.sent).toEqual([
      { kind: "move", x: 140, y: 230 },
      { kind: "down", x: 140, y: 230, clickCount: 1 },
      { kind: "up", x: 140, y: 230, clickCount: 1 },
    ])
    // The frame takes the pointer at the page's point, and gives it back.
    expect(h.asks).toContainEqual({ kind: "take", at: { x: 40, y: 30 } })
    expect(h.asks.at(-1)).toEqual({ kind: "release" })
  })

  it("keeps the person's clipboard aside, and returns what a click copied", async () => {
    const h = harness({ copies: "https://example.com/invite" })
    const result = await h.run({ op: "click", target: { text: "Copy link" } })
    expect(result).toMatchObject({
      status: "done",
      value: { copied: "https://example.com/invite" },
    })
    expect(h.calls).toEqual(["hold", "send", "release-clipboard"])
    // The agent pastes its own copy later.
    expect(h.deps.clipboard.text).toBe("https://example.com/invite")
  })

  it("pastes the agent's own copy, never the person's clipboard", async () => {
    const h = harness()
    h.deps.clipboard.text = "agent text"
    await h.run({ op: "key", key: "v", modifiers: { metaKey: true } })
    expect(h.calls).toEqual(["hold:agent text", "send", "release-clipboard"])
    expect(h.sent).toEqual([{ kind: "edit", action: "paste" }])

    const fresh = harness()
    await fresh.run({ op: "key", key: "v", modifiers: { metaKey: true } })
    expect(fresh.calls[0]).toBe("hold:")
  })

  it("copies with ⌘C as the Edit menu would, and reports it", async () => {
    const h = harness({ copies: "selected" })
    const result = await h.run({
      op: "key",
      key: "c",
      modifiers: { metaKey: true },
    })
    expect(h.sent).toEqual([{ kind: "edit", action: "copy" }])
    expect(result).toMatchObject({ value: { copied: "selected" } })
  })

  it("answers a file picker with Workspace files, with no panel", async () => {
    const h = harness({
      located: {
        ...SAVE,
        file: true,
        target: { selector: "#upload", tag: "input", label: "Upload" },
      },
      takesFiles: true,
    })
    const result = await h.run({
      op: "click",
      target: { selector: "#upload" },
      files: ["fixtures/logo.png"],
    })
    expect(h.calls[0]).toBe("offer:/ws/fixtures/logo.png")
    expect(h.calls).toContain("withdraw")
    expect(result).toMatchObject({
      status: "done",
      value: { picked: ["fixtures/logo.png"] },
    })
  })

  it("names the file-picker gap without files, or with one outside the Workspace", async () => {
    const located = { ...SAVE, file: true }
    for (const files of [undefined, ["../secrets.env"]]) {
      const h = harness({ located })
      expect(
        await h.run({ op: "click", target: { selector: "#upload" }, files })
      ).toMatchObject({ status: "gap", gap: "file-picker" })
      expect(h.sent).toEqual([])
      expect(h.calls).toEqual([])
    }
  })

  it("leaves a native popup's gap as it is", async () => {
    const h = harness({ located: { ...SAVE, popup: "native-select" } })
    expect(
      await h.run({ op: "click", target: { selector: "#size" } })
    ).toMatchObject({ status: "gap", gap: "native-select" })
    expect(h.sent).toEqual([])
  })

  it("hands a click to the bridge when the frame can't be hit there", async () => {
    const h = harness({ window: null })
    expect(await h.run({ op: "click", target: { text: "Save" } })).toBeNull()
    expect(h.sent).toEqual([])
    expect(h.asks.at(-1)).toEqual({ kind: "release" })
  })

  it("hands a gesture to the bridge when the shell can't take it", async () => {
    const h = harness({ fail: "hold" })
    expect(await h.run({ op: "click", target: { text: "Save" } })).toBeNull()
  })

  it("fails a gesture whose input already landed, rather than playing it twice", async () => {
    const h = harness({ fail: "send" })
    expect(
      await h.run({ op: "type", target: { selector: "#name" }, text: "Ada" })
    ).toMatchObject({ status: "failed" })
  })

  it("types real keys into the field the bridge readied", async () => {
    const h = harness()
    const result = await h.run({
      op: "type",
      target: { selector: "#name" },
      text: "Hi\n",
      replace: true,
    })
    expect(h.asks.slice(0, 2)).toEqual([
      { kind: "take" },
      {
        kind: "locate",
        target: { selector: "#name" },
        focus: "field",
        replace: true,
        show: false,
      },
    ])
    expect(h.sent).toEqual([
      { kind: "key", key: "H", text: "H" },
      { kind: "key", key: "i", text: "i" },
      { kind: "key", key: "Enter", text: "\r" },
    ])
    expect(result).toMatchObject({ status: "done", value: { value: "Ada" } })
  })

  it("clears a field when it replaces its text with nothing", async () => {
    const h = harness()
    await h.run({
      op: "type",
      target: { selector: "#name" },
      text: "",
      replace: true,
    })
    expect(h.sent).toEqual([{ kind: "key", key: "Backspace" }])
  })

  it("says when the target isn't a text field", async () => {
    const h = harness({ located: { ...SAVE, field: false } })
    expect(
      await h.run({ op: "type", target: { selector: "#save" }, text: "x" })
    ).toMatchObject({ status: "failed" })
  })

  it("presses Tab and shortcuts as real keys", async () => {
    const h = harness()
    await h.run({ op: "key", key: "Tab" })
    await h.run({ op: "key", key: "k", modifiers: { metaKey: true } })
    await h.run({ op: "key", key: "a", target: { selector: "#name" } })
    expect(h.sent).toEqual([
      { kind: "key", key: "Tab", text: undefined, modifiers: undefined },
      { kind: "key", key: "k", text: undefined, modifiers: { metaKey: true } },
      { kind: "key", key: "a", text: "a", modifiers: undefined },
    ])
  })

  it("rests the real pointer on a hover target", async () => {
    const h = harness()
    expect(
      await h.run({ op: "hover", target: { text: "Info" } })
    ).toMatchObject({ status: "done" })
    expect(h.sent).toEqual([{ kind: "move", x: 140, y: 230 }])
  })

  it("stops when someone took the frame", async () => {
    const h = harness({ taken: "take" })
    expect(await h.run({ op: "click", target: { text: "Save" } })).toEqual({
      status: "taken",
    })
    expect(h.sent).toEqual([])
  })

  it("glides the agent's cursor first at show pace", async () => {
    const h = harness()
    await h.run({ op: "click", target: { text: "Save" }, pace: "show" })
    const cursor = h.asks.filter((a) => a.kind === "cursor")
    expect(cursor).toEqual([
      { kind: "cursor", what: { to: { x: 40, y: 30 } } },
      { kind: "cursor", what: { press: true } },
      { kind: "cursor", what: { linger: true } },
    ])
  })

  it("leaves scrolls, selects and drags to the bridge", async () => {
    const h = harness()
    expect(await h.run({ op: "scroll", dy: 100 })).toBeNull()
    expect(
      await h.run({ op: "select", target: { selector: "#s" }, value: "l" })
    ).toBeNull()
    expect(h.sent).toEqual([])
  })
})

describe("editAction", () => {
  it("runs ⌘C, ⌘X, ⌘V and ⌘A as editing commands, and nothing else", () => {
    expect(editAction("c", { metaKey: true })).toBe("copy")
    expect(editAction("V", { metaKey: true })).toBe("paste")
    expect(editAction("c", { metaKey: true, shiftKey: true })).toBeNull()
    expect(editAction("c", undefined)).toBeNull()
    expect(editAction("k", { metaKey: true })).toBeNull()
  })
})

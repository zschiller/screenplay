import { describe, expect, it } from "vitest"

import type { Placement } from "@/lib/comment-anchor"
import type { ThreadWithComments } from "@/lib/comments"
import { filterThreads, groupThreads } from "@/lib/comments-panel"

let seq = 0
function thread(
  over: Partial<ThreadWithComments> & { at?: number; authors?: string[] } = {}
): ThreadWithComments {
  const { at = 0, authors = ["u1"], ...rest } = over
  const id = rest.id ?? `t${++seq}`
  return {
    id,
    roomId: "room",
    x: 0,
    y: 0,
    iframeLayerId: "frame-a",
    selector: null,
    offsetX: null,
    offsetY: null,
    workspaceId: null,
    route: "/checkout",
    anchor: null,
    viewportWidth: null,
    viewportHeight: null,
    snapshot: null,
    documentId: null,
    anchorStart: null,
    anchorEnd: null,
    quotedText: null,
    branch: null,
    resolved: false,
    resolvedAt: null,
    createdBy: authors[0]!,
    createdAt: at,
    updatedAt: at,
    unread: false,
    comments: authors.map((authorId, i) => ({
      id: `${id}-c${i}`,
      threadId: id,
      authorId,
      authorName: authorId,
      authorAvatar: null,
      body: "hi",
      createdAt: at + i,
      editedAt: null,
    })),
    ...rest,
  }
}

const describeLayer = (id: string) =>
  (
    ({
      "frame-a": { title: "Mobile checkout" },
      "frame-b": { title: "Cart" },
      doc: { title: "Brief" },
    }) as Record<string, { title: string }>
  )[id]

describe("filterThreads", () => {
  const open = thread({ id: "open" })
  const unread = thread({ id: "unread", unread: true })
  const replied = thread({ id: "replied", authors: ["u2", "me"] })
  const resolved = thread({ id: "resolved", resolved: true, unread: true })
  const all = [open, unread, replied, resolved]
  const ids = (ts: ThreadWithComments[]) => ts.map((t) => t.id)

  it("splits open from resolved", () => {
    expect(ids(filterThreads(all, "open", "me"))).toEqual([
      "open",
      "unread",
      "replied",
    ])
    expect(ids(filterThreads(all, "resolved", "me"))).toEqual(["resolved"])
  })

  it("counts a thread as mine when I started or replied to it", () => {
    expect(ids(filterThreads(all, "mine", "me"))).toEqual(["replied"])
    expect(filterThreads(all, "mine", null)).toEqual([])
  })

  it("lists only open unread threads under Unread", () => {
    expect(ids(filterThreads(all, "unread", "me"))).toEqual(["unread"])
  })
})

describe("groupThreads", () => {
  it("groups by frame and route, most recent first, detached last", () => {
    const a1 = thread({ id: "a1", at: 10 })
    const a2 = thread({ id: "a2", at: 30 })
    const cart = thread({ id: "cart", at: 20, route: "/cart" })
    const b = thread({ id: "b", at: 5, iframeLayerId: "frame-b", route: "/" })
    const gone = thread({ id: "gone", at: 50 })
    const placements = new Map<string, Placement>([
      ["cart", { kind: "offRoute", frameId: "frame-a", route: "/cart" }],
      ["gone", { kind: "detached", reason: "element" }],
    ])
    const groups = groupThreads(
      [a1, a2, cart, b, gone],
      placements,
      describeLayer
    )
    expect(
      groups.map((g) => [g.title, g.route, g.threads.map((t) => t.id)])
    ).toEqual([
      ["Mobile checkout", "/checkout", ["a2", "a1"]],
      ["Mobile checkout", "/cart", ["cart"]],
      ["Cart", "/", ["b"]],
      [null, null, ["gone"]],
    ])
    expect(groups.at(-1)?.detached).toBe(true)
  })

  it("names documents without a route, and deleted layers", () => {
    const doc = thread({ id: "doc", documentId: "doc", iframeLayerId: null })
    const lost = thread({
      id: "lost",
      iframeLayerId: "frame-x",
      resolved: true,
    })
    const groups = groupThreads([doc, lost], new Map(), describeLayer)
    expect(groups.map((g) => [g.title, g.route])).toEqual([
      ["Brief", null],
      ["Deleted frame", "/checkout"],
    ])
  })
})

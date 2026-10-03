// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CommentRecord, ThreadWithComments } from "@/lib/comments"

const actions = vi.hoisted(() => ({
  listThreadsAction: vi.fn(),
  createThreadAction: vi.fn(),
  appendCommentAction: vi.fn(),
  editCommentAction: vi.fn(),
  deleteCommentAction: vi.fn(),
  deleteThreadAction: vi.fn(),
  setThreadResolvedAction: vi.fn(),
  markThreadReadAction: vi.fn(),
  markThreadUnreadAction: vi.fn(),
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))

vi.mock("@/lib/comments-actions", () => actions)
vi.mock("sonner", () => ({ toast }))
vi.mock("@/lib/auth-client", () => ({
  useAppSession: () => ({
    data: { user: { id: "u1", name: "Ada", image: null } },
  }),
}))
vi.mock("@/lib/yjs/react", () => ({
  useCommentsRevision: () => 0,
  useCommentsReadRevision: () => 0,
}))

import { useCommentThreads } from "./use-comment-threads"

function comment(id: string, body: string): CommentRecord {
  return {
    id,
    threadId: "t1",
    authorId: "u1",
    authorName: "Ada",
    authorAvatar: null,
    body,
    fromAgent: false,
    createdAt: 1,
    editedAt: null,
  }
}

function thread(
  id: string,
  comments: CommentRecord[],
  unread = false
): ThreadWithComments {
  return {
    id,
    roomId: "r1",
    x: 0,
    y: 0,
    iframeLayerId: null,
    selector: null,
    offsetX: null,
    offsetY: null,
    workspaceId: null,
    route: null,
    anchor: null,
    viewportWidth: null,
    viewportHeight: null,
    snapshot: null,
    documentId: null,
    anchorStart: null,
    anchorEnd: null,
    quotedText: null,
    agentStatus: null,
    agentCommit: null,
    resolved: false,
    resolvedAt: null,
    createdBy: "u1",
    createdAt: 1,
    updatedAt: 1,
    comments,
    unread,
  }
}

/** Settles a promise from the test, so a write can be seen mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const initial = [thread("t1", [comment("c1", "first")], true)]

async function setup() {
  actions.listThreadsAction.mockResolvedValue(initial)
  const hook = renderHook(() => useCommentThreads("r1", initial))
  await waitFor(() => expect(actions.listThreadsAction).toHaveBeenCalled())
  return hook
}

const bodies = (threads: ThreadWithComments[]) =>
  threads.find((t) => t.id === "t1")?.comments.map((c) => c.body)

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("createThread", () => {
  it("shows the saved thread without waiting for a refetch", async () => {
    const { result } = await setup()
    const saved = thread("t2", [comment("c2", "hello")])
    actions.createThreadAction.mockResolvedValue(saved)

    let returned: ThreadWithComments | null = null
    await act(async () => {
      returned = await result.current.createThread({
        x: 1,
        y: 2,
        body: "hello",
      })
    })

    expect(actions.createThreadAction).toHaveBeenCalledWith({
      roomId: "r1",
      x: 1,
      y: 2,
      body: "hello",
    })
    expect(returned).toBe(saved)
    expect(result.current.threads.map((t) => t.id)).toEqual(["t1", "t2"])
  })

  it("resolves null and says so when it fails", async () => {
    const { result } = await setup()
    actions.createThreadAction.mockRejectedValue(new Error("nope"))

    let returned: ThreadWithComments | null = null
    await act(async () => {
      returned = await result.current.createThread({ x: 1, y: 2, body: "hi" })
    })

    expect(returned).toBeNull()
    expect(result.current.threads.map((t) => t.id)).toEqual(["t1"])
    expect(toast.error).toHaveBeenCalledWith("Couldn’t post the comment")
  })
})

describe("reply", () => {
  it("shows the reply at once and keeps it once saved", async () => {
    const { result } = await setup()
    const save = deferred<CommentRecord>()
    actions.appendCommentAction.mockReturnValue(save.promise)

    let sent!: Promise<boolean>
    act(() => {
      sent = result.current.reply("t1", "second")
    })
    expect(bodies(result.current.threads)).toEqual(["first", "second"])
    const pending = result.current.threads[0]!.comments[1]!
    expect(pending.authorName).toBe("Ada")

    await act(async () => {
      save.resolve(comment("c2", "second"))
      expect(await sent).toBe(true)
    })
    expect(bodies(result.current.threads)).toEqual(["first", "second"])
    expect(result.current.threads[0]!.comments[1]!.id).toBe("c2")
  })

  it("takes the reply back out and says so when it fails", async () => {
    const { result } = await setup()
    const save = deferred<CommentRecord>()
    actions.appendCommentAction.mockReturnValue(save.promise)

    let sent!: Promise<boolean>
    act(() => {
      sent = result.current.reply("t1", "second")
    })
    expect(bodies(result.current.threads)).toEqual(["first", "second"])

    await act(async () => {
      save.reject(new Error("nope"))
      expect(await sent).toBe(false)
    })
    expect(bodies(result.current.threads)).toEqual(["first"])
    expect(toast.error).toHaveBeenCalledWith("Couldn’t send the reply")
  })
})

describe("editComment", () => {
  it("shows the new text at once", async () => {
    const { result } = await setup()
    const save = deferred<void>()
    actions.editCommentAction.mockReturnValue(save.promise)

    let saved!: Promise<boolean>
    act(() => {
      saved = result.current.editComment("c1", "changed")
    })
    expect(bodies(result.current.threads)).toEqual(["changed"])
    expect(result.current.threads[0]!.comments[0]!.editedAt).not.toBeNull()

    await act(async () => {
      save.resolve()
      expect(await saved).toBe(true)
    })
    expect(bodies(result.current.threads)).toEqual(["changed"])
  })

  it("puts the old text back and says so when it fails", async () => {
    const { result } = await setup()
    actions.editCommentAction.mockRejectedValue(new Error("nope"))

    await act(async () => {
      expect(await result.current.editComment("c1", "changed")).toBe(false)
    })

    expect(bodies(result.current.threads)).toEqual(["first"])
    expect(toast.error).toHaveBeenCalledWith("Couldn’t save the comment")
  })
})

describe("read state", () => {
  it("marks a thread read at once", async () => {
    const { result } = await setup()
    actions.markThreadReadAction.mockReturnValue(new Promise(() => {}))

    act(() => result.current.markRead("t1"))

    expect(result.current.threads[0]!.unread).toBe(false)
    expect(actions.markThreadReadAction).toHaveBeenCalledWith("t1")
  })

  it("puts unread back and says so when marking read fails", async () => {
    const { result } = await setup()
    actions.markThreadReadAction.mockRejectedValue(new Error("nope"))

    await act(async () => result.current.markRead("t1"))

    expect(result.current.threads[0]!.unread).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("Couldn’t mark the thread read")
  })

  it("marks a thread unread, and rolls back when that fails", async () => {
    const { result } = await setup()
    actions.markThreadReadAction.mockResolvedValue(undefined)
    await act(async () => result.current.markRead("t1"))
    const save = deferred<void>()
    actions.markThreadUnreadAction.mockReturnValue(save.promise)

    act(() => result.current.markUnread("t1"))
    expect(result.current.threads[0]!.unread).toBe(true)

    await act(async () => save.reject(new Error("nope")))
    expect(result.current.threads[0]!.unread).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Couldn’t mark the thread unread")
  })
})

describe("setResolved", () => {
  it("rolls back and says so when it fails", async () => {
    const { result } = await setup()
    actions.setThreadResolvedAction.mockRejectedValue(new Error("nope"))

    await act(async () => result.current.setResolved("t1", true))

    expect(result.current.threads[0]!.resolved).toBe(false)
    expect(toast.error).toHaveBeenCalledWith("Couldn’t resolve the thread")
  })
})

describe("a failed load", () => {
  it("says so when nothing loaded, and Retry fetches again", async () => {
    actions.listThreadsAction.mockRejectedValueOnce(new Error("HTTP 500"))
    const { result } = renderHook(() => useCommentThreads("r1", undefined))
    await waitFor(() => expect(result.current.threadsFailed).toBe(true))
    expect(result.current.threadsLoaded).toBe(false)

    actions.listThreadsAction.mockResolvedValueOnce(initial)
    act(() => result.current.retryThreads())
    await waitFor(() => expect(result.current.threadsLoaded).toBe(true))
    expect(result.current.threadsFailed).toBe(false)
    expect(result.current.threads).toEqual(initial)
  })

  it("keeps the threads it has when a refetch fails", async () => {
    actions.listThreadsAction.mockRejectedValueOnce(new Error("HTTP 500"))
    const { result } = renderHook(() => useCommentThreads("r1", initial))
    await waitFor(() => expect(actions.listThreadsAction).toHaveBeenCalled())
    expect(result.current.threadsFailed).toBe(false)
    expect(result.current.threads).toEqual(initial)
  })
})

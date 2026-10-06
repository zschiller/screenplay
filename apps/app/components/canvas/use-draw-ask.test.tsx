// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ComposerSubmitPayload } from "@/components/agent/composer"
import type { CreateBranchOptions } from "@/components/canvas/use-branch-intake"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import type { BranchData, ChatSessionData, RepoData } from "@/lib/types"
import {
  baseBranch,
  baseChat,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"

const { toast } = vi.hoisted(() => ({ toast: { error: vi.fn() } }))
vi.mock("sonner", () => ({ toast }))

import {
  defaultFrameAnswerer,
  defaultNewWorkspaceRepoId,
  forDocument,
  forMockup,
  sizeHint,
  runningPreviews,
  withViewport,
  workspaceRoute,
} from "@/lib/draw-ask"

import { buildOutgoingTurn } from "@/lib/agent/outgoing-turn"
import { projectUserTurn } from "@/lib/agent/user-turn"

import { useDrawAsk } from "./use-draw-ask"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const payload = (text: string, model = "model-x") =>
  ({ text, model }) as ComposerSubmitPayload

/**
 * The module over a real room Y.Doc. The Workspace's chat, the chat store and
 * Branch Intake are fakes that record what they were handed; the fake create
 * makes the Branch and its chat the way Branch Intake does, in one batch, under
 * the chat id the module hands it. `naming` holds the create back, the way
 * Branch Intake waits on naming the Branch.
 */
function setup(
  opts: {
    repos?: RepoData[]
    agents?: BranchData[]
    chats?: ChatSessionData[]
    /** The Workspace chat a prompt lands in; none while it starts. */
    workspaceChat?: string
    selected?: { frames?: string[]; owned?: string[] }
    /** Resolves once the new Branch is named; until then nothing is created. */
    naming?: Promise<void>
    /** The Workspace the chat panel shows. */
    panel?: string
  } = {}
) {
  const { doc, ops, collections } = makeHarness()
  const repos = opts.repos ?? [baseRepo("repo-1")]
  const agents = opts.agents ?? [baseBranch("b1", { title: "Checkout" })]
  for (const a of agents) collections.branches.set(a.id, a)
  for (const c of opts.chats ?? []) collections.chatSessions.set(c.id, c)

  const sendPrompt = vi.fn(
    (_branchId: string, _message: string) => opts.workspaceChat
  )
  const sendMessage = vi.fn()
  const selectSketchChat = vi.fn()
  const setSelectedGroupIds = vi.fn()
  const setSelectedIframeLayerIds = vi.fn()
  const setSelectedDocumentLayerIds = vi.fn()
  const setEditingDocumentLayerId = vi.fn()
  const selectIframeLayer = vi.fn()
  const created: Array<{ branchId: string; chatId?: string }> = []
  const createBranch = vi.fn(
    async (
      repoId: string,
      specs: ComposerSpec[],
      createOpts?: CreateBranchOptions
    ) => {
      await opts.naming
      ops.batch(() => {
        const result = ops.createBranch({
          branch: {
            ...baseBranch("ignored", { repoId }),
            status: "creating",
          },
          chat: {
            id: createOpts?.chatId,
            label: "New",
            model: specs[0]!.model,
          },
          frameId: createOpts?.frameId,
        })
        created.push(result)
      })
    }
  )

  const hook = renderHook(() =>
    useDrawAsk({
      ops,
      repos,
      agents,
      iframeLayers: collections.iframeLayers.toArray(),
      ownedLayers: [
        ...collections.markdownLayers.toArray(),
        ...collections.mockupLayers.toArray(),
      ],
      chatSessions: collections.chatSessions.toArray(),
      selection: {
        current: () => ({
          iframeLayerIds: new Set(opts.selected?.frames ?? []),
          groupIds: new Set(),
          markdownLayerIds: new Set(opts.selected?.owned ?? []),
        }),
        selectIframeLayer,
      },
      setSelectedGroupIds,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      setEditingDocumentLayerId,
      sendPrompt,
      createBranch,
      addChatSession: (id, chat) => collections.chatSessions.set(id, chat),
      chatTarget: { selectSketchChat, selectedAgentId: opts.panel ?? null },
      sendMessage,
      roomId: "room-1",
    })
  )
  const drawFrame = () =>
    ops.createBlankFrame({ x: 40, y: 60 }, { width: 390, height: 844 })
  const onlyMockup = () => {
    const [mockup] = collections.mockupLayers.toArray()
    return mockup
  }
  return {
    doc,
    ops,
    collections,
    hook,
    drawFrame,
    onlyMockup,
    sendPrompt,
    sendMessage,
    selectSketchChat,
    setSelectedDocumentLayerIds,
    setEditingDocumentLayerId,
    selectIframeLayer,
    createBranch,
    created,
  }
}

const box = { x: 10, y: 20, width: 390, height: 600 }

describe("opening an ask", () => {
  it("opens a drawn frame’s ask with the selection’s Workspace answering", () => {
    const t = setup({ selected: { frames: ["f-old"] } })
    t.collections.iframeLayers.set("f-old", {
      id: "f-old",
      width: 400,
      height: 300,
      label: "Frame",
      iframeState: {},
      branchId: "b1",
    })
    const frameId = t.drawFrame()
    t.hook.rerender()

    act(() => t.hook.result.current.startFromFrame(frameId))

    expect(t.hook.result.current.open).toEqual({ kind: "frame", frameId })
    expect(t.hook.result.current.answerer).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("doesn’t open a frame’s ask with no Repo for a new chat", () => {
    const t = setup({ repos: [], agents: [] })
    const frameId = t.drawFrame()
    t.hook.rerender()

    act(() => t.hook.result.current.startFromFrame(frameId))

    expect(t.hook.result.current.open).toBeNull()
    expect(t.hook.result.current.startFrameChat).toBeUndefined()
  })

  it("answers a Mockup box with a new chat with no repository when there’s no Repo", () => {
    const t = setup({ repos: [], agents: [] })

    act(() => t.hook.result.current.startFromMockupBox(box))

    expect(t.hook.result.current.open).toEqual({ kind: "mockup", box })
    expect(t.hook.result.current.answerer).toEqual({ kind: "sketch" })
  })

  it("reopens an unanswered frame’s ask from Start a chat, with a new chat answering", () => {
    const t = setup()
    const frameId = t.drawFrame()
    t.hook.rerender()

    act(() => t.hook.result.current.startFrameChat?.(frameId))

    expect(t.selectIframeLayer).toHaveBeenCalledWith(frameId, false)
    expect(t.hook.result.current.open).toEqual({ kind: "frame", frameId })
    expect(t.hook.result.current.answerer).toEqual({ kind: "new-chat" })
  })

  it("offers the running previews, the chat panel’s first", () => {
    const t = setup({
      agents: [
        baseBranch("b1", { title: "Checkout", lastActivityAt: 30 }),
        baseBranch("b2", { title: "Cart", lastActivityAt: 10 }),
        baseBranch("b3", { title: "Stopped", devServerStoppedAt: 5 }),
      ],
      panel: "b2",
    })
    const frameId = t.drawFrame()
    t.hook.rerender()

    act(() => t.hook.result.current.startFromFrame(frameId))

    expect(t.hook.result.current.previews.map((b) => b.id)).toEqual([
      "b2",
      "b1",
    ])
  })

  it("offers no previews from Start a chat, or for a Mockup box", () => {
    const t = setup()
    const frameId = t.drawFrame()
    t.hook.rerender()

    act(() => t.hook.result.current.startFrameChat?.(frameId))
    expect(t.hook.result.current.previews).toEqual([])

    act(() => t.hook.result.current.startFromMockupBox(box))
    expect(t.hook.result.current.previews).toEqual([])
  })

  it("closes a frame’s ask once the frame shows a Workspace", () => {
    const t = setup()
    const frameId = t.drawFrame()
    t.hook.rerender()
    act(() => t.hook.result.current.startFromFrame(frameId))

    t.ops.assignBranch(frameId, "b1")
    t.hook.rerender()

    expect(t.hook.result.current.open).toBeNull()
  })

  it("closes, leaving a Mockup box behind as nothing", () => {
    const t = setup()
    act(() => t.hook.result.current.startFromMockupBox(box))

    act(() => t.hook.result.current.close())

    expect(t.hook.result.current.open).toBeNull()
    expect(t.collections.mockupLayers.toArray()).toHaveLength(0)
  })
})

describe("sending a frame’s ask", () => {
  function opened(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup(opts)
    const frameId = t.drawFrame()
    t.hook.rerender()
    act(() => t.hook.result.current.startFromFrame(frameId))
    return { ...t, frameId }
  }

  it("shows an existing Workspace in the frame and asks its chat", () => {
    const t = opened({ workspaceChat: "c1" })

    act(() =>
      t.hook.result.current.send(payload("A checkout page"), {
        kind: "workspace",
        branchId: "b1",
      })
    )

    expect(t.collections.iframeLayers.get(t.frameId)?.branchId).toBe("b1")
    expect(t.sendPrompt).toHaveBeenCalledWith(
      "b1",
      "A checkout page\n\n---\n\nDrawn box: the sender drew a frame on the canvas to ask this. It was drawn by hand at about 390 × 840, phone width, so take the size as a loose hint, not a spec."
    )
    expect(t.createBranch).not.toHaveBeenCalled()
    expect(t.hook.result.current.open).toBeNull()
  })

  it("starts a new chat shown in the frame", async () => {
    const t = opened()

    await act(async () =>
      t.hook.result.current.send(payload("A checkout page"), {
        kind: "new-chat",
      })
    )

    expect(t.createBranch).toHaveBeenCalledWith(
      "repo-1",
      [
        {
          baseBranch: "main",
          model: "model-x",
          prompt:
            "A checkout page\n\n---\n\nDrawn box: the sender drew a frame on the canvas to ask this. It was drawn by hand at about 390 × 840, phone width, so take the size as a loose hint, not a spec.",
        },
      ],
      { frameId: t.frameId }
    )
    const { branchId } = t.created[0]!
    expect(t.collections.iframeLayers.get(t.frameId)?.branchId).toBe(branchId)
    expect(t.sendPrompt).not.toHaveBeenCalled()
  })

  it("says the Workspace isn’t running yet, and still shows it in the frame", () => {
    const t = opened({ workspaceChat: undefined })

    act(() =>
      t.hook.result.current.send(payload("x"), {
        kind: "workspace",
        branchId: "b1",
      })
    )

    expect(toast.error).toHaveBeenCalledWith(
      "Checkout isn’t running yet. Ask again once it is."
    )
    expect(t.collections.iframeLayers.get(t.frameId)?.branchId).toBe("b1")
  })
})

describe("showing a running preview in a drawn frame", () => {
  it("shows it at its newest frame’s route, sending nothing", () => {
    const t = setup()
    t.collections.iframeLayers.set("f-old", {
      id: "f-old",
      width: 1280,
      height: 800,
      label: "Frame",
      iframeState: {},
      branchId: "b1",
      route: "/checkout",
    })
    const frameId = t.drawFrame()
    t.hook.rerender()
    act(() => t.hook.result.current.startFromFrame(frameId))

    act(() => t.hook.result.current.show("b1"))

    const frame = t.collections.iframeLayers.get(frameId)
    expect(frame?.branchId).toBe("b1")
    expect(frame?.route).toBe("/checkout")
    expect(t.sendPrompt).not.toHaveBeenCalled()
    expect(t.createBranch).not.toHaveBeenCalled()
    expect(t.hook.result.current.open).toBeNull()
  })
})

describe("runningPreviews", () => {
  const pickable = [
    baseBranch("old", { lastActivityAt: 1 }),
    baseBranch("new", { lastActivityAt: 9 }),
    baseBranch("mid", { createdAt: 5 }),
    baseBranch("starting", { status: "starting" }),
    baseBranch("stopped", { devServerStoppedAt: 3, lastActivityAt: 99 }),
  ]
  const ids = (preferred: (string | null)[]) =>
    runningPreviews({ pickable, preferred }).map((b) => b.id)

  it("lists running previews, newest activity first", () => {
    expect(ids([])).toEqual(["new", "mid", "old"])
  })

  it("leads with the first preferred one that’s running", () => {
    expect(ids([null, "stopped", "old", "mid"])).toEqual(["old", "new", "mid"])
  })
})

describe("workspaceRoute", () => {
  it("is the route of the Workspace’s newest frame that has one", () => {
    const frames = [
      { branchId: "b1", route: "/a" },
      { branchId: "b2", route: "/b" },
      { branchId: "b1", route: "/c" },
      { branchId: "b1" },
    ]
    expect(workspaceRoute(frames, "b1")).toBe("/c")
    expect(workspaceRoute(frames, "b3")).toBeUndefined()
  })
})

describe("sending a Mockup box’s ask", () => {
  function opened(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup(opts)
    act(() => t.hook.result.current.startFromMockupBox(box))
    return t
  }

  function expectEmptyMockup(
    t: ReturnType<typeof setup>,
    lastChangedByChatId: string
  ) {
    const mockup = t.onlyMockup()
    expect(mockup).toMatchObject({
      width: 390,
      height: 600,
      title: "",
      lastChangedByChatId,
    })
    expect(mockupHtml(t.doc, mockup!.id).toString()).toBe("")
    expect(t.setSelectedDocumentLayerIds).toHaveBeenLastCalledWith(
      new Set([mockup!.id])
    )
    return mockup!
  }

  it("makes the Workspace chat’s empty Mockup and asks it to fill it", () => {
    const t = opened({ workspaceChat: "c1" })

    act(() =>
      t.hook.result.current.send(payload("An empty cart"), {
        kind: "workspace",
        branchId: "b1",
      })
    )

    const mockup = expectEmptyMockup(t, "c1")
    expect(t.sendPrompt).toHaveBeenCalledWith(
      "b1",
      `An empty cart\n\n---\n\nDrawn box: the sender drew Mockup [mockup: ${mockup.id}] on the canvas for this; sketch it there with update_mockup. It was drawn by hand at about 390 × 600, phone width, so take the size as a loose hint, not a spec.`
    )
  })

  it("makes nothing when the Workspace isn’t running yet", () => {
    const t = opened({ workspaceChat: undefined })

    act(() =>
      t.hook.result.current.send(payload("x"), {
        kind: "workspace",
        branchId: "b1",
      })
    )

    expect(toast.error).toHaveBeenCalledWith(
      "Checkout isn’t running yet. Ask again once it is."
    )
    expect(t.collections.mockupLayers.toArray()).toHaveLength(0)
  })

  it("asks a picked chat with no repository, in its own model", () => {
    const sketch = {
      ...baseChat("s1"),
      branchId: undefined,
      target: "sketch" as const,
      model: "own-model",
    }
    const t = opened({ chats: [sketch] })

    act(() =>
      t.hook.result.current.send(payload("An empty cart"), {
        kind: "sketch",
        chatId: "s1",
      })
    )

    const mockup = expectEmptyMockup(t, "s1")
    expect(t.selectSketchChat).toHaveBeenCalledWith("s1")
    expect(t.sendMessage).toHaveBeenCalledWith({
      roomId: "room-1",
      chatId: "s1",
      target: { kind: "sketch", chatId: "s1" },
      message: `An empty cart\n\n---\n\nDrawn box: the sender drew Mockup [mockup: ${mockup.id}] on the canvas for this; sketch it there with update_mockup. It was drawn by hand at about 390 × 600, phone width, so take the size as a loose hint, not a spec.`,
      model: "own-model",
    })
  })

  it("starts a new chat with no repository", () => {
    const t = opened()

    act(() => t.hook.result.current.send(payload("x"), { kind: "sketch" }))

    const chatId = t.selectSketchChat.mock.calls[0]![0] as string
    expect(t.collections.chatSessions.get(chatId)?.target).toBe("sketch")
    expectEmptyMockup(t, chatId)
    expect(t.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId, model: "model-x" })
    )
  })

  it("starts a new chat whose empty Mockup stays drawn while its Branch is named, camera kept", async () => {
    let named!: () => void
    const t = opened({ naming: new Promise<void>((r) => (named = r)) })

    act(() => t.hook.result.current.send(payload("x"), { kind: "new-chat" }))

    // Nothing is created yet, but the box is already its chat’s Mockup.
    expect(t.created).toHaveLength(0)
    expect(t.createBranch).toHaveBeenCalledWith(
      "repo-1",
      [expect.objectContaining({ baseBranch: "main", model: "model-x" })],
      expect.objectContaining({ keepView: true })
    )
    const { chatId } = t.createBranch.mock.calls[0]![2]!
    expectEmptyMockup(t, chatId!)

    await act(async () => named())

    expect(t.created[0]!.chatId).toBe(chatId)
    expect(t.collections.chatSessions.get(chatId!)?.branchId).toBe(
      t.created[0]!.branchId
    )
  })
})

describe("a drawn Document’s ask", () => {
  function opened(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup(opts)
    const { docId } = t.ops.createDocument(
      { x: 0, y: 0 },
      { width: 480, height: 640 }
    )
    t.hook.rerender()
    act(() => t.hook.result.current.startFromDocument(docId))
    return { ...t, docId }
  }

  it("opens on the Document with a new chat answering", () => {
    const t = opened()
    expect(t.hook.result.current.open).toEqual({
      kind: "document",
      documentId: t.docId,
    })
    expect(t.hook.result.current.answerer).toEqual({ kind: "new-chat" })
  })

  it("asks the Workspace chat to write the Document", () => {
    const t = opened({ workspaceChat: "c1" })

    act(() =>
      t.hook.result.current.send(payload("A checkout brief"), {
        kind: "workspace",
        branchId: "b1",
      })
    )

    expect(t.sendPrompt).toHaveBeenCalledWith(
      "b1",
      forDocument("A checkout brief", t.docId)
    )
    expect(t.hook.result.current.open).toBeNull()
  })

  it("asks a picked chat with no repository", () => {
    const sketch = {
      ...baseChat("s1"),
      branchId: undefined,
      target: "sketch" as const,
      model: "own-model",
    }
    const t = opened({ chats: [sketch] })

    act(() =>
      t.hook.result.current.send(payload("Notes"), {
        kind: "sketch",
        chatId: "s1",
      })
    )

    expect(t.selectSketchChat).toHaveBeenCalledWith("s1")
    expect(t.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "s1", model: "own-model" })
    )
  })

  it("starts a new chat, camera kept", () => {
    const t = opened()

    act(() => t.hook.result.current.send(payload("x"), { kind: "new-chat" }))

    expect(t.createBranch).toHaveBeenCalledWith(
      "repo-1",
      [
        expect.objectContaining({
          prompt: forDocument("x", t.docId),
          model: "model-x",
        }),
      ],
      { keepView: true }
    )
  })

  it("writes it by hand, what was typed as its title", () => {
    const t = opened()

    act(() => t.hook.result.current.writeDocument(" Launch plan "))

    expect(t.collections.markdownLayers.get(t.docId)?.title).toBe("Launch plan")
    expect(t.setEditingDocumentLayerId).toHaveBeenCalledWith(t.docId)
    expect(t.hook.result.current.open).toBeNull()
  })

  it("writes it by hand untitled when nothing was typed", () => {
    const t = opened()

    act(() => t.hook.result.current.writeDocument(""))

    expect(t.collections.markdownLayers.get(t.docId)?.title).toBe("")
    expect(t.setEditingDocumentLayerId).toHaveBeenCalledWith(t.docId)
  })

  it("closes, leaving the empty Document", () => {
    const t = opened()

    act(() => t.hook.result.current.close())

    expect(t.collections.markdownLayers.has(t.docId)).toBe(true)
    expect(t.setEditingDocumentLayerId).not.toHaveBeenCalled()
  })
})

// The pure helpers the module routes with.

const repo = (id: string, repoFullName: string) =>
  ({ id, repoFullName }) as RepoData
const branch = (id: string, repoId: string, createdAt: number) =>
  ({ id, repoId, createdAt }) as BranchData

describe("defaultNewWorkspaceRepoId", () => {
  it("picks the newest Workspace’s Repo", () => {
    const repos = [repo("a", "acme/a"), repo("b", "acme/b")]
    const branches = [branch("1", "a", 1), branch("2", "b", 5)]
    expect(defaultNewWorkspaceRepoId(repos, branches)).toBe("b")
  })

  it("falls back to the first Repo in sidebar order", () => {
    const repos = [repo("z", "acme/z"), repo("a", "acme/a")]
    expect(defaultNewWorkspaceRepoId(repos, [])).toBe("a")
  })

  it("is null with no Repos", () => {
    expect(defaultNewWorkspaceRepoId([], [])).toBeNull()
  })
})

describe("sizeHint", () => {
  it("names a device preset the box lands on exactly", () => {
    expect(sizeHint({ width: 402, height: 874 })).toBe(
      "It is sized as the iPhone 17 Pro screen (402 × 874)."
    )
    expect(sizeHint({ width: 1280.2, height: 799.6 })).toBe(
      "It is sized as the Laptop screen (1280 × 800)."
    )
  })

  it("names a phone or tablet preset turned to landscape", () => {
    expect(sizeHint({ width: 1133, height: 744 })).toBe(
      "It is sized as the iPad mini (A17 Pro) screen in landscape (1133 × 744)."
    )
  })

  it("keeps a desktop preset to its own orientation", () => {
    expect(sizeHint({ width: 800, height: 1280 })).toContain("drawn by hand")
  })

  it("rounds a hand-drawn size and calls it a loose hint", () => {
    expect(sizeHint({ width: 613, height: 437 })).toBe(
      "It was drawn by hand at about 610 × 440, tablet width, so take the size as a loose hint, not a spec."
    )
  })

  it("gives a hand-drawn box its width class", () => {
    expect(sizeHint({ width: 388, height: 700 })).toContain("phone width")
    expect(sizeHint({ width: 1100, height: 700 })).toContain("desktop width")
  })

  it("never rounds a tiny box down to nothing", () => {
    expect(sizeHint({ width: 3, height: 4 })).toContain("about 10 × 10")
  })
})

describe("withViewport", () => {
  it("adds the size as a footer only the model reads", () => {
    expect(withViewport(" A checkout page ", { width: 390, height: 844 })).toBe(
      "A checkout page\n\n---\n\nDrawn box: the sender drew a frame on the canvas to ask this. It was drawn by hand at about 390 × 840, phone width, so take the size as a loose hint, not a spec."
    )
  })

  it("shows only what was typed", () => {
    const wire = withViewport("A checkout page", { width: 402, height: 874 })
    expect(wire).toContain("iPhone 17 Pro screen (402 × 874)")
    expect(projectUserTurn(wire).body).toBe("A checkout page")
    expect(buildOutgoingTurn({ message: wire }).turn.body).toBe(
      "A checkout page"
    )
  })
})

describe("defaultFrameAnswerer", () => {
  const world = {
    frames: [
      { id: "f1", branchId: "b1" },
      { id: "f2", branchId: "b2" },
      { id: "f3", branchId: "b1" },
      { id: "blank" },
    ],
    ownedLayers: [
      { id: "mockup", lastChangedByChatId: "c1" },
      { id: "doc", lastChangedByChatId: "c2" },
      { id: "handmade" },
    ],
    chatSessions: [
      { id: "c1", branchId: "b1" },
      { id: "c2", branchId: "b2" },
    ],
    pickable: [{ id: "b1" }, { id: "b2" }],
  }
  const answer = (frameIds: string[], ownedLayerIds: string[] = []) =>
    defaultFrameAnswerer({ ...world, frameIds, ownedLayerIds })

  it("answers with a selected frame’s Workspace", () => {
    expect(answer(["f2"])).toEqual({ kind: "workspace", branchId: "b2" })
  })

  it("answers with the Workspace of the chat that last changed a selected Mockup", () => {
    expect(answer([], ["mockup"])).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("answers with the Workspace of the chat that last changed a selected Document", () => {
    expect(answer([], ["doc"])).toEqual({ kind: "workspace", branchId: "b2" })
  })

  it("answers with the one Workspace several layers share", () => {
    expect(answer(["f1", "f3"], ["mockup"])).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("starts a new chat for layers on different Workspaces", () => {
    expect(answer(["f1", "f2"])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat with nothing selected", () => {
    expect(answer([])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat for a blank frame or a hand-made Document", () => {
    expect(answer(["blank"])).toEqual({ kind: "new-chat" })
    expect(answer([], ["handmade"])).toEqual({ kind: "new-chat" })
  })

  it("starts a new chat when the Workspace can’t be picked", () => {
    expect(
      defaultFrameAnswerer({
        ...world,
        pickable: [{ id: "b2" }],
        frameIds: ["f1"],
        ownedLayerIds: [],
      })
    ).toEqual({ kind: "new-chat" })
  })
})

describe("forMockup", () => {
  it("names the drawn Mockup and its size in a footer after what was typed", () => {
    expect(forMockup(" An empty cart ", "m-1", { width: 1280, height: 800 }))
      .toBe(`An empty cart

---

Drawn box: the sender drew Mockup [mockup: m-1] on the canvas for this; sketch it there with update_mockup. It is sized as the Laptop screen (1280 × 800).`)
  })

  it("shows only what was typed", () => {
    const wire = forMockup("An empty cart", "m-1", { width: 390, height: 600 })
    expect(projectUserTurn(wire).body).toBe("An empty cart")
    expect(buildOutgoingTurn({ message: wire }).turn.body).toBe("An empty cart")
  })
})

describe("forDocument", () => {
  it("names the drawn Document in a footer after what was typed", () => {
    expect(forDocument(" A launch plan ", "d-1")).toBe(`A launch plan

---

Drawn box: the sender drew Document [document: d-1] on the canvas for this; write its title and body there with set_document_title and replace_document_body.`)
  })

  it("shows only what was typed", () => {
    const wire = forDocument("A launch plan", "d-1")
    expect(projectUserTurn(wire).body).toBe("A launch plan")
    expect(buildOutgoingTurn({ message: wire }).turn.body).toBe("A launch plan")
  })
})

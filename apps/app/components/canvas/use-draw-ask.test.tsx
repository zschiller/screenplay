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
  forMockup,
  withViewport,
} from "@/lib/draw-ask"

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
 * makes the Branch and its chat the way Branch Intake does, in one batch, and
 * runs the module's `afterCreate` there.
 */
function setup(
  opts: {
    repos?: RepoData[]
    agents?: BranchData[]
    chats?: ChatSessionData[]
    /** The Workspace chat a prompt lands in; none while it starts. */
    workspaceChat?: string
    selected?: { frames?: string[]; owned?: string[] }
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
  const selectIframeLayer = vi.fn()
  const created: Array<{ branchId: string; chatId?: string }> = []
  const createBranch = vi.fn(
    async (
      repoId: string,
      specs: ComposerSpec[],
      createOpts?: CreateBranchOptions
    ) => {
      ops.batch(() => {
        const result = ops.createBranch({
          branch: {
            ...baseBranch("ignored", { repoId }),
            status: "creating",
          },
          chat: { label: "New", model: specs[0]!.model },
          frameId: createOpts?.frameId,
        })
        created.push(result)
        createOpts?.afterCreate?.(result)
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
      sendPrompt,
      createBranch,
      addChatSession: (id, chat) => collections.chatSessions.set(id, chat),
      chatTarget: { selectSketchChat },
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
      "A checkout page\n\nFor a 390 × 844 viewport."
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
          prompt: "A checkout page\n\nFor a 390 × 844 viewport.",
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

describe("sending a Mockup box’s ask", () => {
  function opened(opts: Parameters<typeof setup>[0] = {}) {
    const t = setup(opts)
    act(() => t.hook.result.current.startFromMockupBox(box))
    return t
  }

  function expectEmptyMockup(t: ReturnType<typeof setup>, ownerChatId: string) {
    const mockup = t.onlyMockup()
    expect(mockup).toMatchObject({
      width: 390,
      height: 600,
      title: "",
      ownerChatId,
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
      `An empty cart\n\nSketch it in Mockup [mockup: ${mockup.id}] with update_mockup, for a 390 × 600 viewport.`
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
      message: `An empty cart\n\nSketch it in Mockup [mockup: ${mockup.id}] with update_mockup, for a 390 × 600 viewport.`,
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

  it("starts a new chat whose empty Mockup lands with its Branch, camera kept", async () => {
    const t = opened()

    await act(async () =>
      t.hook.result.current.send(payload("x"), { kind: "new-chat" })
    )

    expect(t.createBranch).toHaveBeenCalledWith(
      "repo-1",
      [expect.objectContaining({ baseBranch: "main", model: "model-x" })],
      expect.objectContaining({ keepView: true })
    )
    const chatId = t.created[0]!.chatId!
    expectEmptyMockup(t, chatId)
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

describe("withViewport", () => {
  it("adds the frame size after the prompt", () => {
    expect(withViewport("A checkout page", { width: 390, height: 844 })).toBe(
      "A checkout page\n\nFor a 390 × 844 viewport."
    )
  })

  it("rounds the size", () => {
    expect(withViewport("x", { width: 390.4, height: 843.6 })).toBe(
      "x\n\nFor a 390 × 844 viewport."
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
      { id: "mockup", ownerChatId: "c1" },
      { id: "doc", ownerChatId: "c2" },
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

  it("answers with a selected Mockup’s owner chat’s Workspace", () => {
    expect(answer([], ["mockup"])).toEqual({
      kind: "workspace",
      branchId: "b1",
    })
  })

  it("answers with a selected Document’s owner chat’s Workspace", () => {
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
  it("names the drawn Mockup and its viewport after what was typed", () => {
    expect(forMockup(" An empty cart ", "m-1", { width: 390.4, height: 844 }))
      .toBe(`An empty cart

Sketch it in Mockup [mockup: m-1] with update_mockup, for a 390 × 844 viewport.`)
  })

  it("still names the Mockup when nothing was typed", () => {
    expect(forMockup("", "m-1", { width: 1280, height: 800 })).toBe(
      "Sketch it in Mockup [mockup: m-1] with update_mockup, for a 1280 × 800 viewport."
    )
  })
})

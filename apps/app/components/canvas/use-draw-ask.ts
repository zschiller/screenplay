"use client"

import { useCallback, useMemo, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { nanoid } from "nanoid"
import { toast } from "sonner"

import type { ComposerSubmitPayload } from "@/components/agent/composer"
import type { CreateBranchOptions } from "@/components/canvas/use-branch-intake"
import type { CanvasSelection } from "@/components/canvas/use-canvas-selection"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { DrawnRect } from "@/components/canvas/use-draw-tool"
import type { CanvasOps } from "@/lib/canvas/ops"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import { sketchChatSession } from "@/lib/chat/sketch-chat"
import type { SendMessageOptions } from "@/lib/chat-store"
import {
  defaultFrameAnswerer,
  defaultNewWorkspaceRepoId,
  emptyMockup,
  forDocument,
  forMockup,
  NEW_CHAT,
  NEW_SKETCH_CHAT,
  runningPreviews,
  withViewport,
  workspaceRoute,
  type DrawnMockup,
  type FrameAnswerer,
} from "@/lib/draw-ask"
import { pickableWorkspaces } from "@/components/canvas/workspace-list"
import { workspaceLabel } from "@/lib/workspace-label"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  RepoData,
} from "@/lib/types"

/**
 * The open draw-then-ask (#1356, #1359): a drawn frame waiting for what to
 * show, a drawn Mockup box waiting for what to sketch, or a drawn Document
 * waiting for what to say. Per-viewer, never in the room doc. A Mockup box is
 * only a box until sent: closing drops it, leaving nothing behind. A Document
 * is made when it's drawn, so closing leaves it there, empty.
 */
export type OpenAsk =
  | { kind: "frame"; frameId: string }
  | { kind: "mockup"; box: DrawnRect }
  | { kind: "document"; documentId: string }

export interface DrawAskDeps {
  ops: CanvasOps
  repos: RepoData[]
  agents: BranchData[]
  iframeLayers: IframeLayerData[]
  /** Documents and Mockups, for who owns a selected one. */
  ownedLayers: readonly {
    id: string
    lastChangedByChatId?: string
    ownerChatId?: string
  }[]
  chatSessions: ChatSessionData[]
  selection: Pick<CanvasSelection, "current" | "selectIframeLayer">
  setSelectedGroupIds: Dispatch<SetStateAction<Set<string>>>
  setSelectedIframeLayerIds: Dispatch<SetStateAction<Set<string>>>
  setSelectedDocumentLayerIds: Dispatch<SetStateAction<Set<string>>>
  /** Open a Document for editing, for a drawn one's Write it myself. */
  setEditingDocumentLayerId: (id: string | null) => void
  /** A prompt into a Workspace's chat; its chat id, or none while it starts. */
  sendPrompt: (branchId: string, message: string) => string | undefined
  /** Branch Intake's create, for a new chat. */
  createBranch: (
    repoId: string,
    specs: ComposerSpec[],
    opts?: CreateBranchOptions
  ) => Promise<void>
  addChatSession: (chatId: string, chat: ChatSessionData) => void
  /** The chat panel's Workspace leads the running previews after the selection's. */
  chatTarget: Pick<ChatTarget, "selectSketchChat" | "selectedAgentId">
  /** `chatStore.sendMessage`, for a chat with no repository. */
  sendMessage: (opts: SendMessageOptions) => unknown
  roomId: string
}

export interface DrawAsk {
  /** The open ask; a frame's closes once it shows a Workspace or is gone. */
  open: OpenAsk | null
  /**
   * Who answers when the card opens (#1357). The card's chip changes it and
   * hands its pick to `send`.
   */
  answerer: FrameAnswerer
  /**
   * The running previews a drawn frame's ask offers first, the likely one
   * leading (`runningPreviews`). Empty for a Mockup box, for Start a chat,
   * and when none is running: the ask is then the composer alone.
   */
  previews: BranchData[]
  /** A frame was drawn. Opens only when there's a Repo for a new chat. */
  startFromFrame: (frameId: string) => void
  /** A Mockup box was drawn. */
  startFromMockupBox: (box: DrawnRect) => void
  /** A Document was drawn. */
  startFromDocument: (documentId: string) => void
  /**
   * A drawn Document's Write it myself: close and open it for editing, what
   * was typed in the card as its title.
   */
  writeDocument: (title: string) => void
  /**
   * An unanswered frame's Start a chat (#1358): select it and reopen its ask.
   * Absent with no Repo for a new chat to start in.
   */
  startFrameChat?: (frameId: string) => void
  /**
   * Show a running preview in the drawn frame, at the route its newest frame
   * shows, and close. Nothing is sent.
   */
  show: (branchId: string) => void
  /** Send what was typed to `answerer`, and close. */
  send: (payload: ComposerSubmitPayload, answerer: FrameAnswerer) => void
  close: () => void
}

/**
 * The Draw-and-ask module (#1489): one home for the Frame, Mockup and
 * Document tools' ask, from the drawn layer to the chat that answers. The canvas root only
 * renders the ask card from `open`.
 *
 * Sending routes by answerer. A Workspace's own chat takes the prompt, and a
 * frame shows that Workspace; a chat with no repository (a Mockup box only)
 * takes it in the panel; a new chat starts a Workspace through Branch Intake
 * with the New Workspace dialog's defaults. A frame's prompt carries its size
 * as the viewport; a Mockup box becomes an empty Mockup owned by the
 * answering chat, which the prompt asks it to fill with update_mockup. A
 * drawn Document is already there; the prompt asks the chat to write it.
 */
export function useDrawAsk(deps: DrawAskDeps): DrawAsk {
  const {
    ops,
    repos,
    agents,
    iframeLayers,
    ownedLayers,
    chatSessions,
    selection,
    setSelectedGroupIds,
    setSelectedIframeLayerIds,
    setSelectedDocumentLayerIds,
    setEditingDocumentLayerId,
    sendPrompt,
    createBranch,
    addChatSession,
    chatTarget,
    sendMessage,
    roomId,
  } = deps
  const [ask, setAsk] = useState<OpenAsk | null>(null)
  const [answerer, setAnswerer] = useState<FrameAnswerer>(NEW_CHAT)
  const [previews, setPreviews] = useState<BranchData[]>([])

  const newChatRepoId = useMemo(
    () => defaultNewWorkspaceRepoId(repos, agents),
    [repos, agents]
  )

  // Worked out from what was selected before the layer was drawn (drawing
  // selects the new frame).
  const answererFromSelection = useCallback(
    (opts: { sketch?: boolean } = {}) => {
      const selected = selection.current()
      return defaultFrameAnswerer({
        frameIds: selected.iframeLayerIds,
        ownedLayerIds: selected.markdownLayerIds,
        frames: iframeLayers,
        ownedLayers,
        chatSessions,
        pickable: pickableWorkspaces(agents),
        sketch: opts.sketch,
      })
    },
    [selection, iframeLayers, ownedLayers, chatSessions, agents]
  )

  const startFromFrame = useCallback(
    (frameId: string) => {
      if (!newChatRepoId) return
      const picked = answererFromSelection()
      setAnswerer(picked)
      setPreviews(
        runningPreviews({
          pickable: pickableWorkspaces(agents),
          preferred: [
            picked.kind === "workspace" ? picked.branchId : null,
            chatTarget.selectedAgentId,
          ],
        })
      )
      setAsk({ kind: "frame", frameId })
    },
    [newChatRepoId, answererFromSelection, agents, chatTarget.selectedAgentId]
  )

  // With no repository there are no Workspaces, so a chat with none answers.
  const startFromMockupBox = useCallback(
    (box: DrawnRect) => {
      const picked = answererFromSelection({ sketch: true })
      setAnswerer(
        newChatRepoId || picked.kind === "sketch" ? picked : NEW_SKETCH_CHAT
      )
      setPreviews([])
      setAsk({ kind: "mockup", box })
    },
    [newChatRepoId, answererFromSelection]
  )

  // A Document is written by the same chats a Mockup box offers.
  const startFromDocument = useCallback(
    (documentId: string) => {
      const picked = answererFromSelection({ sketch: true })
      setAnswerer(
        newChatRepoId || picked.kind === "sketch" ? picked : NEW_SKETCH_CHAT
      )
      setPreviews([])
      setAsk({ kind: "document", documentId })
    },
    [newChatRepoId, answererFromSelection]
  )

  // The frame itself is the selection now, and it has no Workspace, so a new
  // chat answers unless the chip is switched.
  const { selectIframeLayer } = selection
  const startFrameChat = useCallback(
    (frameId: string) => {
      selectIframeLayer(frameId, false)
      setAnswerer(NEW_CHAT)
      setPreviews([])
      setAsk({ kind: "frame", frameId })
    },
    [selectIframeLayer]
  )

  const close = useCallback(() => {
    setAsk(null)
    setAnswerer(NEW_CHAT)
    setPreviews([])
  }, [])

  // A Workspace still starting has no agent to ask yet.
  const notRunning = useCallback(
    (branchId: string) => {
      const agent = agents.find((a) => a.id === branchId)
      toast.error(
        `${agent ? workspaceLabel(agent) : "That chat"} isn’t running yet. Ask again once it is.`
      )
    },
    [agents]
  )

  const sendFrame = useCallback(
    (
      frame: IframeLayerData,
      payload: ComposerSubmitPayload,
      to: FrameAnswerer
    ) => {
      const prompt = withViewport(payload.text, frame)
      if (to.kind === "workspace") {
        ops.assignBranch(frame.id, to.branchId)
        if (!sendPrompt(to.branchId, prompt)) notRunning(to.branchId)
        return
      }
      const repo = repos.find((r) => r.id === newChatRepoId)
      if (!repo) return
      void createBranch(
        repo.id,
        [{ baseBranch: repo.defaultBranch, model: payload.model, prompt }],
        { frameId: frame.id }
      )
    },
    [ops, sendPrompt, notRunning, repos, newChatRepoId, createBranch]
  )

  const sendMockup = useCallback(
    (box: DrawnRect, payload: ComposerSubmitPayload, to: FrameAnswerer) => {
      const mockup: DrawnMockup = { id: nanoid(), ...box }
      const prompt = forMockup(payload.text, mockup.id, box)
      const place = (chatId: string) => {
        ops.createMockup(emptyMockup(mockup, chatId))
        setSelectedGroupIds(new Set())
        setSelectedIframeLayerIds(new Set())
        setSelectedDocumentLayerIds(new Set([mockup.id]))
      }
      if (to.kind === "workspace") {
        const chatId = sendPrompt(to.branchId, prompt)
        if (!chatId) return notRunning(to.branchId)
        place(chatId)
        return
      }
      // A chat with no repository owns the Mockup and sketches it: the one
      // picked, else a new one.
      if (to.kind === "sketch") {
        const existing = to.chatId
          ? chatSessions.find((c) => c.id === to.chatId)
          : undefined
        const chatId = existing?.id ?? nanoid()
        if (!existing) {
          addChatSession(chatId, sketchChatSession(chatId, Date.now()))
        }
        place(chatId)
        chatTarget.selectSketchChat(chatId)
        void sendMessage({
          roomId,
          chatId,
          target: { kind: "sketch", chatId },
          message: prompt,
          // An existing chat keeps its own model.
          model: existing?.model ?? payload.model,
        })
        return
      }
      // The Mockup stays on the canvas, sketching, from the moment the ask is
      // sent: the new chat's id is minted here so it can own the Mockup
      // before the Workspace lands. The new
      // Workspace's frame lands beside the other Groups without moving the
      // camera: the Mockup is the one to watch.
      const repo = repos.find((r) => r.id === newChatRepoId)
      if (!repo) return
      const chatId = nanoid()
      place(chatId)
      void createBranch(
        repo.id,
        [{ baseBranch: repo.defaultBranch, model: payload.model, prompt }],
        { chatId, keepView: true }
      )
    },
    [
      ops,
      setSelectedGroupIds,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      sendPrompt,
      notRunning,
      chatSessions,
      addChatSession,
      chatTarget,
      sendMessage,
      roomId,
      repos,
      newChatRepoId,
      createBranch,
    ]
  )

  // The drawn Document is there already: the prompt names it for the chat
  // that answers to write, as a Mockup box's does.
  const sendDocument = useCallback(
    (documentId: string, payload: ComposerSubmitPayload, to: FrameAnswerer) => {
      const prompt = forDocument(payload.text, documentId)
      if (to.kind === "workspace") {
        if (!sendPrompt(to.branchId, prompt)) notRunning(to.branchId)
        return
      }
      if (to.kind === "sketch") {
        const existing = to.chatId
          ? chatSessions.find((c) => c.id === to.chatId)
          : undefined
        const chatId = existing?.id ?? nanoid()
        if (!existing) {
          addChatSession(chatId, sketchChatSession(chatId, Date.now()))
        }
        chatTarget.selectSketchChat(chatId)
        void sendMessage({
          roomId,
          chatId,
          target: { kind: "sketch", chatId },
          message: prompt,
          model: existing?.model ?? payload.model,
        })
        return
      }
      const repo = repos.find((r) => r.id === newChatRepoId)
      if (!repo) return
      void createBranch(
        repo.id,
        [{ baseBranch: repo.defaultBranch, model: payload.model, prompt }],
        { keepView: true }
      )
    },
    [
      sendPrompt,
      notRunning,
      chatSessions,
      addChatSession,
      chatTarget,
      sendMessage,
      roomId,
      repos,
      newChatRepoId,
      createBranch,
    ]
  )

  // A frame's ask is open only while the frame is there with no Workspace,
  // and a Document's while the Document is.
  const open = useMemo<OpenAsk | null>(() => {
    if (ask?.kind === "document") {
      return ownedLayers.some((l) => l.id === ask.documentId) ? ask : null
    }
    if (ask?.kind !== "frame") return ask
    const frame = iframeLayers.find((l) => l.id === ask.frameId)
    return frame && !frame.branchId ? ask : null
  }, [ask, iframeLayers, ownedLayers])

  const show = useCallback(
    (branchId: string) => {
      const frameId = open?.kind === "frame" ? open.frameId : null
      close()
      if (!frameId) return
      ops.assignBranch(frameId, branchId, {
        route: workspaceRoute(iframeLayers, branchId),
      })
    },
    [open, close, ops, iframeLayers]
  )

  const send = useCallback(
    (payload: ComposerSubmitPayload, to: FrameAnswerer) => {
      close()
      if (open?.kind === "mockup") return sendMockup(open.box, payload, to)
      if (open?.kind === "document") {
        return sendDocument(open.documentId, payload, to)
      }
      const frame = open
        ? iframeLayers.find((l) => l.id === open.frameId)
        : undefined
      if (frame) sendFrame(frame, payload, to)
    },
    [close, open, iframeLayers, sendMockup, sendDocument, sendFrame]
  )

  const writeDocument = useCallback(
    (title: string) => {
      const documentId = open?.kind === "document" ? open.documentId : null
      close()
      if (!documentId) return
      const text = title.trim()
      if (text) ops.renameDocument(documentId, text)
      setEditingDocumentLayerId(documentId)
    },
    [open, close, ops, setEditingDocumentLayerId]
  )

  return {
    open,
    answerer,
    previews,
    startFromFrame,
    startFromMockupBox,
    startFromDocument,
    writeDocument,
    startFrameChat: newChatRepoId ? startFrameChat : undefined,
    show,
    send,
    close,
  }
}

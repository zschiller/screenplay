import { type RefObject, useCallback, useMemo, useRef, useState } from "react"
import { nanoid } from "nanoid"
import type { Editor } from "@tiptap/core"

import { chatStore } from "@/lib/chat-store"
import {
  type ReferenceContext,
  resolveReference,
} from "@/lib/canvas/chat-reference"
import type { IframeLayerLayoutMap } from "@/lib/canvas/layout"
import type { ScreenplayDom } from "@/hooks/use-screenplay-dom"
import type { DomRect } from "@/lib/postmessage-protocol"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  MarkdownLayerData,
} from "@/lib/types"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { InlineCommentDraft } from "./markdown-layer"

/**
 * Element Reference controller (PRD #570) — the apply-side of the single-user
 * "anchor an element / text span and Send to agent" reference path that the
 * local build keeps (the comment UI minus the persisted thread; see
 * `apps/app/CONTEXT.md`, "Element Reference"). Lifted out of
 * `components/canvas/canvas.tsx`, it owns the comment-mode placement state
 * (`newCommentPos`, `activeThreadId`, `inspectHover`) and the two ref-backed
 * registries the flow reads — the per-Iframe-Layer DOM accessors and the
 * per-Markdown-Layer TipTap editors — each with a version counter so membership
 * changes re-render the consumers.
 *
 * The message-formatting and target-routing decision is pure
 * (`lib/canvas/chat-reference`); this controller applies it: create the fresh
 * Chat Session, select the resolved target **through the Chat-Target
 * controller** (#569) rather than poking raw setters, and call
 * `chatStore.sendMessage`. The 168-line handler it replaces collapses to one
 * verb, `sendReference`.
 *
 * Like the Canvas Gesture seam, the controller's live inputs arrive through a
 * ref the component repopulates every render. That breaks the ordering cycle:
 * the placement state is read by the keyboard handler defined high in the
 * component, while `sendReference` needs the Chat-Target controller and the
 * canvas operations defined far below it.
 */
export interface ElementReferenceInputs {
  roomId: string
  agents: BranchData[]
  iframeLayers: IframeLayerData[]
  markdownLayers: MarkdownLayerData[]
  chatSessions: ChatSessionData[]
  /**
   * The hit-test set — frames *and* document layers — comment-mode placement
   * tests a click against (the same map the rest of the canvas resolves layer
   * geometry through).
   */
  iframeLayerLayouts: IframeLayerLayoutMap
  /** Create a Chat Session through the canvas ops seam (ADR 0001). */
  addChatSession: (id: string, data: ChatSessionData) => void
  /** Selection goes through the Chat-Target controller, not raw setters. */
  chatTarget: Pick<
    ChatTarget,
    "selectDocChat" | "selectAgentChat" | "expandPanel"
  >
  /** Late-bound rename callbacks fired by the chat stream (auto-naming). */
  onChatRename: (chatId: string, label: string) => void
  onBranchRename: (agentId: string, branch: string) => void
}

/** Comment-mode placement position — layer-local for frame/doc-anchored pins. */
export interface CommentPlacement {
  x: number
  y: number
  iframeLayerId?: string
  selector?: string | null
  offsetX?: number | null
  offsetY?: number | null
  documentId?: string | null
  anchorStart?: string | null
  anchorEnd?: string | null
  quotedText?: string | null
  lineFrom?: number | null
  lineTo?: number | null
}

export interface ElementReference {
  /** The new-thread composer's placement, or null when none is open. */
  newCommentPos: CommentPlacement | null
  /** The inline-comment thread whose pin popover is open, if any. */
  activeThreadId: string | null
  /** The live inspect-hover overlay shown while in comment mode. */
  inspectHover: { iframeLayerId: string; rect: DomRect } | null
  /** Bumped when a markdown-layer editor registers / unregisters. */
  documentEditorsVersion: number

  /**
   * Place the new-thread composer at a canvas point. Hit-tests the frame / doc
   * layouts; for a frame it shows the composer immediately and races the iframe
   * bridge's selector resolution, patching the selector + relative offsets in.
   */
  place: (canvasX: number, canvasY: number) => void
  /** Open the composer for a text selection inside a doc layer. */
  startInlineComment: (draft: InlineCommentDraft) => void
  /** Open (or close) an existing inline-comment thread's pin popover. */
  setActiveThread: (threadId: string | null) => void
  /** Update the inspect-hover overlay for a frame (rect null clears it). */
  setInspectHover: (iframeLayerId: string, rect: DomRect | null) => void
  /** Dismiss the composer (cancel / placed). */
  clearComposer: () => void
  /** Reset comment-mode sub-state on a tool-mode switch (composer + hover). */
  clearMode: () => void
  /**
   * Hand the composer's note off to the agent chat: resolve the pure decision,
   * create a fresh Chat Session, select the target via the Chat-Target
   * controller, and send. A frame element routes to the frame's branch; a doc
   * selection to that document; an unresolvable target is a no-op.
   */
  sendReference: (note: string, ctx: ReferenceContext) => void

  /** Iframe Layer DOM-accessor registry (register on mount / unmount). */
  onIframeLayerDomReady: (id: string, dom: ScreenplayDom | null) => void
  getIframeLayerDom: (id: string) => ScreenplayDom | undefined
  /** Markdown Layer editor registry (drives inline highlights + pin anchors). */
  onDocumentEditorReady: (id: string, editor: Editor | null) => void
  getDocumentEditor: (id: string) => Editor | undefined
}

export function useElementReference(
  inputsRef: RefObject<ElementReferenceInputs | null>
): ElementReference {
  const [newCommentPos, setNewCommentPos] = useState<CommentPlacement | null>(
    null
  )
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [inspectHover, setInspectHoverState] = useState<{
    iframeLayerId: string
    rect: DomRect
  } | null>(null)

  // Per-Iframe-Layer iframe DOM accessor registry. IframeLayers register on
  // mount and unregister on unmount; selector-anchored comments use it to query
  // element rects in the right iframe.
  const iframeLayerDomsRef = useRef(new Map<string, ScreenplayDom>())
  const [, setIframeLayerDomsVersion] = useState(0)
  const onIframeLayerDomReady = useCallback(
    (id: string, dom: ScreenplayDom | null) => {
      const map = iframeLayerDomsRef.current
      if (dom) map.set(id, dom)
      else map.delete(id)
      setIframeLayerDomsVersion((v) => v + 1)
    },
    []
  )
  const getIframeLayerDom = useCallback(
    (id: string): ScreenplayDom | undefined =>
      iframeLayerDomsRef.current.get(id),
    []
  )

  // Same registry pattern as iframe DOMs, but for doc-layer TipTap editors.
  // Inline-comment threads use this to push highlight ranges into the editor and
  // to compute where to anchor each thread's canvas pin.
  const documentEditorsRef = useRef(new Map<string, Editor>())
  const [documentEditorsVersion, setDocumentEditorsVersion] = useState(0)
  const onDocumentEditorReady = useCallback(
    (id: string, editor: Editor | null) => {
      const map = documentEditorsRef.current
      if (editor) map.set(id, editor)
      else map.delete(id)
      setDocumentEditorsVersion((v) => v + 1)
    },
    []
  )
  const getDocumentEditor = useCallback(
    (id: string): Editor | undefined => documentEditorsRef.current.get(id),
    []
  )

  const place = useCallback(
    (canvasX: number, canvasY: number) => {
      const inputs = inputsRef.current
      if (!inputs) return
      // Hit-test against layer bounds — store offset relative to the layer. The
      // iframe fills the layer div with no transform, so layer-local coordinates
      // equal iframe-viewport coordinates and pass directly to elementAtPoint.
      for (const layout of inputs.iframeLayerLayouts.values()) {
        if (
          canvasX >= layout.x &&
          canvasX <= layout.x + layout.width &&
          canvasY >= layout.y &&
          canvasY <= layout.y + layout.height
        ) {
          const localX = canvasX - layout.x
          const localY = canvasY - layout.y
          // Show the composer immediately at the click point; selector
          // resolution races the user's typing and patches the state in.
          setNewCommentPos({ x: localX, y: localY, iframeLayerId: layout.id })
          const dom = getIframeLayerDom(layout.id)
          if (dom) {
            dom
              .elementAtPoint(localX, localY)
              .then((result) => {
                if (!result) return
                // Store offsets as fractions of the element's width/height so
                // the pin tracks the same relative point as the element resizes
                // with the layer / page reflow. Falls back to 0 for zero-sized
                // elements (no meaningful relative position).
                const w = result.rect.width
                const h = result.rect.height
                const offsetX = w > 0 ? (localX - result.rect.x) / w : 0
                const offsetY = h > 0 ? (localY - result.rect.y) / h : 0
                setNewCommentPos((prev) => {
                  if (!prev || prev.iframeLayerId !== layout.id) return prev
                  return {
                    ...prev,
                    selector: result.selector || null,
                    offsetX,
                    offsetY,
                  }
                })
              })
              .catch(() => {})
          }
          return
        }
      }

      setNewCommentPos({ x: canvasX, y: canvasY })
    },
    [inputsRef, getIframeLayerDom]
  )

  // The user clicked the inline "Comment" button on a text selection inside a
  // markdown layer. Open the new-thread composer at the right margin of the doc,
  // anchored to the captured Y.RelativePosition pair. x/y are stored layer-local
  // (matching the iframe-layer-thread convention) so the composer's resolvePos
  // can land it by adding the doc tile's canvas origin.
  const startInlineComment = useCallback(
    (draft: InlineCommentDraft) => {
      if (!inputsRef.current?.iframeLayerLayouts.has(draft.documentId)) return
      setNewCommentPos({
        x: draft.canvasX,
        y: draft.canvasY,
        documentId: draft.documentId,
        anchorStart: draft.anchorStart,
        anchorEnd: draft.anchorEnd,
        quotedText: draft.quotedText,
        lineFrom: draft.lineFrom,
        lineTo: draft.lineTo,
      })
    },
    [inputsRef]
  )

  const setActiveThread = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId)
  }, [])

  const setInspectHover = useCallback(
    (iframeLayerId: string, rect: DomRect | null) => {
      if (!rect) {
        setInspectHoverState((h) =>
          h?.iframeLayerId === iframeLayerId ? null : h
        )
      } else {
        setInspectHoverState({ iframeLayerId, rect })
      }
    },
    []
  )

  const clearComposer = useCallback(() => {
    setNewCommentPos(null)
  }, [])

  const clearMode = useCallback(() => {
    setNewCommentPos(null)
    setInspectHoverState(null)
  }, [])

  const sendReference = useCallback(
    (note: string, ctx: ReferenceContext) => {
      const inputs = inputsRef.current
      if (!inputs) return
      const decision = resolveReference({
        note,
        ctx,
        roomId: inputs.roomId,
        chatId: nanoid(),
        createdAt: Date.now(),
        agents: inputs.agents,
        iframeLayers: inputs.iframeLayers,
        markdownLayers: inputs.markdownLayers,
        chatSessions: inputs.chatSessions,
      })
      if (decision.kind === "none") return

      const { session, select, send } = decision
      inputs.addChatSession(session.id, session)

      if (select.kind === "document") {
        inputs.chatTarget.selectDocChat(select.documentId, select.chatId)
        chatStore.sendMessage({
          ...send,
          onChatRename: (label) => inputs.onChatRename(select.chatId, label),
        })
      } else {
        inputs.chatTarget.selectAgentChat(select.agentId, select.chatId, {
          clearDocument: true,
          remember: true,
        })
        chatStore.sendMessage({
          ...send,
          onBranchRename: (branch) =>
            inputs.onBranchRename(select.agentId, branch),
          onChatRename: (label) => inputs.onChatRename(select.chatId, label),
        })
      }
      inputs.chatTarget.expandPanel()
    },
    [inputsRef]
  )

  // Memoized so the controller object stays stable across renders (the verbs
  // are all `useCallback`-stable); it only changes when the placement / registry
  // state does. Consumers list `reference` whole in dep arrays — matching the
  // other canvas controllers — without re-binding long-lived handlers each
  // render.
  return useMemo(
    () => ({
      newCommentPos,
      activeThreadId,
      inspectHover,
      documentEditorsVersion,
      place,
      startInlineComment,
      setActiveThread,
      setInspectHover,
      clearComposer,
      clearMode,
      sendReference,
      onIframeLayerDomReady,
      getIframeLayerDom,
      onDocumentEditorReady,
      getDocumentEditor,
    }),
    [
      newCommentPos,
      activeThreadId,
      inspectHover,
      documentEditorsVersion,
      place,
      startInlineComment,
      setActiveThread,
      setInspectHover,
      clearComposer,
      clearMode,
      sendReference,
      onIframeLayerDomReady,
      getIframeLayerDom,
      onDocumentEditorReady,
      getDocumentEditor,
    ]
  )
}

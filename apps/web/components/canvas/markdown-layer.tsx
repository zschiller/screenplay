"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MessageSquare } from "lucide-react"
import type { Editor } from "@tiptap/core"
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react"
import { Extension } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import Mention from "@tiptap/extension-mention"
import Placeholder from "@tiptap/extension-placeholder"
import { useIframeLayerDrag } from "@/hooks/use-iframe-layer-drag"
import { useIframeLayerResize } from "@/hooks/use-iframe-layer-resize"
import { useDocumentFragment, useYjs } from "@/lib/yjs/context"
import { useMarkdownLayers } from "@/lib/yjs/react"
import { buildLayerMentionSuggestion } from "@/lib/layer-mention-suggestion"
import { MarkdownLayerMentionNodeView } from "@/components/canvas/markdown-layer-mention-node"
import { LayerTitleBar, LayerTitleText } from "@/components/canvas/layer-title-bar"
import { ResizeHandles } from "@/components/canvas/resize-handles"
import { DocumentCommentsExtension } from "@/lib/document-comments-extension"
import {
  encodeAnchor,
  getLineNumbers,
  getQuotedText,
} from "@/lib/document-comments"
import type { MarkdownLayerData } from "@/lib/types"

export interface InlineCommentDraft {
  documentId: string
  anchorStart: string
  anchorEnd: string
  quotedText: string
  lineFrom: number
  lineTo: number
  /** Where to anchor the composer's pin in canvas space — at the right edge
   *  of the doc tile, vertically aligned with the start of the selection. */
  canvasX: number
  canvasY: number
}

/** Forces every doc to start with a heading — that heading is the title.
 *  Body blocks follow. Mirrors how Notion's page model is shaped: there's
 *  always a title slot at the top, body comes after. */
const DocumentWithTitle = Document.extend({
  content: "heading block*",
})

/** Enter inside the title shouldn't split it into a second heading (the
 *  default ProseMirror behavior would leave you with two H1s, the second
 *  empty). Match Notion: drop the cursor into a new paragraph below. */
const TitleEnterBehavior = Extension.create({
  name: "titleEnterBehavior",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if ($from.depth < 1) return false
        // Only intercept when the cursor is inside the doc's first child —
        // the title heading. Body headings keep the default split behavior.
        if ($from.index(0) !== 0) return false
        if (!empty) return false
        const titleEnd = $from.after(1)
        // Use the existing paragraph below (created on doc seed) when the
        // title is the only block; otherwise insert one and land on it.
        const after = state.doc.resolve(titleEnd).nodeAfter
        if (after && after.type.name === "paragraph") {
          return this.editor.chain().setTextSelection(titleEnd + 1).focus().run()
        }
        return this.editor
          .chain()
          .insertContentAt(titleEnd, { type: "paragraph" })
          .setTextSelection(titleEnd + 1)
          .focus()
          .run()
      },
    }
  },
})

interface MarkdownLayerProps {
  layer: MarkdownLayerData
  zoom: number
  selected: boolean
  multiSelected: boolean
  editing: boolean
  spaceHeld: boolean
  userName: string
  userColor: string
  /** Notify the canvas when this doc's editor instance is created/destroyed
   *  so threads anchored inside the doc can find their highlight target. */
  onEditorReady?: (id: string, editor: Editor | null) => void
  /** User clicked the inline "Comment" button on a non-empty selection. */
  onStartInlineComment?: (draft: InlineCommentDraft) => void
  /** User clicked an existing inline-comment highlight inside the doc. */
  onSelectInlineThread?: (threadId: string) => void
  /**
   * Absolute world-space position of this layer's top-left. Layers render as
   * flat, absolutely-positioned siblings (not nested in a per-group flex row),
   * so moving one between groups never reparents its React subtree — the
   * TipTap editor isn't remounted. Position comes from
   * `effectiveIframeLayerLayouts` and already bakes in the pop-out offset.
   */
  worldX: number
  worldY: number
  /** Paint order, projected from the group's sidebar position (higher = on top). */
  zIndex?: number
  /** In-flow reorder translate, applied when this doc is being dragged in-flow. */
  dragTranslateX?: number
  dragTranslateY?: number
  /** True while this doc is the one being "popped" out at the cursor; its
   *  float position is baked into `worldX/worldY`. */
  dragPopped?: boolean
  /** Group display name — only set on the leftmost member of a multi-member group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color, frame
   *  highlight, and click behavior (clicks are a no-op while the group owns
   *  the selection — same as IframeLayer). */
  groupSelected?: boolean
  /** Click handler for the group label. */
  onSelectGroup?: (shiftKey: boolean) => void
  /** Inline rename for the group label. */
  onRenameGroup?: (next: string) => void
  /**
   * Ask the canvas to start a reorder drag from this doc's title bar. Returns
   * `true` for multi-member groups (canvas owns the gesture), `false` for
   * single-member groups so the caller falls back to a regular group-move drag.
   */
  onRequestReorderDrag?: (layerId: string, e: React.PointerEvent) => boolean
  onSelect: (id: string, shiftKey: boolean) => void
  /** Move the parent group by (dx, dy) — same contract as IframeLayer.onMoveGroup. */
  onMoveGroup: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean,
  ) => void
  onMoveSelected: (
    dx: number,
    dy: number,
    totalDx: number,
    totalDy: number,
    metaKey: boolean,
  ) => void
  /** Fires once when a group-move drag begins (after the move threshold). */
  onGroupDragStart?: () => void
  /** Fires once when a group-move drag ends. metaKey is the cmd state at release. */
  onGroupDragEnd?: (metaKey: boolean) => void
  /** Adjust this doc's own width/height; the group anchor (x/y) shifts in the
   *  parent when the drag came from the left/top edge. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onTitleChange: (id: string, title: string) => void
  /** Inline rename from the title bar. Unlike `onTitleChange` (cache-only,
   *  driven by the editor) this must also write into the editor's first
   *  heading so every peer's view updates. */
  onRename?: (id: string, title: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
}

/**
 * A Notion-style document tile rendered as a flex child of its parent
 * IframeLayerGroup — exactly the same positioning model as IframeLayer, so docs
 * and frames mix seamlessly inside a group's row. Body content is a TipTap
 * editor bound to a Yjs XmlFragment (`markdown-layer-${id}`), so editing is
 * collaborative with live remote cursors.
 */
export function MarkdownLayer({
  layer,
  zoom,
  selected,
  multiSelected,
  editing,
  spaceHeld,
  userName,
  userColor,
  worldX,
  worldY,
  zIndex,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  groupLabel,
  groupSelected,
  onSelectGroup,
  onRenameGroup,
  onRequestReorderDrag,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onGroupDragStart,
  onGroupDragEnd,
  onResize,
  onTitleChange,
  onRename,
  onStartEdit,
  onStopEdit,
  onEditorReady,
  onStartInlineComment,
  onSelectInlineThread,
}: MarkdownLayerProps) {
  const { awareness } = useYjs()
  const provider = useMemo(() => ({ awareness }), [awareness])
  const fragment = useDocumentFragment(layer.id)
  const rootRef = useRef<HTMLDivElement>(null)

  // Mention suggestion needs the live layer lists every keystroke, but the
  // editor closes over its initial config. Funnel through refs so the
  // popover always reflects the current titles and excludes self-references.
  const markdownLayers = useMarkdownLayers()
  const markdownLayersRef = useRef<MarkdownLayerData[]>(markdownLayers)
  const layerIdRef = useRef(layer.id)

  // Title cache lives on `MarkdownLayerData.title` — sidebar rows, mentions,
  // agent context all read it. The editor's first heading is the source of
  // truth; this callback is what writes derived title text back to the cache.
  // Stash on a ref so the editor closure doesn't capture a stale handler.
  const onTitleChangeRef = useRef(onTitleChange)
  const titleCacheRef = useRef(layer.title)

  // Refresh the editor-facing refs after each commit (never during render).
  // The editor closes over its initial config, so these refs are how the
  // mention popover and title-writeback see current values every keystroke.
  useEffect(() => {
    markdownLayersRef.current = markdownLayers
    layerIdRef.current = layer.id
    onTitleChangeRef.current = onTitleChange
    titleCacheRef.current = layer.title
  })

  // Coords of the double-click that started edit mode, captured so the next
  // focus effect can land the cursor where the user clicked instead of at
  // the doc's end. Cleared after one consumption.
  const pendingFocusCoordsRef = useRef<{ left: number; top: number } | null>(
    null,
  )

  // Latest non-empty selection inside the editor, used to drive the inline
  // "Comment" bubble button. The pos pair survives editor blur (which would
  // otherwise clear the selection on click) so the click handler can encode
  // anchors against the still-fresh range.
  const pendingSelectionRef = useRef<{ from: number; to: number } | null>(
    null,
  )
  const [bubbleAnchor, setBubbleAnchor] = useState<
    { left: number; top: number } | null
  >(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // Portal target lives outside the world transform so the bubble can sit
  // above the SelectionOverlay (z-30 sibling vs. the TransformWrapper's
  // stacking context, where an internal z-index would be capped). Resolved
  // lazily during render — it's only read once `bubbleAnchor` is set by a user
  // interaction, well after the ancestor portal node has mounted, and
  // getElementById returns a stable node reference so dependents don't churn.
  const bubblePortalTarget =
    typeof document !== "undefined"
      ? document.getElementById("inline-comment-bubble-portal")
      : null

  const onSelectInlineThreadRef = useRef(onSelectInlineThread)
  useEffect(() => {
    onSelectInlineThreadRef.current = onSelectInlineThread
  })

  const editor = useEditor(
    {
      extensions: [
        // Disable StarterKit's TrailingNode: it auto-appends an empty node
        // of the schema's default type at the end of the doc, and our
        // schema (`heading block*`) makes that default a heading — leaving
        // an invisible trailing H1 stuck at the bottom of every doc.
        StarterKit.configure({
          undoRedo: false,
          document: false,
          trailingNode: false,
        }),
        DocumentWithTitle,
        TitleEnterBehavior,
        Placeholder.configure({
          // Only the title slot gets a placeholder — empty body blocks stay
          // visually quiet (no "Type heading…" hint), matching Notion.
          placeholder: ({ pos }) => (pos === 0 ? "Untitled" : ""),
          showOnlyCurrent: false,
          // Show "Untitled" on the canvas tile even when the editor is in
          // read-only (non-editing) mode — without this the placeholder is
          // suppressed unless the user has double-clicked into the doc.
          showOnlyWhenEditable: false,
          includeChildren: false,
        }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider,
          user: { name: userName || "Anonymous", color: userColor },
        }),
        Mention.extend({
          addNodeView() {
            return ReactNodeViewRenderer(MarkdownLayerMentionNodeView, {
              as: "span",
            })
          },
          addAttributes() {
            return {
              ...this.parent?.(),
              kind: {
                default: "markdown-layer",
                parseHTML: (el) => el.getAttribute("data-kind") ?? "markdown-layer",
                renderHTML: (attrs) =>
                  attrs.kind ? { "data-kind": attrs.kind as string } : {},
              },
            }
          },
        }).configure({
          HTMLAttributes: {
            class:
              "mention-doc-pill inline-block rounded bg-primary/10 px-1 py-0.5 text-[0.95em] leading-none text-primary no-underline",
          },
          renderText({ node }) {
            const label = (node.attrs.label as string | undefined) ?? node.attrs.id
            return `@${label}`
          },
          renderHTML({ options, node }) {
            const label =
              (node.attrs.label as string | undefined) ?? (node.attrs.id as string)
            return ["span", options.HTMLAttributes, label]
          },
          deleteTriggerWithBackspace: true,
          // These getters read refs, but TipTap only invokes them while the
          // user types (suggestion lookup) — never during render — so the
          // deferred ref access is safe. The lint rule can't see that the
          // closures are deferred past render, so it's suppressed here.
          // eslint-disable-next-line react-hooks/refs
          suggestion: buildLayerMentionSuggestion({
            getMarkdownLayers: () => markdownLayersRef.current,
            getExcludeId: () => layerIdRef.current,
            getAnchorRect: () =>
              rootRef.current?.getBoundingClientRect() ?? null,
          }),
        }),
        // onSelectThread reads a ref, but TipTap only invokes it when a
        // comment thread is clicked, never during render — the deferred ref
        // access is safe and the rule can't see that.
        // eslint-disable-next-line react-hooks/refs
        DocumentCommentsExtension.configure({
          onSelectThread: (threadId) =>
            onSelectInlineThreadRef.current?.(threadId),
        }),
      ],
      editable: editing,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "tiptap tiptap-document prose prose-sm dark:prose-invert max-w-none focus:outline-none",
        },
      },
    },
    [fragment, provider],
  )

  // Keep the cached title (sidebar/mention label) in sync with the editor's
  // first heading. Debounced so a flurry of keystrokes only writes once;
  // idempotent so it's safe for every connected client to run — the LWW
  // collection skips writes that match the current value.
  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const sync = () => {
      const first = editor.state.doc.firstChild
      const headingText =
        first && first.type.name === "heading" ? first.textContent : ""
      if (headingText === titleCacheRef.current) return
      onTitleChangeRef.current(layerIdRef.current, headingText)
    }
    const onUpdate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(sync, 200)
    }
    editor.on("update", onUpdate)
    sync()
    return () => {
      if (timer) clearTimeout(timer)
      editor.off("update", onUpdate)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editing)
    if (editing) {
      const coords = pendingFocusCoordsRef.current
      pendingFocusCoordsRef.current = null
      requestAnimationFrame(() => {
        if (coords) {
          const hit = editor.view.posAtCoords(coords)
          if (hit) {
            editor.chain().focus().setTextSelection(hit.pos).run()
            return
          }
        }
        editor.commands.focus("end")
      })
    }
  }, [editing, editor])

  useEffect(() => {
    if (!editor) return
    editor.commands.updateUser({
      name: userName || "Anonymous",
      color: userColor,
    })
  }, [editor, userName, userColor])

  // Register / unregister the editor with the canvas so doc-anchored
  // threads can paint highlights and project pins to the right margin.
  useEffect(() => {
    if (!editor || !onEditorReady) return
    onEditorReady(layer.id, editor)
    return () => {
      onEditorReady(layer.id, null)
    }
  }, [editor, layer.id, onEditorReady])

  // Drive the inline "Comment" bubble: anchor a small floating button to the
  // start of any non-empty text selection. Local coords (relative to the
  // doc tile) so the wrapping `transform: scale(1/zoom)` keeps the button at
  // a constant screen size regardless of canvas zoom.
  //
  // Visibility is tied to selection emptiness only — *not* to focus. If we
  // hid the bubble on blur, mousing onto the button (which momentarily
  // shifts focus despite our preventDefault) would unmount it before the
  // click handler fires and the gesture would silently no-op.
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { from, to, empty } = editor.state.selection
      if (empty) {
        setBubbleAnchor(null)
        pendingSelectionRef.current = null
        return
      }
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const fromCoords = editor.view.coordsAtPos(from)
      const toCoords = editor.view.coordsAtPos(to)
      const localLeft = (fromCoords.left + toCoords.left) / 2 - rect.left
      const localTop = Math.min(fromCoords.top, toCoords.top) - rect.top
      // Convert from on-screen pixels back into pre-zoom layer coords so the
      // absolute-positioned button lines up regardless of canvas zoom (the
      // bounding rect we just measured is post-zoom).
      setBubbleAnchor({ left: localLeft / zoom, top: localTop / zoom })
      pendingSelectionRef.current = { from, to }
    }
    editor.on("selectionUpdate", update)
    update()
    return () => {
      editor.off("selectionUpdate", update)
    }
  }, [editor, zoom])

  // Keep the portaled bubble anchored to the start of the selection. The doc
  // tile lives inside the world transform (panning/zooming move it on
  // screen), but the bubble lives in screen space, so we re-read the tile's
  // client rect every frame and write the canvas-wrapper-relative offset
  // directly to the bubble's style.
  useEffect(() => {
    if (!bubbleAnchor || !editing || !bubblePortalTarget) return
    const canvasWrapper = document.querySelector<HTMLDivElement>("[data-canvas-wrapper]")
    if (!canvasWrapper) return
    let rafId = 0
    const tick = () => {
      const root = rootRef.current
      const bubble = bubbleRef.current
      if (root && bubble) {
        const rr = root.getBoundingClientRect()
        const cw = canvasWrapper.getBoundingClientRect()
        const x = rr.left - cw.left + bubbleAnchor.left * zoom
        const y = rr.top - cw.top + bubbleAnchor.top * zoom
        bubble.style.transform = `translate(${x}px, ${y}px)`
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [bubbleAnchor, editing, bubblePortalTarget, zoom])

  const handleStartInlineComment = useCallback(() => {
    if (!editor) return
    // Prefer the captured ref (set by selectionUpdate while the user was
    // actively selecting), fall back to the editor's live selection — that
    // handles edge cases where the ref hasn't been populated yet but the
    // selection is still alive on screen.
    const live = editor.state.selection
    const sel =
      pendingSelectionRef.current ??
      (live.from < live.to ? { from: live.from, to: live.to } : null)
    if (!sel) return
    const anchorStart = encodeAnchor(editor, sel.from)
    const anchorEnd = encodeAnchor(editor, sel.to)
    if (!anchorStart || !anchorEnd) return
    const quotedText = getQuotedText(editor.state.doc, sel.from, sel.to)
    const { lineFrom, lineTo } = getLineNumbers(
      editor.state.doc,
      sel.from,
      sel.to,
    )
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    const fromCoords = editor.view.coordsAtPos(sel.from)
    // Anchor the composer at the right edge of the doc tile, vertically
    // aligned with the top of the selection — same convention Google Docs
    // uses for thread pins so they don't cover the prose.
    const localTop = (fromCoords.top - rect.top) / zoom
    onStartInlineComment?.({
      documentId: layer.id,
      anchorStart,
      anchorEnd,
      quotedText,
      lineFrom,
      lineTo,
      canvasX: layer.width,
      canvasY: localTop,
    })
    setBubbleAnchor(null)
    pendingSelectionRef.current = null
  }, [editor, layer.id, layer.width, onStartInlineComment, zoom, setBubbleAnchor])

  useEffect(() => {
    if (!editing) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current) return
      const target = e.target as Node
      if (rootRef.current.contains(target)) return
      // The floating "Comment" bubble is portaled out of the doc's DOM tree
      // (so it can paint above the SelectionOverlay), but interactions with
      // it should not count as clicking outside the doc — that would blur
      // the editor and clear the selection before the click can fire.
      if (bubbleRef.current?.contains(target)) return
      onStopEdit()
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
  }, [editing, onStopEdit])

  // Wheel inside a doc should scroll the doc, not pan the canvas. The canvas
  // attaches a non-passive wheel listener on its wrapper that always
  // preventDefaults, so we stop propagation here before the event reaches it.
  // Cmd/Ctrl+wheel falls through so the canvas can still zoom from inside a
  // doc. We swallow horizontal/vertical scroll regardless of whether the
  // doc currently overflows — interactions inside a doc shouldn't move the
  // surrounding canvas.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.stopPropagation()
    }
    root.addEventListener("wheel", onWheel)
    return () => root.removeEventListener("wheel", onWheel)
  }, [])

  const handleDrag = useCallback(
    (
      dx: number,
      dy: number,
      totalDx: number,
      totalDy: number,
      metaKey: boolean,
    ) => {
      if (selected) onMoveSelected(dx, dy, totalDx, totalDy, metaKey)
      else onMoveGroup(dx, dy, totalDx, totalDy, metaKey)
    },
    [selected, onMoveGroup, onMoveSelected],
  )

  const selectedOnPointerDown = useRef(false)

  // Same as the body's drag, but a release without movement does NOT fall
  // back to selecting this doc — the group label's pointerdown already
  // applied the group selection.
  const groupLabelDragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
  })

  const dragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onDragStart: onGroupDragStart,
    onDragEnd: onGroupDragEnd,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(layer.id, e.shiftKey)
    },
  })

  // Each gesture's deltas need to operate on the doc's size at the start of
  // the drag, not the live (already-shrunk) size — otherwise hitting the
  // minimum makes subsequent moves act on the clamped value. Same pattern
  // as IframeLayer's resize accumulator.
  const resizeStartRef = useRef<{ w: number; h: number } | null>(null)

  const handleResize = useCallback(
    (
      _edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      onResize(layer.id, dx, dy, dw, dh)
    },
    [layer.id, onResize],
  )

  const { makeHandleProps } = useIframeLayerResize({
    zoom,
    onResize: handleResize,
    onResizeStart: () => {
      resizeStartRef.current = { w: layer.width, h: layer.height }
    },
    onResizeEnd: () => {
      resizeStartRef.current = null
    },
  })

  // Flat, absolutely-positioned in world space (see `worldX/worldY`). A
  // non-popped reorder drag layers `dragTranslate{X,Y}` on as a transform so
  // the lifted doc tracks the cursor; popped position is baked into worldX/Y.
  const transform =
    dragTranslateX || dragTranslateY
      ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
      : undefined

  return (
    <div
      id={`markdown-layer-${layer.id}`}
      ref={rootRef}
      data-markdown-layer
      data-doc-id={layer.id}
      // No overflow-hidden on the root — the group label sits above the tile
      // via `bottom-full` and would be clipped. Match IframeLayer, which keeps
      // its outer root open and pushes overflow clipping to the inner body.
      // Inner clipping happens on `data-markdown-layer-scroll` (overflow-y-auto)
      // and the body padding constrains horizontal layout.
      className="absolute flex flex-col rounded-md bg-background"
      style={{
        width: layer.width,
        height: layer.height,
        left: worldX,
        top: worldY,
        transform,
        // Dragged/popped doc floats above siblings; otherwise paint order
        // follows the group's sidebar position.
        zIndex: dragPopped || dragTranslateX != null || dragTranslateY != null ? 9999 : zIndex,
        // The lifted doc is non-interactive so drop hit-testing falls through;
        // otherwise the tile catches its own events.
        pointerEvents:
          dragPopped || dragTranslateX != null || dragTranslateY != null ? "none" : "auto",
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        pendingFocusCoordsRef.current = { left: e.clientX, top: e.clientY }
        onStartEdit(layer.id)
      }}
    >
      <LayerTitleBar
        layerId={layer.id}
        layerWidth={layer.width}
        zoom={zoom}
        dragHandlers={spaceHeld ? undefined : dragHandlers}
        onRequestReorderDrag={spaceHeld ? undefined : onRequestReorderDrag}
        groupLabel={groupLabel}
        groupSelected={groupSelected}
        onSelectGroup={onSelectGroup}
        onRenameGroup={onRenameGroup}
        groupLabelDragHandlers={spaceHeld ? undefined : groupLabelDragHandlers}
        reorderDragTranslateX={dragTranslateX}
        reorderDragTranslateY={dragTranslateY}
        reorderDragPopped={dragPopped}
      >
        {/* Flex-row wrapper with an explicit max-width so `truncate` on the
         *  title span has something to clip against — without it, the
         *  LayerTitleBar's `items-start` lets the child size to its (nowrap)
         *  content and the title runs past the tile's right edge. Mirrors
         *  the equivalent row in IframeLayerLabel. */}
        <div
          className="flex min-h-[18px] items-center max-w-full"
          style={{ maxWidth: layer.width * zoom }}
        >
          <LayerTitleText
            title={layer.title}
            placeholder="Untitled"
            selected={selected || groupSelected}
            onSelectLayer={(shiftKey) => {
              // Defer to the group's selection while the group is selected
              // (shift drills through to additive doc selection). Mirrors
              // IframeLayerLabel.onSelectFrame.
              if (selected && !shiftKey) return
              if (groupSelected && !shiftKey) return
              selectedOnPointerDown.current = true
              onSelect(layer.id, shiftKey)
            }}
            onRename={onRename ? (next) => onRename(layer.id, next) : undefined}
          />
        </div>
      </LayerTitleBar>
      {/* The title bar above is purely a display/drag affordance — the
       *  source of truth is still the editor's first heading, which is the
       *  cached `layer.title` field. The wrapper below holds the editor
       *  itself (title heading + body) in a Notion-style stacked surface. */}
      <div data-markdown-layer-scroll className="relative flex-1 overflow-y-auto">
        <div
          // `relative` + `z-10` lifts the editor above the layer-selection
          // overlay below so comment-highlight spans (which set their own
          // `pointer-events: auto`) sit on top and catch clicks even when
          // the doc isn't being edited. Empty editor space stays
          // `pointer-events: none`, falling through to the overlay so
          // clicking blank prose still selects/drags the doc tile.
          className="relative z-10 px-6 py-5"
          style={{ pointerEvents: editing ? "auto" : "none" }}
        >
          <EditorContent editor={editor} />
        </div>

        {!editing && (
          <div
            className="absolute inset-0 touch-none"
            style={{ cursor: "inherit" }}
            onPointerDownCapture={(e) => {
              if (e.button === 0 && !spaceHeld) {
                selectedOnPointerDown.current = false
                // While the parent group owns the selection, plain clicks on
                // the doc are a no-op (matches IframeLayer). Shift still drills
                // through so the user can additively pick this member.
                if (groupSelected && !e.shiftKey) return
                if (!selected || e.shiftKey) {
                  selectedOnPointerDown.current = true
                  onSelect(layer.id, e.shiftKey)
                }
              }
            }}
            {...(spaceHeld ? {} : dragHandlers)}
          />
        )}
      </div>

      {selected && !multiSelected && !editing && (
        <ResizeHandles zoom={zoom} makeHandleProps={makeHandleProps} />
      )}

      {bubbleAnchor && editing && bubblePortalTarget && createPortal(
        // Floating "Comment" button anchored above the start of the user's
        // selection — Google-Docs style. Portaled out of the world transform
        // so it sits above the SelectionOverlay (see canvas.tsx for the
        // portal target). Positioned every frame by the rAF loop above
        // (translate is set imperatively from the tile's client rect), so
        // it tracks pan/zoom/drag without needing inverse-scale tricks.
        // mousedown is preventDefaulted so clicking the button doesn't
        // blur the editor (mousedown is what shifts focus in browsers;
        // pointerdown alone isn't enough). The button also fires on
        // mousedown rather than click so the gesture completes before any
        // later focus/selection event has a chance to tear down the bubble.
        <div
          ref={bubbleRef}
          className="pointer-events-none absolute left-0 top-0"
        >
          <div
            className="pointer-events-auto"
            style={{
              transform: "translate(-50%, -100%) translateY(-6px)",
              transformOrigin: "bottom center",
            }}
          >
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleStartInlineComment()
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-black/10 hover:bg-neutral-800"
            >
              <MessageSquare className="size-3.5" />
              Comment
            </button>
          </div>
        </div>,
        bubblePortalTarget,
      )}
    </div>
  )
}

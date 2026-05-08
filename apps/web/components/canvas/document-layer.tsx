"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react"
import { Extension } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import Mention from "@tiptap/extension-mention"
import Placeholder from "@tiptap/extension-placeholder"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { useDocumentFragment, useYjs } from "@/lib/yjs/context"
import { useDocumentLayers } from "@/lib/yjs/react"
import { buildDocumentMentionSuggestion } from "@/lib/document-mention-suggestion"
import { DocumentMentionNodeView } from "@/components/canvas/document-mention-node"
import { GroupLabel } from "@/components/canvas/group-label"
import { ResizeHandles } from "@/components/canvas/resize-handles"
import type { DocumentLayerData } from "@/lib/types"

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

interface DocumentLayerProps {
  layer: DocumentLayerData
  zoom: number
  selected: boolean
  multiSelected: boolean
  editing: boolean
  spaceHeld: boolean
  userName: string
  userColor: string
  /** Visual order within the parent ArtboardGroup's flex flow. */
  flexOrder?: number
  /** Reorder-drag translate, applied when this doc is being dragged in-flow. */
  dragTranslateX?: number
  dragTranslateY?: number
  /** When the user holds meta to "pop" this doc out of its group, the
   *  ArtboardGroup parent feeds back a position so it floats at the cursor. */
  dragPopped?: { left: number; top: number }
  /** Group display name — only set on the leftmost member of a multi-member group. */
  groupLabel?: string
  /** True when the parent group is selected. Drives label color, frame
   *  highlight, and click behavior (clicks are a no-op while the group owns
   *  the selection — same as Artboard). */
  groupSelected?: boolean
  /** Click handler for the group label. */
  onSelectGroup?: (shiftKey: boolean) => void
  onSelect: (id: string, shiftKey: boolean) => void
  /** Move the parent group by (dx, dy) — same contract as Artboard.onMoveGroup. */
  onMoveGroup: (dx: number, dy: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  /** Adjust this doc's own width/height; the group anchor (x/y) shifts in the
   *  parent when the drag came from the left/top edge. */
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onTitleChange: (id: string, title: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
}

/**
 * A Notion-style document tile rendered as a flex child of its parent
 * ArtboardGroup — exactly the same positioning model as Artboard, so docs
 * and frames mix seamlessly inside a group's row. Body content is a TipTap
 * editor bound to a Yjs XmlFragment (`doc-${id}`), so editing is
 * collaborative with live remote cursors.
 */
export function DocumentLayer({
  layer,
  zoom,
  selected,
  multiSelected,
  editing,
  spaceHeld,
  userName,
  userColor,
  flexOrder,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  groupLabel,
  groupSelected,
  onSelectGroup,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onResize,
  onTitleChange,
  onStartEdit,
  onStopEdit,
}: DocumentLayerProps) {
  const { awareness } = useYjs()
  const provider = useMemo(() => ({ awareness }), [awareness])
  const fragment = useDocumentFragment(layer.id)
  const rootRef = useRef<HTMLDivElement>(null)

  // Mention suggestion needs the live document list every keystroke, but the
  // editor closes over its initial config. Funnel through refs so the
  // popover always reflects the current titles and excludes self-references.
  const documentLayers = useDocumentLayers()
  const documentLayersRef = useRef<DocumentLayerData[]>(documentLayers)
  documentLayersRef.current = documentLayers
  const layerIdRef = useRef(layer.id)
  layerIdRef.current = layer.id

  // Title cache lives on `DocumentLayerData.title` — sidebar rows, mentions,
  // agent context all read it. The editor's first heading is the source of
  // truth; this callback is what writes derived title text back to the cache.
  // Stash on a ref so the editor closure doesn't capture a stale handler.
  const onTitleChangeRef = useRef(onTitleChange)
  onTitleChangeRef.current = onTitleChange
  const titleCacheRef = useRef(layer.title)
  titleCacheRef.current = layer.title

  // Coords of the double-click that started edit mode, captured so the next
  // focus effect can land the cursor where the user clicked instead of at
  // the doc's end. Cleared after one consumption.
  const pendingFocusCoordsRef = useRef<{ left: number; top: number } | null>(
    null,
  )

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
            return ReactNodeViewRenderer(DocumentMentionNodeView, {
              as: "span",
            })
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
          suggestion: buildDocumentMentionSuggestion({
            getDocuments: () => documentLayersRef.current,
            getExcludeId: () => layerIdRef.current,
            getAnchorRect: () =>
              rootRef.current?.getBoundingClientRect() ?? null,
          }),
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

  useEffect(() => {
    if (!editing) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) {
        onStopEdit()
      }
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
    (dx: number, dy: number) => {
      if (selected) onMoveSelected(dx, dy)
      else onMoveGroup(dx, dy)
    },
    [selected, onMoveGroup, onMoveSelected],
  )

  const selectedOnPointerDown = useRef(false)

  const dragHandlers = useArtboardDrag({
    zoom,
    onDrag: handleDrag,
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
  // as Artboard's resize accumulator.
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

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
    onResizeStart: () => {
      resizeStartRef.current = { w: layer.width, h: layer.height }
    },
    onResizeEnd: () => {
      resizeStartRef.current = null
    },
  })

  // When the user holds meta to pop the doc out of its group, the parent
  // ArtboardGroup absolutely-positions us at the cursor; otherwise we sit
  // in the flex flow and `dragTranslate{X,Y}` is layered on as a transform
  // during a non-popped reorder drag.
  const transform =
    dragTranslateX || dragTranslateY
      ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
      : undefined

  return (
    <div
      id={`document-layer-${layer.id}`}
      ref={rootRef}
      data-document-layer
      data-doc-id={layer.id}
      // No overflow-hidden on the root — the group label sits above the tile
      // via `bottom-full` and would be clipped. Match Artboard, which keeps
      // its outer root open and pushes overflow clipping to the inner body.
      // Inner clipping happens on `data-document-scroll` (overflow-y-auto)
      // and the body padding constrains horizontal layout.
      className="relative flex flex-col rounded-md bg-background"
      style={{
        width: layer.width,
        height: layer.height,
        order: flexOrder,
        position: dragPopped ? "absolute" : undefined,
        left: dragPopped?.left,
        top: dragPopped?.top,
        transform,
        flexShrink: 0,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        pendingFocusCoordsRef.current = { left: e.clientX, top: e.clientY }
        onStartEdit(layer.id)
      }}
    >
      {groupLabel && (
        // Mirror Artboard's label placement: anchored above the tile, scaled
        // to stay constant in screen pixels regardless of zoom. The drag
        // handlers are spread here so dragging the label moves the parent
        // group — same affordance as Artboard's label region.
        <div
          className="absolute bottom-full left-0 flex flex-col items-start whitespace-nowrap"
          style={{
            transform: `scale(${1 / zoom})`,
            transformOrigin: "bottom left",
            maxWidth: layer.width * zoom,
            marginBottom: 4 / zoom,
          }}
          {...(spaceHeld ? {} : dragHandlers)}
        >
          <GroupLabel
            label={groupLabel}
            groupSelected={groupSelected}
            onSelectGroup={onSelectGroup}
          />
        </div>
      )}
      {/* Title is the editor's first heading; body follows in the same
       *  editor surface (Notion-style — no separate title bar). */}
      <div data-document-scroll className="relative flex-1 overflow-y-auto">
        <div
          className="px-6 py-5"
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
                // the doc are a no-op (matches Artboard). Shift still drills
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
    </div>
  )
}

"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import Mention from "@tiptap/extension-mention"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { useDocumentFragment, useYjs } from "@/lib/yjs/context"
import { useDocumentLayers } from "@/lib/yjs/react"
import { buildDocumentMentionSuggestion } from "@/lib/document-mention-suggestion"
import type { DocumentLayerData } from "@/lib/types"

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

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider,
          user: { name: userName || "Anonymous", color: userColor },
        }),
        Mention.configure({
          HTMLAttributes: {
            class:
              "inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-primary no-underline",
          },
          renderText({ node }) {
            const label = (node.attrs.label as string | undefined) ?? node.attrs.id
            return `@${label}`
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
            "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none",
        },
      },
    },
    [fragment, provider],
  )

  useEffect(() => {
    if (!editor) return
    editor.setEditable(editing)
    if (editing) {
      requestAnimationFrame(() => {
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

  const HANDLE = 6 / zoom
  const hHalf = HANDLE / 2

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
      className="flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm"
      style={{
        width: layer.width,
        height: layer.height,
        order: flexOrder,
        position: dragPopped ? "absolute" : undefined,
        left: dragPopped?.left,
        top: dragPopped?.top,
        transform,
        outline: selected ? "1px solid #d946ef" : undefined,
        outlineOffset: selected ? `${1 / zoom}px` : undefined,
        flexShrink: 0,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onStartEdit(layer.id)
      }}
    >
      {/* Title */}
      <div className="border-b border-border px-4 py-2">
        <input
          type="text"
          value={layer.title}
          onChange={(e) => onTitleChange(layer.id, e.target.value)}
          onPointerDown={(e) => {
            if (editing) e.stopPropagation()
          }}
          onFocus={() => onStartEdit(layer.id)}
          placeholder="Untitled"
          className="w-full bg-transparent text-base font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-default"
          disabled={!editing}
          readOnly={!editing}
        />
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-y-auto">
        <div
          className="px-4 py-3"
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
        <>
          {/* Edge handles */}
          <div
            className="absolute cursor-ns-resize touch-none"
            {...makeHandleProps("n")}
            style={{ top: -hHalf, left: 0, right: 0, height: HANDLE }}
          />
          <div
            className="absolute cursor-ns-resize touch-none"
            {...makeHandleProps("s")}
            style={{ bottom: -hHalf, left: 0, right: 0, height: HANDLE }}
          />
          <div
            className="absolute cursor-ew-resize touch-none"
            {...makeHandleProps("w")}
            style={{ left: -hHalf, top: 0, bottom: 0, width: HANDLE }}
          />
          <div
            className="absolute cursor-ew-resize touch-none"
            {...makeHandleProps("e")}
            style={{ right: -hHalf, top: 0, bottom: 0, width: HANDLE }}
          />
          <div
            className="absolute cursor-nwse-resize touch-none"
            {...makeHandleProps("nw")}
            style={{ top: -hHalf, left: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nesw-resize touch-none"
            {...makeHandleProps("ne")}
            style={{ top: -hHalf, right: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nesw-resize touch-none"
            {...makeHandleProps("sw")}
            style={{ bottom: -hHalf, left: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nwse-resize touch-none"
            {...makeHandleProps("se")}
            style={{ bottom: -hHalf, right: -hHalf, width: HANDLE, height: HANDLE }}
          />
        </>
      )}
    </div>
  )
}

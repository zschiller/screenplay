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
  onSelect: (id: string, shiftKey: boolean) => void
  onMove: (id: string, x: number, y: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  onResize: (id: string, x: number, y: number, width: number, height: number) => void
  onTitleChange: (id: string, title: string) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
}

export function DocumentLayer({
  layer,
  zoom,
  selected,
  multiSelected,
  editing,
  spaceHeld,
  userName,
  userColor,
  onSelect,
  onMove,
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

  // The Mention extension's suggestion callback closes over its initial value,
  // so route the live document list through a ref to get fresh titles every
  // keystroke. Excludes this document so it can't @-mention itself.
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
      if (selected) {
        onMoveSelected(dx, dy)
      } else {
        onMove(layer.id, layer.x + dx, layer.y + dy)
      }
    },
    [layer.id, layer.x, layer.y, selected, onMove, onMoveSelected],
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

  // Track committed dimensions across resize handle pointer events. Reset on
  // every pointerdown so a follow-up resize starts from the current layout
  // rather than the stale value from the previous drag. Lazily initialized
  // from `layer.*` on the first move tick — same pattern as text-layer's
  // `resizeWidthRef`, which keeps the inline pointer handlers free of
  // prop reads during render.
  const resizeStateRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const handleResize = useCallback(
    (
      _edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      if (resizeStateRef.current == null) {
        resizeStateRef.current = {
          x: layer.x,
          y: layer.y,
          w: layer.width,
          h: layer.height,
        }
      }
      const start = resizeStateRef.current
      const minW = 200
      const minH = 120
      let nextW = start.w + dw
      let nextH = start.h + dh
      let nextX = start.x + dx
      let nextY = start.y + dy
      if (nextW < minW) {
        if (dx !== 0) nextX = start.x + (start.w - minW)
        nextW = minW
      }
      if (nextH < minH) {
        if (dy !== 0) nextY = start.y + (start.h - minH)
        nextH = minH
      }
      resizeStateRef.current = { x: nextX, y: nextY, w: nextW, h: nextH }
      onResize(layer.id, Math.round(nextX), Math.round(nextY), Math.round(nextW), Math.round(nextH))
    },
    [layer.id, layer.x, layer.y, layer.width, layer.height, onResize],
  )

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
  })

  const wrapHandleProps = (side: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw") => {
    const props = makeHandleProps(side)
    return {
      ...props,
      onPointerDown: (e: React.PointerEvent) => {
        resizeStateRef.current = null
        props.onPointerDown(e)
      },
      onPointerUp: (e: React.PointerEvent) => {
        resizeStateRef.current = null
        props.onPointerUp(e)
      },
    }
  }

  const HANDLE = 6 / zoom
  const hHalf = HANDLE / 2

  return (
    <div
      id={`document-layer-${layer.id}`}
      ref={rootRef}
      data-document-layer
      data-doc-id={layer.id}
      className="absolute flex flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm"
      style={{
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        outline: selected ? "1px solid #d946ef" : undefined,
        outlineOffset: selected ? `${1 / zoom}px` : undefined,
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
            {...wrapHandleProps("n")}
            style={{ top: -hHalf, left: 0, right: 0, height: HANDLE }}
          />
          <div
            className="absolute cursor-ns-resize touch-none"
            {...wrapHandleProps("s")}
            style={{ bottom: -hHalf, left: 0, right: 0, height: HANDLE }}
          />
          <div
            className="absolute cursor-ew-resize touch-none"
            {...wrapHandleProps("w")}
            style={{ left: -hHalf, top: 0, bottom: 0, width: HANDLE }}
          />
          <div
            className="absolute cursor-ew-resize touch-none"
            {...wrapHandleProps("e")}
            style={{ right: -hHalf, top: 0, bottom: 0, width: HANDLE }}
          />
          {/* Corner handles */}
          <div
            className="absolute cursor-nwse-resize touch-none"
            {...wrapHandleProps("nw")}
            style={{ top: -hHalf, left: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nesw-resize touch-none"
            {...wrapHandleProps("ne")}
            style={{ top: -hHalf, right: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nesw-resize touch-none"
            {...wrapHandleProps("sw")}
            style={{ bottom: -hHalf, left: -hHalf, width: HANDLE, height: HANDLE }}
          />
          <div
            className="absolute cursor-nwse-resize touch-none"
            {...wrapHandleProps("se")}
            style={{ bottom: -hHalf, right: -hHalf, width: HANDLE, height: HANDLE }}
          />
        </>
      )}
    </div>
  )
}

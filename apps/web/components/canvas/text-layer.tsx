"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import { ArrowRightFromLine, ArrowUp, ScanText } from "lucide-react"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { useTextFragment, useYjs } from "@/lib/yjs/context"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { BranchBadge } from "@/components/branch-badge"
import type { AgentData, TextLayerData, WorkspaceData } from "@/lib/liveblocks.types"

interface TextLayerProps {
  layer: TextLayerData
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
  onResize: (id: string, x: number, width: number) => void
  onSetAutoWidth: (id: string, autoWidth: boolean, width?: number) => void
  onStartEdit: (id: string) => void
  onStopEdit: () => void
  workspaces?: WorkspaceData[]
  agents?: AgentData[]
  onSubmitAsPlan?: (text: string, agentId: string) => void
}

export function TextLayer({
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
  onSetAutoWidth,
  onStartEdit,
  onStopEdit,
  workspaces,
  agents,
  onSubmitAsPlan,
}: TextLayerProps) {
  const [planPickerOpen, setPlanPickerOpen] = useState(false)
  // CollaborationCaret only consumes `provider.awareness`, so a thin shim
  // satisfies it without exposing host-specific provider types.
  const { awareness } = useYjs()
  const provider = useMemo(() => ({ awareness }), [awareness])
  const fragment = useTextFragment(layer.id)
  const rootRef = useRef<HTMLDivElement>(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider,
          user: { name: userName || "Anonymous", color: userColor },
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

  const resizeWidthRef = useRef<number | null>(null)

  const handleResize = useCallback(
    (dx: number, _dy: number, dw: number, _dh: number) => {
      if (resizeWidthRef.current == null) {
        const rect = rootRef.current?.getBoundingClientRect()
        resizeWidthRef.current = rect ? rect.width / zoom : layer.width
      }
      resizeWidthRef.current += dw
      const newWidth = Math.max(20, Math.ceil(resizeWidthRef.current))
      if (layer.autoWidth) {
        onSetAutoWidth(layer.id, false, newWidth)
      } else {
        onResize(layer.id, layer.x + dx, newWidth)
      }
    },
    [layer.id, layer.x, layer.width, layer.autoWidth, zoom, onResize, onSetAutoWidth],
  )

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
  })

  const wrapHandleProps = (side: "w" | "e") => {
    const props = makeHandleProps(side)
    return {
      ...props,
      onPointerDown: (e: React.PointerEvent) => {
        resizeWidthRef.current = null
        props.onPointerDown(e)
      },
      onPointerUp: (e: React.PointerEvent) => {
        resizeWidthRef.current = null
        props.onPointerUp(e)
      },
    }
  }

  const HANDLE = 6 / zoom
  const hHalf = HANDLE / 2

  const widthStyle = layer.autoWidth
    ? { width: "max-content" as const, maxWidth: 2000 }
    : { width: layer.width }

  return (
    <div
      id={`text-layer-${layer.id}`}
      ref={rootRef}
      data-text-layer
      className="absolute"
      style={{
        left: layer.x,
        top: layer.y,
        ...widthStyle,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onStartEdit(layer.id)
      }}
    >
      <div className="relative">
        <div style={{ pointerEvents: editing ? "auto" : "none" }}>
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

      {selected && !multiSelected && (
        <>
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
        </>
      )}

      {selected && !multiSelected && !editing && (
        <div
          className="absolute right-0 bottom-full flex items-center gap-1"
          style={{
            transform: `scale(${1 / zoom})`,
            transformOrigin: "bottom right",
            marginBottom: 4 / zoom,
          }}
        >
          {onSubmitAsPlan && workspaces && agents && (
            <Popover open={planPickerOpen} onOpenChange={setPlanPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-background px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                >
                  <ArrowUp className="h-3 w-3 shrink-0" />
                  <span>Send to Claude</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-0"
                side="bottom"
                align="end"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Command>
                  <CommandInput placeholder="Search branches..." />
                  <CommandList>
                    <CommandEmpty>No branches found.</CommandEmpty>
                    {workspaces
                      .slice()
                      .sort((a, b) => a.repoFullName.localeCompare(b.repoFullName))
                      .map((ws) => {
                        const wsAgents = agents
                          .filter((a) => a.workspaceId === ws.id)
                          .sort((a, b) => a.createdAt - b.createdAt)
                        if (wsAgents.length === 0) return null
                        return (
                          <CommandGroup key={ws.id} heading={ws.repoFullName}>
                            {wsAgents.map((agent) => (
                              <CommandItem
                                key={agent.id}
                                value={`${ws.repoFullName} ${agent.branch}`}
                                onSelect={() => {
                                  const text = editor?.getText().trim() ?? ""
                                  setPlanPickerOpen(false)
                                  if (text) onSubmitAsPlan(text, agent.id)
                                }}
                              >
                                <BranchBadge
                                  branch={agent.branch}
                                  colorKey={agent.id}
                                  className="text-[11px] py-0 px-1.5"
                                />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        )
                      })}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (layer.autoWidth) {
                const rect = rootRef.current?.getBoundingClientRect()
                const w = rect ? Math.ceil(rect.width / zoom) : layer.width
                onSetAutoWidth(layer.id, false, w)
              } else {
                onSetAutoWidth(layer.id, true)
              }
            }}
            title={layer.autoWidth ? "Switch to fixed width" : "Switch to auto width"}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
          >
            {layer.autoWidth ? (
              <ArrowRightFromLine className="h-3 w-3" />
            ) : (
              <ScanText className="h-3 w-3" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}

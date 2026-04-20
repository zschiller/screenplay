"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import { ArrowUp, WrapText } from "lucide-react"
import { useArtboardDrag } from "@/hooks/use-artboard-drag"
import { useArtboardResize } from "@/hooks/use-artboard-resize"
import { useTextFragment, useYjs } from "@/components/providers/yjs-provider"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
  const { provider } = useYjs()
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

  const handleResize = useCallback(
    (dx: number, _dy: number, dw: number, _dh: number) => {
      onResize(layer.id, layer.x + dx, layer.width + dw)
    },
    [layer.id, layer.x, layer.width, onResize],
  )

  const { makeHandleProps } = useArtboardResize({
    zoom,
    onResize: handleResize,
  })

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
        <EditorContent editor={editor} />

        {!editing && (
          <div
            className="absolute inset-0 cursor-default touch-none"
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

      {selected && !multiSelected && !layer.autoWidth && (
        <>
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
                  className="flex h-5 items-center gap-1 rounded-sm border border-border bg-background px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
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
                const w = rootRef.current?.offsetWidth ?? layer.width
                onSetAutoWidth(layer.id, false, w)
              } else {
                onSetAutoWidth(layer.id, true)
              }
            }}
            title={layer.autoWidth ? "Switch to fixed width" : "Switch to auto width"}
            className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
              layer.autoWidth
                ? "border-border bg-background text-muted-foreground hover:bg-muted"
                : "border-primary bg-primary text-primary-foreground"
            }`}
          >
            <WrapText className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

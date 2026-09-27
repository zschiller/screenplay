"use client"

import { FileText, Frame, MessageSquare, MousePointer2 } from "lucide-react"

import { IconButton } from "@workspace/ui/components/icon-button"

import { isLocalBuild } from "@/lib/local-mode"

import type { ToolModeController } from "./use-tool-mode"

/**
 * The bottom tool toolbar (PRD #571) — the Select / Frame / Document / Comment
 * mode-button pill pinned to the bottom-center of the canvas.
 *
 * Backed entirely by the Tool Mode controller (#567): each button reads one of
 * its boolean projections and dispatches one `set` / `toggle` intent, so mutual
 * exclusion holds by construction. The only other dependency is `onClearMode`,
 * the comment-placement reset the element-reference controller owns — kept out
 * of Tool Mode deliberately (it is comment sub-state, not an armed tool).
 */
export function CanvasToolbar({
  toolMode,
  onClearMode,
}: {
  toolMode: ToolModeController
  /** Reset the comment-placement sub-state (element-reference controller). */
  onClearMode: () => void
}) {
  const { frameMode, documentMode, commentMode } = toolMode
  return (
    <div className="pointer-events-none absolute bottom-0 left-1/2 z-(--z-canvas-chrome) flex h-12 -translate-x-1/2 items-center px-2">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5 [&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        <IconButton
          label="Select"
          shortcut="V"
          pressed={toolMode.isSelect}
          variant={toolMode.isSelect ? "default" : "ghost"}
          onClick={() => {
            toolMode.set("select")
            onClearMode()
          }}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Frame"
          shortcut="F"
          pressed={frameMode}
          variant={frameMode ? "default" : "ghost"}
          onClick={() => {
            toolMode.toggle("frame")
            onClearMode()
          }}
        >
          <Frame className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label="Document"
          shortcut="D"
          pressed={documentMode}
          variant={documentMode ? "default" : "ghost"}
          onClick={() => {
            toolMode.toggle("document")
            onClearMode()
          }}
        >
          <FileText className="h-3.5 w-3.5" />
        </IconButton>
        {/* Comment mode is web-only: it places multi-user comment
            threads. The local build has no persisted threads (#417) and
            its element→agent targeting now lives in the composer token
            path (#618), so there's no comment tool on desktop. */}
        {!isLocalBuild && (
          <IconButton
            label="Comment"
            shortcut="C"
            pressed={commentMode}
            variant={commentMode ? "default" : "ghost"}
            onClick={() => {
              toolMode.toggle("comment")
              onClearMode()
            }}
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  )
}

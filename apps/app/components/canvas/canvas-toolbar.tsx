"use client"

import { FileText, Frame, MessageSquare, MousePointer2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"

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
    <div className="pointer-events-none absolute bottom-0 left-1/2 z-[9998] flex h-12 -translate-x-1/2 items-center px-2">
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-lg bg-background p-1 shadow-md outline outline-1 outline-foreground/5"
        onClick={(e) => e.stopPropagation()}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={toolMode.isSelect ? "default" : "ghost"}
                size="icon-xs"
                onClick={() => {
                  toolMode.set("select")
                  onClearMode()
                }}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Select <Kbd>V</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={frameMode ? "default" : "ghost"}
                size="icon-xs"
                onClick={() => {
                  toolMode.toggle("frame")
                  onClearMode()
                }}
              >
                <Frame className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Frame <Kbd>F</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={documentMode ? "default" : "ghost"}
                size="icon-xs"
                onClick={() => {
                  toolMode.toggle("document")
                  onClearMode()
                }}
              >
                <FileText className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Document <Kbd>D</Kbd>
            </TooltipContent>
          </Tooltip>
          {/* Comment mode is web-only: it places multi-user comment
              threads. The local build has no persisted threads (#417) and
              its element→agent targeting now lives in the composer token
              path (#618), so there's no comment tool on desktop. */}
          {!isLocalBuild && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={commentMode ? "default" : "ghost"}
                  size="icon-xs"
                  onClick={() => {
                    toolMode.toggle("comment")
                    onClearMode()
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Comment <Kbd>C</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>
    </div>
  )
}

"use client"

import {
  ChatIcon,
  FileTextIcon,
  FrameCornersIcon,
  NavigationArrowIcon,
} from "@workspace/ui/components/icons"

import {
  FloatingToolbar,
  FloatingToolbarButton,
} from "@workspace/ui/components/floating-toolbar"

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
      <FloatingToolbar
        aria-label="Tools"
        className="[&>*]:animate-in [&>*]:duration-200 [&>*]:fade-in-0"
        onClick={(e) => e.stopPropagation()}
      >
        <FloatingToolbarButton
          label="Select"
          shortcut="V"
          pressed={toolMode.isSelect}
          onClick={() => {
            toolMode.set("select")
            onClearMode()
          }}
        >
          <NavigationArrowIcon />
        </FloatingToolbarButton>
        <FloatingToolbarButton
          label="Frame"
          shortcut="F"
          pressed={frameMode}
          onClick={() => {
            toolMode.toggle("frame")
            onClearMode()
          }}
        >
          <FrameCornersIcon />
        </FloatingToolbarButton>
        <FloatingToolbarButton
          label="Document"
          shortcut="D"
          pressed={documentMode}
          onClick={() => {
            toolMode.toggle("document")
            onClearMode()
          }}
        >
          <FileTextIcon />
        </FloatingToolbarButton>
        {/* Comment mode is web-only: it places multi-user comment
            threads. The local build has no persisted threads (#417) and
            its element→agent targeting now lives in the composer token
            path (#618), so there's no comment tool on desktop. */}
        {!isLocalBuild && (
          <FloatingToolbarButton
            label="Comment"
            shortcut="C"
            pressed={commentMode}
            onClick={() => {
              toolMode.toggle("comment")
              onClearMode()
            }}
          >
            <ChatIcon />
          </FloatingToolbarButton>
        )}
      </FloatingToolbar>
    </div>
  )
}

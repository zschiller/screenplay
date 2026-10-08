"use client"

import {
  ChatIcon,
  FileTextIcon,
  FrameCornersIcon,
  NavigationArrowIcon,
  ScribbleIcon,
} from "@workspace/ui/components/icons"

import {
  FloatingToolbar,
  FloatingToolbarButton,
} from "@workspace/ui/components/floating-toolbar"

import { commenting } from "@/lib/capabilities"

import type { ToolModeController } from "./use-tool-mode"

/** Why the Frame tool is off on a canvas with no repository. */
export const NO_REPOSITORY_HINT =
  "Frames run your app from a repository. Add one to preview it."

/**
 * The bottom tool toolbar (PRD #571) — the Select / Frame / Mockup / Document /
 * Comment mode-button pill pinned to the bottom-center of the canvas.
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
  const { frameMode, mockupMode, documentMode, commentMode } = toolMode
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
        {/* A frame shows a Workspace, so with no repository the tool is off;
            the tooltip still opens and says why. */}
        <FloatingToolbarButton
          label="Frame"
          shortcut={toolMode.frameAvailable ? "F" : undefined}
          hint={toolMode.frameAvailable ? undefined : NO_REPOSITORY_HINT}
          disabled={!toolMode.frameAvailable}
          pressed={frameMode}
          onClick={() => {
            toolMode.toggle("frame")
            onClearMode()
          }}
        >
          <FrameCornersIcon />
        </FloatingToolbarButton>
        {/* Draw a box, then ask a chat to sketch a static page into it
            (#1359). The layers list shows Mockups with the same scribble. */}
        <FloatingToolbarButton
          label="Mockup"
          shortcut="M"
          pressed={mockupMode}
          onClick={() => {
            toolMode.toggle("mockup")
            onClearMode()
          }}
        >
          <ScribbleIcon />
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
        {/* Comment mode places persisted comment threads, in every build
            that has them (the Mac app's host and viewers too, #1934). */}
        {commenting && (
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

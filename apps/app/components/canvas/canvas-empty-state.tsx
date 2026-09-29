"use client"

import {
  FileTextIcon,
  FolderPlusIcon,
  FrameCornersIcon,
  LayoutIcon,
} from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Kbd } from "@workspace/ui/components/kbd"

import type { ToolModeController } from "./use-tool-mode"

/**
 * Fill for chrome drawn straight on the canvas plane. In light mode the plane
 * and `--muted` are the same grey, so the stock muted fill disappears; a
 * foreground tint gives it back. Dark mode keeps the stock fill, which already
 * reads (#1032).
 */
const ON_PLANE = "bg-foreground/[0.06] dark:bg-muted"

/**
 * The empty-canvas guidance (#735): what a Canvas with no Layers shows instead
 * of a blank field. Offers the three ways to start — a Frame, a Document, a
 * Project — each with the shortcut that does the same thing, so the guidance
 * teaches the keys rather than standing in for them.
 *
 * Frame and Document arm the same Tool Mode the toolbar and `F` / `D` do; the
 * guidance then steps aside for a one-line placement hint, so the next click
 * lands on the canvas rather than on a button. Project opens the sidebar's
 * add-project flow, which owns the picker.
 *
 * Floats over the canvas in screen space and is pointer-transparent except for
 * its buttons, so panning and marquee still work around it. The Canvas stops
 * rendering it once any Layer exists.
 */
export function CanvasEmptyState({
  toolMode,
  onAddProject,
}: {
  toolMode: ToolModeController
  /** Open the sidebar's add-project flow (expanding the sidebar if needed). */
  onAddProject: () => void
}) {
  const { frameMode, documentMode } = toolMode

  if (frameMode || documentMode) {
    return (
      <div
        data-slot="canvas-empty-hint"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center"
      >
        <p className="flex animate-in items-center gap-2 text-sm text-muted-foreground duration-200 fade-in-0">
          {frameMode
            ? "Click or drag to place a frame"
            : "Click or drag to place a document"}
          <Kbd className={ON_PLANE}>Esc</Kbd>
        </p>
      </div>
    )
  }

  return (
    <div
      data-slot="canvas-empty-state"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <Empty className="flex-none animate-in duration-300 fade-in-0">
        <EmptyHeader>
          <EmptyMedia variant="icon" className={ON_PLANE}>
            <LayoutIcon />
          </EmptyMedia>
          <EmptyTitle>This canvas is empty</EmptyTitle>
          <EmptyDescription>
            Frames preview a Workspace, Documents hold notes and specs, and a
            repository holds the code they run.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="pointer-events-auto w-56 gap-1">
          <EmptyAction
            icon={<FrameCornersIcon />}
            label="Add a frame"
            shortcut="F"
            onClick={() => toolMode.set("frame")}
          />
          <EmptyAction
            icon={<FileTextIcon />}
            label="Add a Document"
            shortcut="D"
            onClick={() => toolMode.set("document")}
          />
          <EmptyAction
            icon={<FolderPlusIcon />}
            label="Add a repository"
            onClick={onAddProject}
          />
        </EmptyContent>
      </Empty>
    </div>
  )
}

function EmptyAction({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        // The canvas wrapper treats a click as "clear the selection / place a
        // comment"; this button is chrome, not canvas.
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <Kbd className={ON_PLANE}>{shortcut}</Kbd>}
    </Button>
  )
}

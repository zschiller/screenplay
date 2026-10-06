"use client"

import {
  FileTextIcon,
  FolderPlusIcon,
  FrameCornersIcon,
  LayoutIcon,
  ScribbleIcon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"

import { AddRepositoryTrigger } from "@/components/add-repository-dialog"
import { repoListTitle, type RepoNaming } from "@/lib/repo-identity"

import { NO_REPOSITORY_HINT } from "./canvas-toolbar"
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
 * of a blank field. Offers the ways to start — a Frame, a Mockup, a Document,
 * a repository — each with the shortcut that does the same thing, so the guidance
 * teaches the keys rather than standing in for them.
 *
 * Frame, Mockup and Document arm the same Tool Mode the toolbar and `F` / `M` /
 * `D` do; the
 * guidance then steps aside for a one-line placement hint, so the next click
 * lands on the canvas rather than on a button. Add a repository goes straight
 * to the picker (#1182). With no repository yet, Add a frame is off and its
 * tooltip says to add one first, the same as the toolbar's Frame button.
 *
 * A canvas with repositories (#1814) drops the Add a repository row, since
 * Canvas settings is where its repositories change, and its description names
 * them, so a person knows what a frame will preview.
 *
 * Floats over the canvas in screen space and is pointer-transparent except for
 * its buttons, so panning and marquee still work around it. The Canvas stops
 * rendering it once any Layer exists.
 */
export function CanvasEmptyState({
  toolMode,
  repos,
}: {
  toolMode: ToolModeController
  /** The canvas's Canvas Repos. */
  repos: readonly RepoNaming[]
}) {
  const { frameMode, mockupMode, documentMode } = toolMode
  const hasRepos = repos.length > 0

  if (frameMode || mockupMode || documentMode) {
    return (
      <div
        data-slot="canvas-empty-hint"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center"
      >
        <p className="flex animate-in items-center gap-2 text-sm text-muted-foreground duration-200 fade-in-0">
          {frameMode
            ? "Click or drag to place a frame"
            : mockupMode
              ? "Click or drag to place a mockup"
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
          <EmptyDescription>{emptyCanvasDescription(repos)}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="pointer-events-auto w-56 gap-1">
          {toolMode.frameAvailable ? (
            <EmptyAction
              icon={<FrameCornersIcon />}
              label="Add a frame"
              shortcut="F"
              onClick={() => toolMode.set("frame")}
            />
          ) : (
            // A disabled button fires no pointer events, so the tooltip hangs
            // off a wrapping span.
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex w-full">
                    <EmptyAction
                      icon={<FrameCornersIcon />}
                      label="Add a frame"
                      disabled
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {NO_REPOSITORY_HINT}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <EmptyAction
            icon={<ScribbleIcon />}
            label="Add a mockup"
            shortcut="M"
            onClick={() => toolMode.set("mockup")}
          />
          <EmptyAction
            icon={<FileTextIcon />}
            label="Add a document"
            shortcut="D"
            onClick={() => toolMode.set("document")}
          />
          {!hasRepos && (
            <AddRepositoryTrigger>
              <EmptyAction icon={<FolderPlusIcon />} label="Add a repository" />
            </AddRepositoryTrigger>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" })

/**
 * The empty canvas's description. With repositories it names each one the way
 * a repository list row does (`owner/name`), once, joined as a list: “a”, “a
 * and b”, “a, b, and c”.
 */
export function emptyCanvasDescription(repos: readonly RepoNaming[]): string {
  if (repos.length === 0) {
    return "Frames preview a chat’s code, mockups sketch a page before it’s built, documents hold notes and specs, and a repository holds the code they run."
  }
  const names = [...new Set(repos.map((r) => repoListTitle(r).heading))]
  return `Frames preview ${LIST.format(names)}, mockups sketch a page before it’s built, and documents hold notes and specs.`
}

function EmptyAction({
  icon,
  label,
  shortcut,
  onClick,
  ...props
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick?: React.MouseEventHandler<HTMLButtonElement>
} & Omit<React.ComponentProps<typeof Button>, "onClick">) {
  // Props an `AddRepositoryTrigger` passes in (a menu trigger's handlers and
  // state) ride through to the button.
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground hover:text-foreground"
      {...props}
      onClick={(e) => {
        // The canvas wrapper treats a click as "clear the selection / place a
        // comment"; this button is chrome, not canvas.
        e.stopPropagation()
        onClick?.(e)
      }}
      onPointerDown={(e) => {
        e.stopPropagation()
        props.onPointerDown?.(e)
      }}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <Kbd className={ON_PLANE}>{shortcut}</Kbd>}
    </Button>
  )
}

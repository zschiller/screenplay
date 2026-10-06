"use client"

import { useRef } from "react"

import {
  ArrowClockwiseIcon,
  ChatCircleIcon,
  FrameCornersIcon,
  PauseCircleIcon,
  PlayIcon,
  ScrollIcon,
  WarningIcon,
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
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { STATUS_BLOCK, useStatusFit } from "./status-fit"

import type { FrameStage } from "./frame-stage"

export interface FrameStatusProps {
  stage: FrameStage
  /** The Workspace's status line (booting/starting), error (workspace-failed),
   *  or where to choose one (unassigned). */
  detail?: string
  /** Retry after a failure: restart the Workspace, or re-probe the dev server. */
  onRetry?: () => void
  /** Start a stopped Workspace. */
  onStart?: () => void
  /** Show the Workspace's sandbox logs. */
  onOpenLogs?: () => void
  /** Start a chat on an unanswered frame: reopen its ask card (#1358). */
  onStartChat?: () => void
  /** The canvas zoom and the frame's size, on the canvas. The block keeps its
   *  UI size at every zoom and drops what doesn't fit (see `useStatusFit`). */
  zoom?: number
  frameWidth?: number
  frameHeight?: number
  className?: string
}

const COPY: Record<FrameStage, { title: string; description: string }> = {
  unassigned: {
    title: "No chat",
    description:
      "Choose a chat from the frame’s title to preview its code here.",
  },
  booting: {
    title: "Setting up the code",
    description: "The preview appears once it starts.",
  },
  starting: {
    title: "Starting preview",
    description: "The preview appears as soon as it answers.",
  },
  "workspace-failed": {
    title: "Setup failed",
    description: "Something went wrong setting it up.",
  },
  "preview-failed": {
    title: "Preview not responding",
    description: "The preview couldn’t be reached. It may still be starting.",
  },
  stopped: {
    title: "Preview stopped",
    description: "Start it again to see the preview.",
  },
}

/**
 * The one status screen a frame shows in place of its preview (issue #731), on
 * the canvas and in play mode alike: which stage the Workspace is
 * at, and on a failure, the way out.
 *
 * Progress uses the shared `Spinner`; the 9-dot `GripSpinner` is for LLM
 * activity only. The root is pointer-transparent so a frame on the canvas still
 * drags and selects through it; only the buttons take the pointer.
 *
 * On the canvas the block stays at UI size at every zoom, like the frame's
 * label, while the background still covers the frame (I17). A frame too small
 * on screen for all of it drops the description, then the buttons, then the
 * title, rather than shrinking it, so side by side every frame's block reads
 * at the same size. It lays out at a fixed width, so it never wraps to the
 * frame's.
 */
export function FrameStatus({
  stage,
  detail,
  onRetry,
  onStart,
  onOpenLogs,
  onStartChat,
  zoom = 1,
  frameWidth = 0,
  frameHeight = 0,
  className,
}: FrameStatusProps) {
  const copy = COPY[stage]
  const failed = stage === "workspace-failed" || stage === "preview-failed"
  const progress = stage === "booting" || stage === "starting"
  const retry = failed ? onRetry : stage === "stopped" ? onStart : undefined
  const logs = failed ? onOpenLogs : undefined
  const startChat = stage === "unassigned" ? onStartChat : undefined
  const description =
    stage === "workspace-failed" && detail
      ? detail
      : (progress || stage === "unassigned") && detail
        ? detail
        : copy.description

  const blockRef = useRef<HTMLDivElement | null>(null)
  useStatusFit(blockRef, {
    zoom,
    width: frameWidth,
    height: frameHeight,
    contentKey: [stage, description, !!retry, !!logs, !!startChat].join("|"),
  })

  return (
    <Empty
      data-frame-stage={stage}
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-none bg-white dark:bg-neutral-900",
        className
      )}
    >
      <div
        ref={blockRef}
        data-slot="frame-status-block"
        className={cn("flex flex-col items-center gap-3", STATUS_BLOCK)}
      >
        <EmptyHeader>
          <EmptyMedia variant="icon" className="mb-1">
            {progress ? (
              <Spinner
                aria-label={copy.title}
                className="text-muted-foreground"
              />
            ) : failed ? (
              <WarningIcon className="text-destructive" />
            ) : stage === "stopped" ? (
              <PauseCircleIcon className="text-muted-foreground" />
            ) : (
              <FrameCornersIcon className="text-muted-foreground" />
            )}
          </EmptyMedia>
          <EmptyTitle>{copy.title}</EmptyTitle>
          <EmptyDescription
            className={cn(
              stage === "workspace-failed" &&
                detail &&
                "line-clamp-3 font-mono text-sm break-words"
            )}
          >
            {description}
          </EmptyDescription>
        </EmptyHeader>
        {(retry || logs || startChat) && (
          <EmptyContent
            className={cn(
              "pointer-events-auto w-auto flex-row justify-center gap-2"
            )}
            // Keep the press on the button: the canvas would otherwise read it as
            // a select or the start of a drag on the frame underneath.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {retry && (
              <Button size="sm" variant="outline" onClick={retry}>
                {stage === "stopped" ? <PlayIcon /> : <ArrowClockwiseIcon />}
                {stage === "stopped" ? "Start" : "Retry"}
              </Button>
            )}
            {startChat && (
              <Button size="sm" variant="outline" onClick={startChat}>
                <ChatCircleIcon />
                Start a chat
              </Button>
            )}
            {logs && (
              <Button size="sm" variant="ghost" onClick={logs}>
                <ScrollIcon />
                Open logs
              </Button>
            )}
          </EmptyContent>
        )}
      </div>
    </Empty>
  )
}

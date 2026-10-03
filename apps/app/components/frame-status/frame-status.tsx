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

import { useLiveZoom } from "@/components/canvas/live-zoom"

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
  /** The canvas zoom and the frame's size, on the canvas. Zoomed out, the
   *  screen counter-scales to stay readable (see `statusScale`). */
  zoom?: number
  frameWidth?: number
  frameHeight?: number
  className?: string
}

const COPY: Record<FrameStage, { title: string; description: string }> = {
  unassigned: {
    title: "No workspace",
    description:
      "Choose a workspace from the frame's title to preview it here.",
  },
  booting: {
    title: "Setting up the workspace",
    description: "The preview appears once its dev server starts.",
  },
  starting: {
    title: "Starting dev server",
    description: "The preview appears as soon as it answers.",
  },
  "workspace-failed": {
    title: "Workspace failed to start",
    description: "Something went wrong setting it up.",
  },
  "preview-failed": {
    title: "Dev server not responding",
    description: "The preview couldn't be reached. It may still be starting.",
  },
  stopped: {
    title: "Workspace stopped",
    description: "Start it again to see the preview.",
  },
}

/** The smallest box the status block lays out in, before it scales down with
 *  the frame. Wider than its widest content (`max-w-sm`, 384px) so the block
 *  always keeps clear space to the frame's edges. */
const MIN_BOX = { width: 480, height: 360 }

/**
 * How much the status block scales up on a zoomed-out canvas: by 1/zoom, so
 * it keeps its normal on-screen size, like a frame's label. Capped by the
 * frame's size, so the block never lays out in less than `MIN_BOX` and a small
 * frame shrinks it rather than clipping it. 1 at 100% and closer.
 */
export function statusScale(
  zoom: number,
  frameWidth: number,
  frameHeight: number
): number {
  if (!(zoom > 0)) return 1
  return Math.max(
    1,
    Math.min(1 / zoom, frameWidth / MIN_BOX.width, frameHeight / MIN_BOX.height)
  )
}

/** The box and transform for a counter-scale; empty values (no style) at 1. */
function scaleStyle(scale: number) {
  const on = scale > 1
  return {
    width: on ? `${100 / scale}%` : "",
    height: on ? `${100 / scale}%` : "",
    transform: on ? `scale(${scale})` : "",
  }
}

/**
 * The one status screen a frame shows in place of its preview (issue #731), on
 * the canvas and in the prototype player alike: which stage the Workspace is
 * at, and on a failure, the way out.
 *
 * Progress uses the shared `Spinner`; the 9-dot `GripSpinner` is for LLM
 * activity only. The root is pointer-transparent so a frame on the canvas still
 * drags and selects through it; only the buttons take the pointer.
 *
 * Zoomed out, the screen counter-scales so it stays readable (I17). Its box
 * shrinks by the same factor first, so on screen it still covers exactly the
 * frame. It follows the live zoom through a gesture, so it never jumps.
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
  const scale = statusScale(zoom, frameWidth, frameHeight)

  // The `zoom` prop lands only when a zoom gesture settles; mid-gesture the
  // live zoom restyles the box directly, so it holds its size instead of
  // snapping at the end of each step.
  const rootRef = useRef<HTMLDivElement | null>(null)
  useLiveZoom((live) => {
    const el = rootRef.current
    if (el)
      Object.assign(
        el.style,
        scaleStyle(statusScale(live, frameWidth, frameHeight))
      )
  })

  return (
    <Empty
      ref={rootRef}
      data-frame-stage={stage}
      className={cn(
        "pointer-events-none absolute inset-0 gap-3 overflow-hidden rounded-none bg-white dark:bg-neutral-900",
        "origin-top-left",
        className
      )}
      style={scaleStyle(scale)}
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
        {stage === "workspace-failed" && detail ? (
          <EmptyDescription className="line-clamp-3 font-mono text-xs break-words">
            {detail}
          </EmptyDescription>
        ) : (
          <EmptyDescription className="text-xs/relaxed">
            {(progress || stage === "unassigned") && detail
              ? detail
              : copy.description}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {(retry || logs || startChat) && (
        <EmptyContent
          className="pointer-events-auto w-auto flex-row justify-center gap-2"
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
    </Empty>
  )
}

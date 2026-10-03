"use client"

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

/**
 * The one status screen a frame shows in place of its preview (issue #731), on
 * the canvas and in the prototype player alike: which stage the Workspace is
 * at, and on a failure, the way out.
 *
 * Progress uses the shared `Spinner`; the 9-dot `GripSpinner` is for LLM
 * activity only. The root is pointer-transparent so a frame on the canvas still
 * drags and selects through it; only the buttons take the pointer.
 */
export function FrameStatus({
  stage,
  detail,
  onRetry,
  onStart,
  onOpenLogs,
  onStartChat,
  className,
}: FrameStatusProps) {
  const copy = COPY[stage]
  const failed = stage === "workspace-failed" || stage === "preview-failed"
  const progress = stage === "booting" || stage === "starting"
  const retry = failed ? onRetry : stage === "stopped" ? onStart : undefined
  const logs = failed ? onOpenLogs : undefined
  const startChat = stage === "unassigned" ? onStartChat : undefined

  return (
    <Empty
      data-frame-stage={stage}
      className={cn(
        "pointer-events-none absolute inset-0 gap-3 rounded-none bg-white dark:bg-neutral-900",
        className
      )}
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

"use client"

import {
  ArrowClockwiseIcon,
  CheckIcon,
  CircleIcon,
  ScrollIcon,
  WarningIcon,
} from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { useElapsed } from "@/hooks/use-elapsed"
import type { SetupProgress, SetupStep } from "@/lib/branch/setup-steps"
import { formatElapsed } from "@/lib/branch/workspace-state"

/**
 * A chat's setup steps (`setupProgress`), in place of its transcript while its
 * code is set up: done steps ticked, the current one spinning with its elapsed
 * time, the rest to come. A step that failed turns red, with the error under
 * the list and the frame's Setup failed pair, Retry and Open logs.
 */
export function SetupSteps({
  progress,
  onRetry,
  onOpenLogs,
}: {
  progress: SetupProgress
  onRetry?: () => void
  onOpenLogs?: () => void
}) {
  const failed = progress.error !== undefined
  return (
    <div className="flex max-w-65 flex-col gap-3 text-sm text-muted-foreground">
      <ol aria-label="Setting up the code" className="flex flex-col gap-2">
        {progress.steps.map((step) => (
          <SetupStepRow key={step.label} step={step} />
        ))}
      </ol>
      <p className="text-balance break-words">
        {failed
          ? progress.error
          : "The agent starts once the code is ready. Install and preview finish in the background."}
      </p>
      {failed && (onRetry || onOpenLogs) && (
        <div className="flex gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <ArrowClockwiseIcon />
              Retry
            </Button>
          )}
          {onOpenLogs && (
            <Button size="sm" variant="ghost" onClick={onOpenLogs}>
              <ScrollIcon />
              Open logs
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function SetupStepRow({ step }: { step: SetupStep }) {
  return (
    <li
      data-state={step.state}
      className={cn(
        "flex items-center gap-2",
        step.state === "failed"
          ? "text-destructive"
          : step.state !== "todo" && "text-foreground"
      )}
    >
      {step.state === "done" ? (
        <CheckIcon className="size-4 shrink-0" />
      ) : step.state === "now" ? (
        <Spinner className="shrink-0" />
      ) : step.state === "failed" ? (
        <WarningIcon className="size-4 shrink-0" />
      ) : (
        <CircleIcon className="size-4 shrink-0" />
      )}
      {step.label}
      {step.state === "now" && <Elapsed step={step.label} />}
    </li>
  )
}

function Elapsed({ step }: { step: string }) {
  const elapsed = useElapsed(step)
  return (
    <span className="text-muted-foreground tabular-nums">
      {formatElapsed(elapsed)}
    </span>
  )
}

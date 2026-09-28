"use client"

import { X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { StepMarker } from "@/components/local-setup/setup-step"
import { workspaceStatusLine } from "@/lib/branch/status-line"
import type {
  GettingStartedProgress,
  GettingStartedStep,
} from "@/lib/getting-started"

const STEPS: { key: GettingStartedStep; title: string }[] = [
  { key: "project", title: "Add a project" },
  { key: "workspace", title: "Start a Workspace" },
  { key: "frame", title: "Open its frame" },
]

/**
 * The first Canvas's getting-started checklist (#780): add a Project, start a
 * Workspace, open its frame. The steps use the setup stepper's markers, so the
 * page right after setup reads as its next step: a green tick once done, the
 * current step's number in a dark ring, the rest muted.
 *
 * Centred in place of the empty-canvas guidance while the Canvas is empty.
 * Adding a Project starts its first Workspace and lands its frame, so from then
 * on the checklist sits in the Canvas's bottom-left corner, inset like the rest
 * of the canvas chrome and out of the frame's way. It stays, all ticked, until
 * it's dismissed.
 */
export function GettingStartedChecklist({
  progress,
  placement,
  onAddProject,
  onNewWorkspace,
  onShowFrame,
  onDismiss,
}: {
  progress: GettingStartedProgress
  placement: "center" | "corner"
  onAddProject: () => void
  onNewWorkspace: () => void
  onShowFrame: (layerId: string) => void
  onDismiss: () => void
}) {
  const currentIndex = STEPS.findIndex((s) => s.key === progress.current)

  return (
    <div
      data-slot="getting-started"
      className={cn(
        "pointer-events-none absolute z-10 flex",
        placement === "center"
          ? "inset-0 items-center justify-center"
          : "bottom-2 left-2"
      )}
    >
      <section
        aria-labelledby="getting-started-title"
        // Chrome, not canvas: keep clicks from clearing the selection or
        // placing a comment underneath.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-auto flex w-80 animate-in flex-col gap-4 rounded-lg bg-background p-4 shadow-md outline outline-1 outline-foreground/5 duration-300 fade-in-0"
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              {progress.current
                ? `Step ${currentIndex + 1} of ${STEPS.length}`
                : "All done"}
            </span>
            <h2 id="getting-started-title" className="text-sm font-semibold">
              Get started
            </h2>
          </div>
          <IconButton
            label="Dismiss"
            className="-mt-0.5 -mr-1.5"
            onClick={onDismiss}
          >
            <X />
          </IconButton>
        </div>

        <ol className="flex flex-col gap-3">
          {STEPS.map((step, i) => {
            const state = progress[step.key]
              ? "done"
              : step.key === progress.current
                ? "current"
                : "upcoming"
            return (
              <li key={step.key} className="flex gap-2.5">
                {/* One 20px slot for every marker, so titles line up. */}
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <StepMarker step={i + 1} state={state} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2 pt-px">
                  <span
                    className={cn(
                      "text-sm",
                      state === "current" && "font-medium",
                      state === "upcoming" && "text-muted-foreground"
                    )}
                  >
                    {step.title}
                  </span>
                  {state === "current" && (
                    <StepBody
                      step={step.key}
                      progress={progress}
                      onAddProject={onAddProject}
                      onNewWorkspace={onNewWorkspace}
                      onShowFrame={onShowFrame}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

function StepBody({
  step,
  progress,
  onAddProject,
  onNewWorkspace,
  onShowFrame,
}: {
  step: GettingStartedStep
  progress: GettingStartedProgress
  onAddProject: () => void
  onNewWorkspace: () => void
  onShowFrame: (layerId: string) => void
}) {
  if (step === "project") {
    return (
      <>
        <Hint>
          Open a folder or a GitHub repository. Screenplay starts a Workspace on
          it for you.
        </Hint>
        <div>
          <Button type="button" size="sm" onClick={onAddProject}>
            Add project
          </Button>
        </div>
      </>
    )
  }

  if (step === "workspace") {
    return (
      <>
        <Hint>A Workspace is a git branch with its own preview and agent.</Hint>
        <div>
          <Button type="button" size="sm" onClick={onNewWorkspace}>
            New Workspace
          </Button>
        </div>
      </>
    )
  }

  const { branch, frameLayerId } = progress
  const line = branch
    ? workspaceStatusLine(branch, { agentWorking: false })
    : null
  return (
    <>
      {line?.kind === "progress" ? (
        <Hint>
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3.5" />
            {line.step}…
          </span>
        </Hint>
      ) : line?.kind === "error" ? (
        <Hint>{line.title}. Retry it from the sidebar.</Hint>
      ) : (
        <Hint>The frame shows the Workspace&apos;s app once it starts.</Hint>
      )}
      {frameLayerId && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onShowFrame(frameLayerId)}
          >
            Show frame
          </Button>
        </div>
      )}
    </>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-pretty text-muted-foreground">{children}</p>
  )
}

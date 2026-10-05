"use client"

import { XIcon } from "@workspace/ui/components/icons"

import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { AddRepositoryTrigger } from "@/components/add-repository-dialog"
import { StepMarker } from "@/components/local-setup/setup-step"
import { WorkspaceStateGlyph } from "@/components/workspace-mention"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type {
  GettingStartedProgress,
  GettingStartedStep,
} from "@/lib/getting-started"

const STEPS: { key: GettingStartedStep; title: string }[] = [
  { key: "project", title: "Add a repository" },
  { key: "ask", title: "Ask the Coordinator for a change" },
  { key: "open", title: "Open the chat" },
]

/**
 * The first Canvas's getting-started checklist (#780): add a repository, ask
 * the Coordinator for a change, open the Workspace it ran in (#1182), so it
 * teaches the Coordinator. The steps use the setup stepper's markers, so the
 * page right after setup reads as its next step, with the done tick in blue:
 * the current step's number in a dark ring, the rest muted.
 *
 * A floating card pinned to the bottom of the room sidebar, in the same place
 * from the first step to the last, so it never covers the canvas. It stays,
 * all ticked, until it's dismissed.
 */
export function GettingStartedChecklist({
  progress,
  onShowCoordinator,
  onOpenWorkspace,
  onDismiss,
}: {
  progress: GettingStartedProgress
  /** Open the panel on the Coordinator. */
  onShowCoordinator: () => void
  /** Open the panel on a Workspace. */
  onOpenWorkspace: (branchId: string) => void
  onDismiss: () => void
}) {
  const currentIndex = STEPS.findIndex((s) => s.key === progress.current)

  return (
    <section
      data-slot="getting-started"
      aria-labelledby="getting-started-title"
      className="flex animate-in flex-col gap-3 rounded-lg bg-background p-3 text-foreground shadow-md outline outline-1 outline-foreground/10 duration-300 fade-in-0"
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
          <XIcon />
        </IconButton>
      </div>

      <ol className="flex flex-col gap-2.5">
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
                    state === "current" && "font-medium font-stretch-[98.8%]",
                    state === "upcoming" && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
                {state === "current" && (
                  <StepBody
                    step={step.key}
                    progress={progress}
                    onShowCoordinator={onShowCoordinator}
                    onOpenWorkspace={onOpenWorkspace}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function StepBody({
  step,
  progress,
  onShowCoordinator,
  onOpenWorkspace,
}: {
  step: GettingStartedStep
  progress: GettingStartedProgress
  onShowCoordinator: () => void
  onOpenWorkspace: (branchId: string) => void
}) {
  const stateOf = useWorkspaceStates()
  if (step === "project") {
    return (
      <>
        <Hint>Open a folder or a GitHub repository.</Hint>
        <div>
          <AddRepositoryTrigger>
            <Button type="button" size="sm">
              Add repository
            </Button>
          </AddRepositoryTrigger>
        </div>
      </>
    )
  }

  if (step === "ask") {
    return (
      <>
        <Hint>Your first ask starts a chat on the canvas.</Hint>
        <div>
          <Button type="button" size="sm" onClick={onShowCoordinator}>
            Ask the Coordinator
          </Button>
        </div>
      </>
    )
  }

  const { branch } = progress
  const line = branch ? stateOf(branch).line : null
  return (
    <>
      {line?.kind === "idle" &&
      (line.state === "working" || line.state === "needs-you") ? (
        <Hint>
          <span className="flex items-center gap-1.5">
            <WorkspaceStateGlyph line={line} />
            {line.text}
          </span>
        </Hint>
      ) : line?.kind === "progress" ? (
        <Hint>
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3.5" />
            {line.step}…
          </span>
        </Hint>
      ) : line?.kind === "error" ? (
        <Hint>{line.title}. Retry it from the Chats menu.</Hint>
      ) : (
        <Hint>See its chat and what changed while the frame updates.</Hint>
      )}
      {branch && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenWorkspace(branch.id)}
          >
            Open chat
          </Button>
        </div>
      )}
    </>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-balance text-muted-foreground">{children}</p>
  )
}

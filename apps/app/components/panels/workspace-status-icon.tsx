"use client"

import { useState, type SyntheticEvent } from "react"
import { AlertTriangle, CircleDashed, CircleSmall, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Spinner } from "@workspace/ui/components/spinner"
import { GripSpinner } from "@/components/grip-spinner"
import { useCloseWorkspaceHoverCard } from "@/components/workspace-hover-card"
import {
  workspaceStatusLine,
  type StatusLineBranch,
  type StatusLineContext,
  type WorkspaceStatusLine,
} from "@/lib/branch/status-line"

// The icon sits inside the dnd-kit sortable row, and the popover portals out
// of it while React events still bubble through: keep clicks from selecting
// the Workspace, and keys and pointer-downs from reaching the drag sensors
// (Space is the KeyboardSensor's pick-up key).
const stop = (e: SyntheticEvent) => e.stopPropagation()
const isolate = {
  onClick: stop,
  onDoubleClick: stop,
  onKeyDown: stop,
  onPointerDown: stop,
}

function StateIcon({
  line,
}: {
  line: Exclude<WorkspaceStatusLine, { kind: "error" }>
}) {
  // Progress uses the shared Spinner; the 9-dot GripSpinner is reserved for
  // agent activity. The PR is not a state: it sits at the row's end (#963).
  const glyph =
    line.kind === "progress" ? (
      <Spinner className="size-3.5 text-sidebar-foreground/70" />
    ) : line.state === "working" ? (
      <GripSpinner className="size-3.5 text-sidebar-foreground/70" />
    ) : line.state === "stopped" ? (
      // Lucide's dashed circle is drawn larger than CircleSmall; shrink it
      // to about the same size (past the menu button's own svg size), with
      // a heavier stroke so the line weight matches.
      <CircleDashed
        strokeWidth={2.6}
        className="size-3! text-sidebar-foreground/50"
      />
    ) : (
      <CircleSmall className="size-3.5 text-sidebar-foreground/50" />
    )
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {glyph}
    </span>
  )
}

/**
 * The leading icon of a Workspace row (#791, #963): one glyph for its state
 * only; its PR sits at the row's end. The state in words ("Installing
 * dependencies · 40s", "Agent working", "Ready") is in the row's Workspace
 * hover card (#882). A failure is the red triangle; clicking it opens a card titled
 * by the step that failed, with the error and Retry, Recreate and Copy error.
 */
export function WorkspaceStatusIcon({
  branch,
  context,
  onRetry,
  onRecreate,
}: {
  branch: StatusLineBranch
  context: StatusLineContext
  onRetry: () => void
  onRecreate: () => void
}) {
  const line = workspaceStatusLine(branch, context)
  const [open, setOpen] = useState(false)
  const closeHoverCard = useCloseWorkspaceHoverCard()

  if (line.kind !== "error") {
    return (
      <span
        role="img"
        aria-label={line.kind === "progress" ? line.step : line.text}
        className="flex shrink-0"
      >
        <StateIcon line={line} />
      </span>
    )
  }

  const copyError = () => {
    void navigator.clipboard
      ?.writeText(line.detail)
      .then(() => toast.success("Error copied"))
      .catch(() => toast.error("Couldn't copy the error"))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // The error card opens where the hover card sits; let it take over.
        if (next) closeHoverCard()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={line.title}
          className="-m-0.5 box-content flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          {...isolate}
        >
          <AlertTriangle className="size-3.5 text-destructive" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="w-80 gap-3"
        {...isolate}
      >
        <p className="text-sm font-medium text-popover-foreground">
          {line.title}
        </p>
        <pre className="max-h-40 overflow-auto font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
          {line.detail}
        </pre>
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            onClick={() => {
              setOpen(false)
              onRetry()
            }}
          >
            Retry
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setOpen(false)
              onRecreate()
            }}
          >
            Recreate
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto"
            onClick={copyError}
          >
            <Copy />
            Copy error
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

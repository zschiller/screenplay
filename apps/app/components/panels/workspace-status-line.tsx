"use client"

import { useEffect, useState, type SyntheticEvent } from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"
import {
  FAILED_LABEL,
  formatElapsed,
  workspaceStatusLine,
  type StatusLineBranch,
  type StatusLineContext,
} from "@/lib/branch/status-line"

// The line sits inside the dnd-kit sortable row, and the popover portals out
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

/** Milliseconds since `key` last changed, ticking once a second. */
function useElapsed(key: string): number {
  const [now, setNow] = useState(() => Date.now())
  const [start, setStart] = useState(() => ({ key, at: now }))
  if (start.key !== key) setStart({ key, at: now })
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now - start.at
}

function ProgressText({ step }: { step: string }) {
  const elapsed = useElapsed(step)
  return (
    <>
      {step} · {formatElapsed(elapsed)}
    </>
  )
}

/**
 * The muted second line of a Workspace row (#791): the Workspace's state in
 * words. Status colour appears here and only for a failure, which reads
 * "Setup failed · Retry" in place. "Setup failed" opens a card titled by the
 * step that failed, with the error and Retry, Recreate and Copy error.
 */
export function WorkspaceStatusLine({
  branch,
  context,
  onRetry,
  onRecreate,
  className,
}: {
  branch: StatusLineBranch
  context: StatusLineContext
  onRetry: () => void
  onRecreate: () => void
  className?: string
}) {
  const line = workspaceStatusLine(branch, context)
  const [open, setOpen] = useState(false)

  if (line.kind !== "error") {
    return (
      <span
        className={cn("truncate text-xs text-muted-foreground", className)}
        aria-live={line.kind === "progress" ? "polite" : undefined}
      >
        {line.kind === "progress" ? (
          <ProgressText step={line.step} />
        ) : (
          line.text
        )}
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
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs text-destructive",
        className
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="truncate rounded-sm outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            {...isolate}
          >
            {FAILED_LABEL}
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
      <span aria-hidden>·</span>
      <button
        type="button"
        className="shrink-0 rounded-sm underline underline-offset-2 outline-hidden hover:text-destructive/80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        {...isolate}
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
      >
        Retry
      </button>
    </span>
  )
}

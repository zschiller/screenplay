"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { cn } from "@workspace/ui/lib/utils"
import { isBranchBusy } from "@/lib/branch-busy"
import { workspaceDetails } from "@/lib/branch/workspace-details"
import { formatElapsed, workspaceStatusLine } from "@/lib/branch/status-line"
import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"
import { useBranches, useChatSessions, useRepos } from "@/lib/yjs/react"

// The card portals out of sidebar rows and canvas labels while React events
// still bubble through them: keep its clicks and pointer-downs from selecting,
// dragging or renaming whatever it hangs off.
const stop = (e: SyntheticEvent) => e.stopPropagation()

/** Closes the enclosing Workspace hover card, e.g. when a click opens a popover over it. */
const CloseHoverCardContext = createContext<() => void>(() => {})

export function useCloseWorkspaceHoverCard(): () => void {
  return useContext(CloseHoverCardContext)
}

/**
 * The Workspace hover card (#882): hovering a Workspace row or a Workspace pill
 * shows its title, its status in words (what the row's status icon used to say
 * in a tooltip), then its repository, branch, base and line changes. The
 * branch lives here rather than on the row (spec #880, wireframe 2.4A).
 *
 * `children` is the trigger. Pressing it closes the card, so a click that opens
 * a menu or a picker, or starts a drag, never leaves the card on top.
 * `suppressed` keeps it closed while that picker is open: the hover that led
 * to the click would otherwise open the card over it once its delay runs out.
 * A menu opened from inside the trigger (a sidebar row's …) does the same on
 * its own: the card stays shut while anything in the trigger is expanded.
 */
export function WorkspaceHoverCard({
  branchId,
  side = "right",
  align = "start",
  suppressed = false,
  children,
}: {
  branchId: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  suppressed?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLAnchorElement>(null)
  const close = () => setOpen(false)
  const menuOpen = () =>
    !!triggerRef.current?.querySelector('[aria-expanded="true"]')
  return (
    <CloseHoverCardContext.Provider value={close}>
      <HoverCard
        open={open && !suppressed}
        onOpenChange={(next) => setOpen(next && !suppressed && !menuOpen())}
        openDelay={500}
      >
        <HoverCardTrigger ref={triggerRef} asChild onPointerDown={close}>
          {children}
        </HoverCardTrigger>
        <HoverCardContent
          side={side}
          align={align}
          className="w-64"
          onClick={stop}
          onDoubleClick={stop}
          onPointerDown={stop}
          onKeyDown={stop}
        >
          <WorkspaceHoverDetail branchId={branchId} />
        </HoverCardContent>
      </HoverCard>
    </CloseHoverCardContext.Provider>
  )
}

/** {@link WorkspaceHoverCard} when there's a Workspace to describe; the bare trigger otherwise. */
export function MaybeWorkspaceHoverCard({
  branchId,
  ...props
}: Omit<Parameters<typeof WorkspaceHoverCard>[0], "branchId"> & {
  branchId: string | undefined
}) {
  if (!branchId) return <>{props.children}</>
  return <WorkspaceHoverCard branchId={branchId} {...props} />
}

/** The card's body. Mounted only while the card is open, so closed cards read nothing. */
function WorkspaceHoverDetail({ branchId }: { branchId: string }) {
  const branch = useBranches().find((b) => b.id === branchId)
  const repos = useRepos()
  const chats = useChatSessions()
  if (!branch) return null

  const repo = repos.find((r) => r.id === branch.repoId)
  const line = workspaceStatusLine(branch, {
    agentWorking: isBranchBusy(branch.id, chats),
  })
  const details = workspaceDetails(branch, repo)
  const label = branch.ref ? workspaceLabel(branch) : "New workspace"

  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className={cn(
            "font-medium break-words",
            branch.ref && !hasWorkspaceTitle(branch) && "font-mono text-xs"
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "text-xs",
            line.kind === "error" ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {line.kind === "progress" ? (
            <ProgressText step={line.step} />
          ) : line.kind === "error" ? (
            line.title
          ) : (
            line.text
          )}
        </p>
      </div>
      {(details.repository || details.branch) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {details.repository && (
            <>
              <dt className="text-muted-foreground">Repository</dt>
              <dd className="min-w-0 break-words">{details.repository}</dd>
            </>
          )}
          {details.branch && (
            <>
              <dt className="text-muted-foreground">Git branch</dt>
              <dd className="min-w-0 font-mono break-words">
                {details.branch}
              </dd>
            </>
          )}
          {details.base && (
            <>
              <dt className="text-muted-foreground">Base</dt>
              <dd className="min-w-0 font-mono break-words">{details.base}</dd>
            </>
          )}
          {details.changes && (
            <>
              <dt className="text-muted-foreground">Changes</dt>
              <dd className="flex gap-1 font-mono">
                <span className="text-success">
                  +{details.changes.additions}
                </span>
                <span className="text-destructive">
                  -{details.changes.deletions}
                </span>
              </dd>
            </>
          )}
        </dl>
      )}
    </>
  )
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

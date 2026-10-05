"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import { GitPullRequestIcon } from "@workspace/ui/components/icons"
import { Spinner } from "@workspace/ui/components/spinner"
import { bareToolName } from "@/lib/agent/tool-name"
import { callIdentity } from "@/lib/agent/tool-description"
import type { AgentMessage } from "@/lib/agent/types"
import type { MergeMethod } from "@/lib/github-issues"
import {
  mergeOfferedPr,
  offeredMergeState,
  type OfferedMerge,
  type OfferedMergeState,
} from "@/lib/github-merge-actions"
import { ChatDisclosure } from "./chat-disclosure"

type ToolCallMessage = AgentMessage & { role: "tool_call" }

export function isMergePrCall(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" && bareToolName(message.title) === "merge_pr"
  )
}

const METHODS: readonly MergeMethod[] = ["squash", "merge", "rebase"]

/**
 * The pull request a `merge_pr` call offered, from its result ("Showed a
 * merge card for owner/name#12 …"), and the method the agent asked for.
 * Null while it runs, or when it declined.
 */
export function parseOfferedMerge(
  message: ToolCallMessage
): (OfferedMerge & { method?: MergeMethod }) | null {
  const text = message.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("")
  const found = text.match(/^Showed a merge card for ([\w.-]+\/[\w.-]+)#(\d+)/)
  if (!found) return null
  const method = callIdentity(message).input.method
  return {
    repo: found[1]!,
    number: Number(found[2]),
    method: METHODS.find((m) => m === method),
  }
}

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Merge",
  rebase: "Rebase and merge",
}

/** One line on whether it can merge, in GitHub’s own terms. */
function statusLine(pr: OfferedMergeState): string {
  if (pr.mergeableState === "dirty") return "Has conflicts with its base"
  if (pr.checks === "failing") return "Some checks are failing"
  if (pr.checks === "pending") return "Checks are still running"
  if (pr.mergeableState === "blocked")
    return "Blocked by a required review or check"
  if (pr.checks === "passing") return "All checks have passed"
  return "No checks"
}

type State =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "ready"; pr: OfferedMergeState }

/**
 * The card a chat shows for a pull request its agent offered to merge with
 * `merge_pr`: the PR’s title, whether its checks pass, and one Merge button
 * in the method the agent asked for or the repository’s first allowed one.
 * Nothing merges until a member presses it, with their own GitHub account,
 * and only at the head the card shows. Once merged it says so, for everyone
 * and after a reload, since it reads the PR’s state from GitHub.
 *
 * Renders `fallback` (the plain tool row) while the call runs and when it
 * declined.
 */
export function MergePrCard({
  message,
  roomId,
  fallback,
}: {
  message: ToolCallMessage
  roomId: string
  fallback: ReactNode
}) {
  const done = message.status === "completed"
  const offered = useMemo(
    () => (done ? parseOfferedMerge(message) : null),
    [done, message]
  )
  const key = offered ? `${offered.repo}#${offered.number}` : null
  const [state, setState] = useState<State>({ kind: "loading" })
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!offered) return
    let cancelled = false
    offeredMergeState(roomId, offered).then(
      (result) => {
        if (cancelled) return
        setState(
          result.ok
            ? { kind: "ready", pr: result }
            : { kind: "failed", error: result.error }
        )
      },
      (err) => {
        console.error("Failed to read pull request", err)
        if (!cancelled) {
          setState({ kind: "failed", error: "Couldn’t reach GitHub." })
        }
      }
    )
    return () => {
      cancelled = true
    }
    // The key names the pull request; `offered` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, roomId])

  if (!offered) return <>{fallback}</>

  const pr = state.kind === "ready" ? state.pr : null
  const method =
    pr &&
    (offered.method && pr.methods.includes(offered.method)
      ? offered.method
      : pr.methods[0])

  const merge = async () => {
    if (!pr || !method) return
    setMerging(true)
    setError(null)
    try {
      const result = await mergeOfferedPr(roomId, {
        ...offered,
        method,
        sha: pr.sha,
      })
      if (result.ok) {
        setState({ kind: "ready", pr: { ...pr, state: "merged" } })
      } else {
        setError(result.error)
      }
    } catch (err) {
      console.error("Failed to merge", err)
      setError("Couldn’t merge. Try again.")
    } finally {
      setMerging(false)
    }
  }

  const title = pr ? `#${offered.number} ${pr.title}` : `#${offered.number}`

  return (
    <ChatDisclosure
      collapsible={false}
      icon={<GitPullRequestIcon aria-hidden className="size-3 shrink-0" />}
      title={<span className="truncate font-medium">{title}</span>}
      headerProps={{ "data-testid": "merge-pr-card" }}
    >
      <div className="px-3 py-2.5">
        {state.kind === "loading" && (
          <Spinner className="size-4" aria-label="Checking pull request…" />
        )}
        {state.kind === "failed" && (
          <p className="text-sm text-muted-foreground">{state.error}</p>
        )}
        {pr && (
          <PrBody
            pr={pr}
            method={method ?? undefined}
            merging={merging}
            onMerge={merge}
          />
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-muted-foreground">
            {error}
          </p>
        )}
      </div>
    </ChatDisclosure>
  )
}

/**
 * The card's body. An open PR has its status line, then its Merge button;
 * once there is nothing to press, the status and Open on GitHub share a row.
 */
function PrBody({
  pr,
  method,
  merging,
  onMerge,
}: {
  pr: OfferedMergeState
  method: MergeMethod | undefined
  merging: boolean
  onMerge: () => void
}) {
  const canMerge = pr.state === "open" && !pr.draft && !!method
  const status =
    pr.state === "merged"
      ? "Merged"
      : pr.state === "closed"
        ? "Closed without merging"
        : pr.draft
          ? "Draft: mark it ready for review on GitHub first"
          : statusLine(pr)
  const open = (
    <Button
      size="sm"
      variant="ghost"
      className="ml-auto"
      onClick={() => window.open(pr.url, "_blank", "noopener")}
    >
      Open on GitHub
    </Button>
  )
  if (!canMerge) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{status}</p>
        {open}
      </div>
    )
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">{status}</p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={merging || pr.mergeableState === "dirty"}
          onClick={onMerge}
        >
          {merging && <Spinner />}
          {METHOD_LABEL[method!]}
        </Button>
        {open}
      </div>
    </>
  )
}

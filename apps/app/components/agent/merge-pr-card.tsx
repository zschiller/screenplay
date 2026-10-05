"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  CheckIcon,
  GitPullRequestIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@workspace/ui/components/confirmation"
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
import { inputStore } from "@/lib/input-store"
import { InlineRef } from "./inline-ref"

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

/** The other choice, sent to the agent as the user’s answer. */
const NOT_NOW = "Not now"

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
 * `merge_pr`, as a Confirmation: “Merge #12 …?”, whether its checks pass,
 * and two buttons, the merge in the method the agent asked for (or the
 * repository’s first allowed one) and Not now, which answers the agent.
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
  chatId,
  fallback,
}: {
  message: ToolCallMessage
  roomId: string
  chatId?: string
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
  const [declined, setDeclined] = useState(false)

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
    if (!pr || !method || pr.state !== "open" || merging) return
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

  // Not now goes to the agent as the user’s next message, like a question
  // card’s choice; the merge itself is the card’s own action.
  const notNow = () => {
    if (!chatId || declined) return
    setDeclined(true)
    void inputStore.send(chatId, NOT_NOW).then((ok) => {
      if (!ok) setDeclined(false)
    })
  }

  const merged = pr?.state === "merged"
  const canMerge =
    !!pr && pr.state === "open" && !pr.draft && !!method && !declined
  const status = !pr
    ? null
    : merged
      ? "Merged"
      : pr.state === "closed"
        ? "Closed without merging"
        : pr.draft
          ? "Draft: mark it ready for review on GitHub first"
          : statusLine(pr)

  const decided = merged ? "accepted" : declined ? "rejected" : "requested"
  const prRef = (
    <InlineRef
      kind="workspace"
      icon={<GitPullRequestIcon aria-hidden weight="bold" />}
      onClick={pr ? () => window.open(pr.url, "_blank", "noopener") : undefined}
    >
      #{offered.number}
      {pr ? ` ${pr.title}` : ""}
    </InlineRef>
  )

  return (
    <Confirmation data-testid="merge-pr-card" state={decided}>
      <ConfirmationTitle>
        <ConfirmationRequest>
          <span className="flex flex-col gap-0.5">
            <span>Merge {prRef}?</span>
            <span className="text-xs text-muted-foreground">
              {state.kind === "loading" ? (
                <Spinner
                  className="size-3"
                  aria-label="Checking pull request…"
                />
              ) : state.kind === "failed" ? (
                state.error
              ) : (
                status
              )}
            </span>
          </span>
        </ConfirmationRequest>
        <ConfirmationAccepted>
          <span
            data-testid="card-outcome"
            className="flex items-center gap-1.5"
          >
            <CheckIcon aria-hidden className="size-4" />
            <span>Merged {prRef}</span>
          </span>
        </ConfirmationAccepted>
        <ConfirmationRejected>
          <span
            data-testid="card-outcome"
            className="flex items-center gap-1.5"
          >
            <XIcon aria-hidden className="size-4" />
            <span>Didn’t merge {prRef}</span>
          </span>
        </ConfirmationRejected>
      </ConfirmationTitle>
      {error && (
        <p role="alert" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      <ConfirmationActions>
        <ConfirmationAction
          variant="outline"
          disabled={!chatId || merging}
          onClick={notNow}
        >
          {NOT_NOW}
        </ConfirmationAction>
        <ConfirmationAction
          disabled={!canMerge || merging || pr?.mergeableState === "dirty"}
          onClick={merge}
        >
          {merging && <Spinner />}
          {method ? METHOD_LABEL[method] : "Merge"}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  )
}

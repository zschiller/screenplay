"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

import { useGitHubTokenProbe } from "@/hooks/use-github-token"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { AgentMessage } from "@/lib/agent/types"
import {
  canRunPr,
  latestCreatedPr,
  prAvailability,
  prReadiness,
  type ChatPr,
  type PrReadiness,
} from "@/lib/branch/pr-readiness"
import { chatStore } from "@/lib/chat-store"
import { useIsCreatingPr } from "@/lib/creating-pr-store"
import type { BranchPrInfo } from "@/lib/github-actions"
import type { BranchData, RepoData } from "@/lib/types"
import { useChatSessions } from "@/lib/yjs/react"

const scanned = new WeakMap<readonly AgentMessage[], ChatPr | null>()

function chatPrOf(chatId: string): ChatPr | null {
  const messages = chatStore.getSnapshot(chatId).messages
  let pr = scanned.get(messages)
  if (pr === undefined) {
    pr = latestCreatedPr(messages)
    scanned.set(messages, pr)
  }
  return pr
}

/** The newest PR any chat on the Workspace created, from the transcripts
 *  this tab holds. */
function useChatPr(branchId: string | undefined): ChatPr | null {
  const chats = useChatSessions()
  const key = chats
    .filter((c) => branchId && c.branchId === branchId)
    .map((c) => c.id)
    .join(",")
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = key
        ? key.split(",").map((id) => chatStore.subscribe(id, cb))
        : []
      return () => unsubs.forEach((u) => u())
    },
    [key]
  )
  // A string, so the snapshot compares equal while nothing changed.
  const getSnapshot = useCallback(() => {
    let newest: ChatPr | null = null
    for (const id of key ? key.split(",") : []) {
      const pr = chatPrOf(id)
      if (pr && (!newest || pr.number > newest.number)) newest = pr
    }
    return newest ? `${newest.number} ${newest.url}` : ""
  }, [key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "")
  return useMemo(() => {
    if (!snapshot) return null
    const [number, url] = snapshot.split(" ")
    return { number: Number(number), url }
  }, [snapshot])
}

/**
 * A Workspace's Create PR Readiness ({@link prReadiness}) with its run action,
 * from Workspace State, the GitHub probe, the creating-PR store and the chats'
 * `create_pr` results. The chat header and the Workspace menu both call it.
 */
export function usePrReadiness({
  branch,
  repo,
  pr,
  hasChanges,
  onCreatePr,
}: {
  branch: BranchData | undefined
  /** The Workspace's Repository: a GitHub remote is needed for a PR. */
  repo: RepoData | undefined
  /** The polled PR for the Workspace's branch. */
  pr: BranchPrInfo | null | undefined
  hasChanges: boolean
  /** Runs the create (through the creating-PR store). */
  onCreatePr: (branchId: string) => void
}): PrReadiness {
  const stateOf = useWorkspaceStates()
  const availability = prAvailability(repo, useGitHubTokenProbe())
  const running = useIsCreatingPr(branch?.id ?? "")
  const chatPr = useChatPr(branch?.id)
  if (!branch) {
    return {
      existingPr: null,
      shown: false,
      blocker: null,
      running: false,
      run: () => {},
    }
  }
  const state = prReadiness({
    branch,
    pr,
    chatPr,
    availability,
    agentWorking: stateOf(branch).agentWorking,
    hasChanges,
    running,
  })
  return {
    ...state,
    run: () => {
      if (canRunPr(state)) onCreatePr(branch.id)
    },
  }
}

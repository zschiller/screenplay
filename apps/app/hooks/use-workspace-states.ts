"use client"

import { useCallback } from "react"
import {
  roomWorkspaceFacts,
  sketchChatStatusLine,
  workspaceState,
  type RoomWorkspaceFacts,
  type WorkspaceState,
  type WorkspaceStateBranch,
  type WorkspaceStatusLine,
} from "@/lib/branch/workspace-state"
import { useOpenQuestionChats } from "@/hooks/use-open-question-chats"
import type { ChatSessionData, PlanData } from "@/lib/types"
import { useChatSessions, usePlans } from "@/lib/yjs/react"

// The Room doc's snapshots keep their reference until the next change, as
// does the open-question set, so the facts are worked out once per change and
// shared by every caller, however many mentions a Canvas draws.
const factsCache = new WeakMap<
  readonly ChatSessionData[],
  WeakMap<readonly PlanData[], WeakMap<ReadonlySet<string>, RoomWorkspaceFacts>>
>()

function cachedFacts(
  chats: readonly ChatSessionData[],
  plans: readonly PlanData[],
  openQuestions: ReadonlySet<string>
): RoomWorkspaceFacts {
  let byPlans = factsCache.get(chats)
  if (!byPlans) factsCache.set(chats, (byPlans = new WeakMap()))
  let byQuestions = byPlans.get(plans)
  if (!byQuestions) byPlans.set(plans, (byQuestions = new WeakMap()))
  let facts = byQuestions.get(openQuestions)
  if (!facts) {
    facts = roomWorkspaceFacts(chats, plans, openQuestions)
    byQuestions.set(openQuestions, facts)
  }
  return facts
}

/**
 * Each Workspace's {@link WorkspaceState}, from the Room doc's Chat Sessions
 * and plans and the chats' transcripts. Pass the Branch; the lookup supplies
 * the Room's facts, so no caller can show a Workspace in the wrong state by
 * leaving one out.
 */
export function useWorkspaceStates(): (
  branch: WorkspaceStateBranch
) => WorkspaceState {
  const chats = useChatSessions()
  const facts = cachedFacts(chats, usePlans(), useOpenQuestionChats(chats))
  return useCallback((branch) => workspaceState(branch, facts), [facts])
}

/**
 * Each Sketch Chat's status line (no repository, so no Workspace): working
 * while its turn is in flight, needs you while its question waits.
 */
export function useSketchChatStates(): (
  chat: ChatSessionData
) => WorkspaceStatusLine {
  const openQuestions = useOpenQuestionChats(useChatSessions())
  return useCallback(
    (chat) => sketchChatStatusLine(chat, openQuestions),
    [openQuestions]
  )
}

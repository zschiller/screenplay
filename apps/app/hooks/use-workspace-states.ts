"use client"

import { useCallback } from "react"
import {
  roomWorkspaceFacts,
  workspaceState,
  type RoomWorkspaceFacts,
  type WorkspaceState,
  type WorkspaceStateBranch,
} from "@/lib/branch/workspace-state"
import type { ChatSessionData, PlanData } from "@/lib/types"
import { useChatSessions, usePlans } from "@/lib/yjs/react"

// The Room doc's snapshots keep their reference until the next change, so the
// facts are worked out once per change and shared by every caller, however
// many mentions a Canvas draws.
const factsCache = new WeakMap<
  readonly ChatSessionData[],
  WeakMap<readonly PlanData[], RoomWorkspaceFacts>
>()

function cachedFacts(
  chats: readonly ChatSessionData[],
  plans: readonly PlanData[]
): RoomWorkspaceFacts {
  let byPlans = factsCache.get(chats)
  if (!byPlans) factsCache.set(chats, (byPlans = new WeakMap()))
  let facts = byPlans.get(plans)
  if (!facts) byPlans.set(plans, (facts = roomWorkspaceFacts(chats, plans)))
  return facts
}

/**
 * Each Workspace's {@link WorkspaceState}, from the Room doc's Chat Sessions
 * and plans. Pass the Branch; the lookup supplies the Room's facts, so no
 * caller can show a Workspace in the wrong state by leaving one out.
 */
export function useWorkspaceStates(): (
  branch: WorkspaceStateBranch
) => WorkspaceState {
  const facts = cachedFacts(useChatSessions(), usePlans())
  return useCallback((branch) => workspaceState(branch, facts), [facts])
}

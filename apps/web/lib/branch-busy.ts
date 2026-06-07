import type { ChatSessionData } from "@/lib/types"

/**
 * The minimal Chat Session shape {@link isBranchBusy} reads. Accepting a
 * structural subset of {@link ChatSessionData} (rather than the whole type)
 * keeps the predicate trivially testable with bare fixtures and lets any
 * caller — not just Y.Doc holders — feed it.
 */
export type BranchBusyChat = Pick<
  ChatSessionData,
  "branchId" | "closedAt" | "isStreaming"
>

/**
 * Is the given Branch's agent currently working?
 *
 * A Branch has no standalone "agent status" field in screenplay's model — the
 * Engine's working state lives in the per-chat `isStreaming` flag, set on the
 * Y.Doc `ChatSessionData` across `chat-stream-start` / `chat-stream-end` (see
 * `chat-store.ts` and the hydration in `canvas.tsx`). So "the branch's agent is
 * running" is, concretely, "some still-open chat targeting this branch is
 * streaming." A chat counts only while it is open (`closedAt` unset).
 *
 * This is the single source of truth for the Branch menu's "disable while
 * working" conditions (Rebase on `main` today; Create PR, Restart sandbox, and
 * Recreate from scratch later) as well as the sidebar's "working" spinner.
 * Deriving busy in one pure function means every disable condition — and the
 * spinner — agree by construction instead of drifting across hand-rolled checks.
 */
export function isBranchBusy(
  branchId: string,
  chats: readonly BranchBusyChat[]
): boolean {
  return chats.some(
    (chat) =>
      chat.branchId === branchId && !chat.closedAt && chat.isStreaming === true
  )
}

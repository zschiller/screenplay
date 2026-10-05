"use client"

import { WorkspaceStateGlyph } from "@/components/workspace-mention"
import { MaybeWorkspaceHoverCard } from "@/components/workspace-hover-card"
import { isSketchChat } from "@/lib/chat/sketch-chat"
import type { BranchData, ChatSessionData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

/**
 * The chat working on a Mockup or Document right now (#1726, spec #1723): the
 * chat holding it, named as the sidebar names it. A Workspace's chat by its
 * Workspace, a chat with no repository by its own label.
 */
export type WorkingChat = {
  chatId: string
  label: string
  /** The Workspace its hover card describes; none for a chat with no repository. */
  branchId?: string
}

/** Each held layer's {@link WorkingChat}, by layer id. */
export function workingChatsOf(
  holders: ReadonlyMap<string, ChatSessionData>,
  branches: readonly BranchData[]
): Map<string, WorkingChat> {
  const out = new Map<string, WorkingChat>()
  for (const [layerId, chat] of holders) {
    const branch =
      !isSketchChat(chat) && chat.branchId
        ? branches.find((b) => b.id === chat.branchId)
        : undefined
    out.set(
      layerId,
      branch
        ? {
            chatId: chat.id,
            label: workspaceLabel(branch),
            branchId: branch.id,
          }
        : { chatId: chat.id, label: chat.label }
    )
  }
  return out
}

/** The state line that draws the 9-dot: a chat at work on a layer. */
export const WORKING = {
  kind: "idle",
  state: "working",
  text: "Working",
} as const

/**
 * A layer label's working chat: the 9-dot, then its name, with no PR, opening
 * the Workspace's hover card. No taller than the title beside it, so the
 * label only grows to the right when it shows (#1726).
 */
export function WorkingChatMention({ chat }: { chat: WorkingChat }) {
  return (
    <MaybeWorkspaceHoverCard branchId={chat.branchId} side="bottom">
      {/* The mention doesn't take the trigger's props; this span does. Names
          win: the chat gives up its width first. */}
      <span
        data-slot="working-chat"
        className="flex min-w-10 shrink-[100] items-center gap-1 text-xs text-muted-foreground"
      >
        <span role="img" aria-label="Working" className="flex shrink-0">
          <WorkspaceStateGlyph line={WORKING} />
        </span>
        <span className="min-w-0 truncate">{chat.label}</span>
      </span>
    </MaybeWorkspaceHoverCard>
  )
}

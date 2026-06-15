import type { ChatSessionData, TerminalTabData } from "@/lib/types"

/**
 * Tab Pool — the pure decision behind closing a chat or terminal tab
 * (`apps/app/CONTEXT.md`, "Tab Pool"). Given a target's pool and the tab being
 * closed, it returns what survives, where selection should land, and whether
 * the panel must respawn a default tab. It performs no effects: the caller
 * applies the outcome (`deleteTerminalTabAction`, `killTerminalSession`,
 * `addChatSession` / `createDefaultTabForBranch`, and the selection write),
 * mirroring the Gesture Intent / Canvas Operations "decide purely, apply at the
 * call site" shape. React-free and tested against plain values.
 *
 * Two invariants live here so the two close handlers cannot drift apart:
 *
 * 1. **Separate pools by target.** Agent chats (keyed by `branchId`) and doc
 *    chats (keyed by `markdownLayerId`) are isolated *by construction* in
 *    {@link buildTabPool}, so a respawned chat never loses its document target.
 * 2. **Never empty while the target lives.** Closing the last tab returns a
 *    {@link DefaultTabSpec} respawn rather than leaving the panel blank.
 */

/** The target a Tab Pool belongs to — an agent Branch or a markdown document. */
export type TabPoolTarget =
  | { kind: "agent"; branchId: string }
  | { kind: "doc"; markdownLayerId: string }

/**
 * A target's open tabs: its persisted Chat Sessions plus, for an agent target,
 * its ephemeral Terminal Tabs. Doc targets have no terminals, so `terminals` is
 * always empty for them. Built by {@link buildTabPool} from the room-wide lists
 * so the same-target filtering exists in exactly one place.
 */
export type TabPool = {
  target: TabPoolTarget
  /** Open chat sessions for the target (closed ones already excluded). */
  chats: ChatSessionData[]
  /** Terminal tabs for the target — always empty for a doc target. */
  terminals: TerminalTabData[]
}

/**
 * What to respawn when the last tab on a live target is closed. Names only the
 * target; the call site decides the agent's default *kind* (chat vs terminal,
 * from the per-user pref) and performs the create + select. Doc targets always
 * respawn a chat.
 */
export type DefaultTabSpec =
  | { target: "agent"; branchId: string }
  | { target: "doc"; markdownLayerId: string }

/** A surviving tab, flattened across kinds for the caller's convenience. */
export type SurvivingTab = {
  id: string
  kind: "chat" | "terminal"
  createdAt: number
}

/**
 * The outcome of a close. Exactly one of `respawn` (last tab closed → recreate)
 * or `nextSelectedId` (selection moves) is meaningful per close:
 *
 * - `respawn` set: the panel was emptied; the caller creates + selects the
 *   respawned default tab, so `nextSelectedId` is omitted.
 * - `nextSelectedId` set: the *selected* tab was closed; selection falls to this
 *   id (or `null` to clear). It is omitted entirely when a non-selected tab is
 *   closed — selection then stays put.
 */
export type TabCloseOutcome = {
  surviving: SurvivingTab[]
  nextSelectedId?: string | null
  respawn?: DefaultTabSpec
}

/**
 * Scope the room-wide chat and terminal lists down to one target's pool. This
 * is the single place agent and doc pools are kept apart: an agent pool matches
 * `branchId` (which excludes doc chats, whose `branchId` is undefined), a doc
 * pool matches `markdownLayerId` (which excludes agent chats). Closed chats are
 * dropped; the tab being closed is left in (still open at decision time) and
 * removed by {@link resolveTabClose}.
 */
export function buildTabPool(
  target: TabPoolTarget,
  chats: readonly ChatSessionData[],
  terminals: readonly TerminalTabData[]
): TabPool {
  if (target.kind === "agent") {
    return {
      target,
      chats: chats.filter((c) => c.branchId === target.branchId && !c.closedAt),
      terminals: terminals.filter((t) => t.branchId === target.branchId),
    }
  }
  return {
    target,
    chats: chats.filter(
      (c) => c.markdownLayerId === target.markdownLayerId && !c.closedAt
    ),
    terminals: [],
  }
}

/**
 * Decide what happens when `closingId` is closed out of `pool`.
 *
 * @param selectedId    the currently selected tab id (or null) — selection only
 *                      moves when the closing tab is the selected one.
 * @param preferredNextId an explicit next-selection hint from the caller (e.g.
 *                      the tab strip's neighbour); tried before the fallbacks.
 *
 * Fallback order when the selected tab is closed: explicit hint → first sibling
 * chat → first surviving terminal → none. The last tab on a live target instead
 * respawns the target's default.
 */
export function resolveTabClose(
  pool: TabPool,
  closingId: string,
  selectedId: string | null,
  preferredNextId?: string
): TabCloseOutcome {
  const survivingChats = pool.chats
    .filter((c) => c.id !== closingId)
    .sort((a, b) => a.createdAt - b.createdAt)
  const survivingTerminals = pool.terminals
    .filter((t) => t.id !== closingId)
    .sort((a, b) => a.createdAt - b.createdAt)

  const surviving: SurvivingTab[] = [
    ...survivingChats.map(
      (c): SurvivingTab => ({ id: c.id, kind: "chat", createdAt: c.createdAt })
    ),
    ...survivingTerminals.map(
      (t): SurvivingTab => ({
        id: t.id,
        kind: "terminal",
        createdAt: t.createdAt,
      })
    ),
  ]

  // Never-empty invariant: the last tab on a live target respawns its default.
  // Selection then follows the respawned tab at the call site, so no
  // nextSelectedId here.
  if (surviving.length === 0) {
    return { surviving, respawn: respawnSpecFor(pool.target) }
  }

  // Selection only moves when the closing tab was the selected one. A
  // non-selected close leaves selection untouched (nextSelectedId omitted).
  if (selectedId === closingId) {
    return {
      surviving,
      nextSelectedId:
        preferredNextId ??
        survivingChats[0]?.id ??
        survivingTerminals[0]?.id ??
        null,
    }
  }

  return { surviving }
}

function respawnSpecFor(target: TabPoolTarget): DefaultTabSpec {
  return target.kind === "agent"
    ? { target: "agent", branchId: target.branchId }
    : { target: "doc", markdownLayerId: target.markdownLayerId }
}

import { ANY_BRANCH } from "@/lib/canvas/element-targeting"
import type { ChatTarget } from "@/lib/chat/chat-target"

/**
 * What the Composer offers for one Chat Target kind, and how its empty chat
 * reads (`apps/app/CONTEXT.md`, "Chat Target"). AgentChat reads a row of
 * {@link CHAT_CAPABILITIES} instead of branching on the kind, so a new kind is
 * one new row. React-free, tested as plain data.
 */
export interface ChatCapabilities {
  /** The `/` skill menu: the Skills this chat's `read_skill` reads (#1556).
   *  A Workspace chat's include its Branch's; the others list the canvas's
   *  and their own App Skills. Off, `/` stays a literal slash. */
  skills: boolean
  /** The Plan toggle. Only the sandbox toolset has the `submit_plan` gate, so a
   *  plan-mode turn anywhere else would change nothing (#743). */
  planMode: boolean
  /** Picking an element from a frame or Mockup: the Branch's own, or for the
   *  Coordinator any on the canvas, which it passes on to the owning chat. */
  elementPicking: boolean
  /** Why the target button is off when there's nothing to pick from. */
  pickHint?: string
  placeholder: string
  /** The empty chat, worded in the UI's own nouns. */
  emptyTitle: string
  emptyBody: string
  /** Asks that work for this kind. A starter fills the composer, not sends. */
  starters: readonly string[]
}

export const CHAT_CAPABILITIES: Record<ChatTarget["kind"], ChatCapabilities> = {
  // A frame chat changes the Workspace's code, and so what its frames show.
  agent: {
    skills: true,
    planMode: true,
    elementPicking: true,
    pickHint: "Show this chat in a frame first.",
    placeholder: "Ask the agent… (@ document, / skill)",
    emptyTitle: "Change what your frames show",
    emptyBody:
      "The agent edits this chat’s code and can run commands, and your frames update as it works. It can write documents on the canvas too.",
    starters: [
      "Explain how this page is built",
      "Tighten the spacing on mobile",
      "Add a loading state",
    ],
  },
  // The Coordinator sees the whole canvas, so it targets in any frame or
  // Mockup and hands the element to the chat that owns it.
  room: {
    skills: true,
    planMode: false,
    elementPicking: true,
    pickHint: "Add a frame or mockup first.",
    placeholder: "Ask the Coordinator… (@ document, / skill)",
    emptyTitle: "Ask about this canvas",
    emptyBody:
      "The Coordinator sees every chat, frame and document on this canvas.",
    starters: [
      "What’s on this canvas?",
      "Which chats have a PR?",
      "What changed in each chat?",
    ],
  },
  // A chat with no repository writes pages, not code.
  sketch: {
    skills: true,
    planMode: false,
    elementPicking: false,
    placeholder: "Ask for a mockup or a document… (@ document, / skill)",
    emptyTitle: "Sketch without code",
    emptyBody:
      "This chat has no repository. It writes mockups and documents on the canvas.",
    starters: [
      "Mock up a pricing page",
      "Sketch three hero layouts",
      "Write a one-page plan",
    ],
  },
}

/**
 * The capabilities of `target`, with the sandbox-backed ones resolved to the
 * values the Composer takes: the Sandbox whose Skills the `/` menu lists (or,
 * for a chat with no Branch, which chat's App Skills it lists) and the Branch
 * id Element Targeting picks for ({@link ANY_BRANCH} for the Coordinator).
 * Each is set only when the row turns it on and the target has one.
 */
export function chatCapabilitiesOf(target: ChatTarget): ChatCapabilities & {
  skillSandboxName?: string
  skillChat?: "room" | "sketch"
  pickBranchId?: string
} {
  const row = CHAT_CAPABILITIES[target.kind]
  const sandbox = target.kind === "agent" ? target : undefined
  return {
    ...row,
    skillSandboxName: row.skills ? sandbox?.sandboxName : undefined,
    skillChat: row.skills && target.kind !== "agent" ? target.kind : undefined,
    pickBranchId: !row.elementPicking
      ? undefined
      : target.kind === "room"
        ? ANY_BRANCH
        : sandbox?.branchId,
  }
}

import type { ChatTarget } from "@/lib/chat/chat-target"

/**
 * What the Composer offers for one Chat Target kind, and how its empty chat
 * reads (`apps/app/CONTEXT.md`, "Chat Target"). AgentChat reads a row of
 * {@link CHAT_CAPABILITIES} instead of branching on the kind, so a new kind is
 * one new row. React-free, tested as plain data.
 */
export interface ChatCapabilities {
  /** The `/` skill menu. Needs a sandbox to enumerate the Branch's Skills and
   *  run `read_skill`; without one, `/` stays a literal slash. */
  skills: boolean
  /** The Plan toggle. Only the sandbox toolset has the `submit_plan` gate, so a
   *  plan-mode turn anywhere else would change nothing (#743). */
  planMode: boolean
  /** Picking an element from a frame. Needs the Branch's preview to pick from. */
  elementPicking: boolean
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
    placeholder: "Ask the agent… (@ document, / skill)",
    emptyTitle: "Change what your frames show",
    emptyBody:
      "The agent edits this workspace's code and can run commands, and your frames update as it works. It can write documents on the canvas too.",
    starters: [
      "Explain how this page is built",
      "Tighten the spacing on mobile",
      "Add a loading state",
    ],
  },
  // The Coordinator sees the whole canvas.
  room: {
    skills: false,
    planMode: false,
    elementPicking: false,
    placeholder: "Ask the Coordinator… (@ document)",
    emptyTitle: "Ask about this canvas",
    emptyBody:
      "The Coordinator sees every workspace, frame and document on this canvas.",
    starters: [
      "What's on this canvas?",
      "Which workspaces have a PR?",
      "What changed in each workspace?",
    ],
  },
  // A chat with no repository writes pages, not code.
  sketch: {
    skills: false,
    planMode: false,
    elementPicking: false,
    placeholder: "Ask for a mockup or a document… (@ document)",
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
 * values the Composer takes: the Sandbox whose Skills the `/` menu lists and
 * the Branch id Element Targeting picks for. Each is set only when the row
 * turns it on and the target has a sandbox.
 */
export function chatCapabilitiesOf(target: ChatTarget): ChatCapabilities & {
  skillSandboxName?: string
  pickBranchId?: string
} {
  const row = CHAT_CAPABILITIES[target.kind]
  const sandbox = target.kind === "agent" ? target : undefined
  return {
    ...row,
    skillSandboxName: row.skills ? sandbox?.sandboxName : undefined,
    pickBranchId: row.elementPicking ? sandbox?.branchId : undefined,
  }
}

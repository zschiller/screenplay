import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"
import { MARKED_DONE_RESULT } from "./done-result"

export { MARKED_DONE_RESULT }

/**
 * The agent marks its own chat done (#1705): today's Done (#976), set by the
 * agent at the end of a turn that leaves nothing for the person. Its sandbox
 * stops once the turn is over (Turn Launch's `settleDone`), its frames leave
 * the Canvas and it moves to the Chats menu's Done section. A new message
 * reopens it.
 *
 * The tool only decides and words; the {@link DonePorts} read and write the
 * Room doc and the run, so this module tests without either
 * (`done-ports.ts` is the live side).
 */
export interface DonePorts {
  /** What the guard reads, fresh; null when the Workspace is gone. */
  state(): Promise<DoneState | null>
  /** Set Done on the Workspace. Its sandbox stops when the turn ends. */
  markDone(): Promise<void>
}

export interface DoneState {
  /** Already Done (a person marked it, or an earlier call did). */
  done: boolean
  /** The Branch's current PR, if it has one. */
  pr: { number: number; state: "open" | "closed" | "merged" } | null
  /** An earlier PR from the Branch that is still open. */
  openPastPr: number | null
  /** A person sent a message into this turn, or one waits for it. */
  personMessage: boolean
}

/**
 * Why the chat can't be marked done, as the agent is told; null when it can.
 * Done needs the current PR merged or closed, no PR still open, and no word
 * from a person waiting on this turn.
 */
export function markDoneRefusal(state: DoneState): string | null {
  const { pr } = state
  if (!pr) {
    return "Not marked done: this chat has no pull request. Mark it done only once its pull request has merged or closed."
  }
  if (pr.state === "open") {
    return `Not marked done: pull request #${pr.number} is still open.`
  }
  if (state.openPastPr !== null) {
    return `Not marked done: pull request #${state.openPastPr} is still open.`
  }
  if (state.personMessage) {
    return "Not marked done: the user sent a message during this turn. Answer it instead."
  }
  return null
}

export function buildDoneTools(ports: DonePorts) {
  const tools = {
    mark_done: tool({
      description:
        "Mark this chat done once its work is finished: its pull request has merged or closed, no pull request is open, and nothing is left for the user. The same as the user’s Mark as done: when this turn ends its sandbox stops, its frames leave the canvas and it moves to Done. Writing in the chat reopens it. Call it last in a turn whose final message asks nothing; never when that message asks the user something. It refuses while a pull request is open or the user has written during the turn.",
      inputSchema: z.object({
        reason: z
          .string()
          .min(1)
          .describe(
            "One short sentence the user sees on the Marked done card, saying why, e.g. “#482 merged and nothing is waiting on you.”"
          ),
      }),
      execute: async () => {
        const state = await ports.state()
        if (!state) return "Not marked done: this chat is gone."
        if (state.done) return "This chat is already done."
        const refusal = markDoneRefusal(state)
        if (refusal) return refusal
        await ports.markDone()
        return MARKED_DONE_RESULT
      },
    }),
  }
  return annotateTools(tools, {
    // Reversible: a message or Reopen brings the chat back as it was.
    mark_done: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
}

export type DoneTools = ReturnType<typeof buildDoneTools>

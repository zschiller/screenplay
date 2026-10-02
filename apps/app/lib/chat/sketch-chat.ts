import type { ChatSessionData } from "@/lib/types"

/**
 * The Sketch Chat (`apps/app/CONTEXT.md`, "Sketch Chat"): a chat with no
 * repository, so no Branch, sandbox or dev server. It makes and edits only
 * Documents and Mockups, which is all a canvas with no repository can hold,
 * and it can start on any canvas when the work needs no code. React-free and
 * Yjs-free so the client and server share it.
 */

/** What a Sketch Chat is called until its first message names it. */
export const SKETCH_CHAT_LABEL = "Untitled"

/** Whether `chat` is a Sketch Chat. */
export function isSketchChat(
  chat: Pick<ChatSessionData, "target"> | undefined | null
): boolean {
  return chat?.target === "sketch"
}

/** A new Sketch Chat's identity record. */
export function sketchChatSession(
  id: string,
  createdAt: number,
  opts: { label?: string } = {}
): ChatSessionData {
  return {
    id,
    target: "sketch",
    label: opts.label || SKETCH_CHAT_LABEL,
    createdAt,
  }
}

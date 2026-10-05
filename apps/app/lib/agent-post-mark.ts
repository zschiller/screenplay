/**
 * The mark on a review or review comment the agent posts (#1704). The agent
 * posts with a person's GitHub account, so the author can't tell its reviews
 * from theirs; PR Watch reads this mark instead, so a review the agent posted
 * never wakes the agent. An HTML comment, so GitHub draws nothing for it.
 */
export const AGENT_POST_MARK = "<!-- screenplay:agent -->"

/** `body` with the mark at its end. */
export function markAgentPost(body: string | undefined): string {
  return body?.trim() ? `${body}\n\n${AGENT_POST_MARK}` : AGENT_POST_MARK
}

/** Whether `body` carries the mark. */
export function isAgentPost(body: string | null | undefined): boolean {
  return !!body?.includes(AGENT_POST_MARK)
}

/** `body` without the mark, as the agent reads it back. */
export function unmarkAgentPost(body: string): string {
  return body.replace(AGENT_POST_MARK, "").trimEnd()
}

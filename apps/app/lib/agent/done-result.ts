/**
 * What `mark_done` says when it marked the chat done (#1705). The chat's
 * Marked done card shows for a call whose result starts with it, so it lives
 * apart from the tool, where client code can read it.
 */
export const MARKED_DONE_RESULT =
  "Marked this chat done. Its sandbox stops when this turn ends, its frames are hidden and it’s listed under Done. A new message reopens it. End the turn now, without asking anything."

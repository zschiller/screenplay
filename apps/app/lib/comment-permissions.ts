/**
 * Who may change what in a comment thread. The one rule both the thread card
 * (which actions it offers) and the server actions (which writes they accept)
 * read, so the UI never offers an action the server refuses, or the reverse.
 *
 * Any room member may reply, resolve and reopen. Only a comment's author may
 * edit or delete it, and only the person who started a thread may delete the
 * whole thread.
 */

export function canEditComment(
  comment: { authorId: string },
  userId: string | null
): boolean {
  return userId !== null && comment.authorId === userId
}

export function canDeleteComment(
  comment: { authorId: string },
  userId: string | null
): boolean {
  return canEditComment(comment, userId)
}

export function canDeleteThread(
  thread: { createdBy: string },
  userId: string | null
): boolean {
  return userId !== null && thread.createdBy === userId
}

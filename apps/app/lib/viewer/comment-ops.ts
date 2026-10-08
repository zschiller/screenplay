import type { NewThreadInput } from "@/lib/comment-input"

/**
 * One comment operation a viewer's page posts to its canvas link's comments
 * route (Sharing, #1934): the viewer's side of each comment server action.
 */
export type ViewerCommentOp =
  | { op: "create"; thread: NewThreadInput }
  | { op: "reply"; threadId: string; body: string }
  | { op: "edit"; commentId: string; body: string }
  | { op: "deleteComment"; commentId: string }
  | { op: "deleteThread"; threadId: string }
  | { op: "resolve"; threadId: string; resolved: boolean }
  | { op: "read"; threadId: string }
  | { op: "unread"; threadId: string }

/** The operation a posted body names, with only its own fields, or null. */
export function parseViewerCommentOp(raw: unknown): ViewerCommentOp | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const id = (key: string) =>
    typeof v[key] === "string" && v[key].length > 0 && v[key].length <= 256
      ? (v[key] as string)
      : null
  const body = typeof v.body === "string" ? v.body : null
  switch (v.op) {
    case "create":
      return v.thread && typeof v.thread === "object"
        ? { op: "create", thread: v.thread as NewThreadInput }
        : null
    case "reply": {
      const threadId = id("threadId")
      return threadId && body !== null ? { op: "reply", threadId, body } : null
    }
    case "edit": {
      const commentId = id("commentId")
      return commentId && body !== null ? { op: "edit", commentId, body } : null
    }
    case "deleteComment": {
      const commentId = id("commentId")
      return commentId ? { op: "deleteComment", commentId } : null
    }
    case "resolve": {
      const threadId = id("threadId")
      return threadId && typeof v.resolved === "boolean"
        ? { op: "resolve", threadId, resolved: v.resolved }
        : null
    }
    case "deleteThread":
    case "read":
    case "unread": {
      const threadId = id("threadId")
      return threadId ? { op: v.op, threadId } : null
    }
    default:
      return null
  }
}

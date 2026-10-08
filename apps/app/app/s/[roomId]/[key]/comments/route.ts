import { parseNewThread } from "@/lib/comment-input"
import { commentsForViewer, NotYourCommentError } from "@/lib/comments"
import { parseViewerCommentOp } from "@/lib/viewer/comment-ops"

type Params = { params: Promise<{ roomId: string; key: string }> }

/**
 * A viewer's comments on the canvas their link names (Sharing, #1934), the
 * one write the viewer listener accepts. GET lists the canvas's threads as
 * the viewer sees them; POST runs one comment operation as the viewer. The
 * viewer's stand-in for the comment server actions, which the listener
 * refuses like every other POST.
 */
export async function GET(_request: Request, { params }: Params) {
  const { roomId, key } = await params
  const viewer = await commentsForViewer(roomId, key)
  if (!viewer) return new Response("Not found", { status: 404 })
  return Response.json(await viewer.listThreads(), {
    headers: { "Cache-Control": "no-store" },
  })
}

export async function POST(request: Request, { params }: Params) {
  const { roomId, key } = await params
  // Only the viewer's own page posts here: a JSON body (which no plain form
  // can send) from the same origin.
  if (!sameOrigin(request) || !isJson(request)) {
    return new Response("Forbidden", { status: 403 })
  }
  const viewer = await commentsForViewer(roomId, key)
  if (!viewer) return new Response("Not found", { status: 404 })
  const op = parseViewerCommentOp(await request.json().catch(() => null))
  if (!op) return new Response("Bad request", { status: 400 })
  try {
    switch (op.op) {
      case "create":
        return Response.json(
          await viewer.createThread(parseNewThread(op.thread))
        )
      case "reply":
        return Response.json(await viewer.appendComment(op))
      case "edit":
        await viewer.editComment(op)
        break
      case "deleteComment":
        await viewer.deleteComment(op)
        break
      case "deleteThread":
        await viewer.deleteThread(op.threadId)
        break
      case "resolve":
        await viewer.setThreadResolved(op)
        break
      case "read":
        await viewer.markThreadRead(op.threadId)
        break
      case "unread":
        await viewer.markThreadUnread(op.threadId)
        break
    }
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof NotYourCommentError) {
      return new Response(err.message, { status: 403 })
    }
    console.warn(
      `[viewers] comment ${op.op} failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return new Response("Couldn’t save that", { status: 400 })
  }
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  const host = request.headers.get("host")
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function isJson(request: Request): boolean {
  return (request.headers.get("content-type") ?? "").startsWith(
    "application/json"
  )
}

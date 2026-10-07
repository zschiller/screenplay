import { NextResponse, after } from "next/server"
import { getGitHubToken } from "@/lib/auth-helpers"
import { githubAccess } from "@/lib/github-access"
import {
  startBranchProvisioning,
  type BranchProvisionRequest,
} from "@/lib/branch/provisioning-live"
import { sendPendingSeed } from "@/lib/agent/turn-launch-live"
import { openRoomForRoute } from "@/lib/room-access"

export const runtime = "nodejs"
export const maxDuration = 300

interface CreateRequest extends BranchProvisionRequest {
  roomId: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateRequest
  const { roomId, branchId } = body

  // Room Access before the token, the lock or any provisioning: every write
  // below reaches the room through this handle.
  const room = await openRoomForRoute(roomId)
  if (room instanceof Response) {
    // The sidebar's failure card reads `{ error }` (use-branch-intake).
    return NextResponse.json(
      { error: await room.text() },
      { status: room.status }
    )
  }

  // Brokered git (Hosted) can't do anything without a token: branches are
  // created via the GitHub API and clones are token-authed. Host git can: it
  // rides the host's own auth and branches are created locally when no token
  // resolves (PRD #428), so a missing token must not block creation there.
  const ghToken = (await getGitHubToken()) ?? undefined
  if (!ghToken && githubAccess.git.kind === "brokered") {
    return NextResponse.json(
      { error: "Sign in with GitHub again to start this chat." },
      { status: 401 }
    )
  }

  // The member who asked for the create owns the Workspace (#898). A Retry
  // keeps the owner it already has.
  await room.mutateDoc(({ branches }) => {
    const branch = branches.get(branchId)
    if (branch && !branch.createdBy) {
      branches.update(branchId, { createdBy: room.userId })
    }
  })

  // A second request for the same Branch (a reload, another member) finds the
  // lock held and leaves the work to the first.
  await startBranchProvisioning(room, body, {
    ghToken,
    runAfter: after,
    // A Workspace the Coordinator created sends its seed message once it runs,
    // whether this is its first attempt or a Retry.
    onCodeReady: (id) => sendPendingSeed(room, id),
  })

  return NextResponse.json({ ok: true })
}

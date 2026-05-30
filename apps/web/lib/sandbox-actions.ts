"use server"

import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"

/**
 * Team + project slugs for the sandbox CLI, decoded from the project's OIDC
 * token. Used to build a `sandbox ssh --scope <team> --project <project> <name>`
 * string that resolves from anywhere. Returns {} if the token is missing or
 * malformed — the UI falls back to a bare `sandbox ssh <name>`.
 */
export async function getSandboxCliContext(): Promise<{ scope?: string; project?: string }> {
  const token = process.env.VERCEL_OIDC_TOKEN
  if (!token) return {}
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    )
    return {
      scope: typeof payload.owner === "string" ? payload.owner : undefined,
      project: typeof payload.project === "string" ? payload.project : undefined,
    }
  } catch {
    return {}
  }
}

export async function getGitHubToken(): Promise<string | null> {
  const userId = await getUserId()
  if (!userId) return null
  return getGitHubTokenForUser(userId)
}

/**
 * Resolve the user whose GitHub identity should be used for a given sandbox
 * operation. Prefers the live session user on the current request (so each
 * collaborator's git actions are correctly attributed to them). Falls back to
 * the workspace/project owner for non-interactive paths — the owner is the
 * one constant identity tied to the project.
 */
export async function resolveActingUserId(
  fallbackRoomId?: string,
): Promise<string | null> {
  const live = await getUserId()
  if (live) return live
  if (!fallbackRoomId) return null
  const { getRoomOwnerId } = await import("./projects-actions")
  return getRoomOwnerId(fallbackRoomId)
}

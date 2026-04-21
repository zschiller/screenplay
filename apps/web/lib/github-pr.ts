import { clerkClient } from "@clerk/nextjs/server"
import { liveblocks } from "@/lib/liveblocks-server"

export interface CreateGitHubPrInput {
  userId: string
  roomId: string
  sandboxName: string
  title?: string
  body?: string
}

export interface CreateGitHubPrResult {
  url: string
  number: number
}

async function getUserGitHubToken(userId: string): Promise<string | null> {
  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  return tokens.data?.[0]?.token ?? null
}

export async function createGitHubPr(
  input: CreateGitHubPrInput,
): Promise<CreateGitHubPrResult> {
  const { userId, roomId, sandboxName, title, body } = input

  let branch: string | undefined
  let workspaceId: string | undefined
  let repoOwner: string | undefined
  let repoName: string | undefined
  let defaultBranch: string | undefined

  await liveblocks.mutateStorage(roomId, ({ root }) => {
    const sandboxes = root.get("sandboxes")
    for (const [, ag] of sandboxes) {
      if (ag.get("sandboxName") === sandboxName) {
        branch = ag.get("branch")
        workspaceId = ag.get("workspaceId")
        break
      }
    }
    if (workspaceId) {
      const ws = root.get("workspaces").get(workspaceId)
      if (ws) {
        repoOwner = ws.get("repoOwner")
        repoName = ws.get("repoName")
        defaultBranch = ws.get("defaultBranch")
      }
    }
  })

  if (!branch) throw new Error("Agent branch not found in storage")
  if (!repoOwner || !repoName || !defaultBranch) {
    throw new Error("Workspace repo info not found in storage")
  }

  const token = await getUserGitHubToken(userId)
  if (!token) throw new Error("Not authenticated with GitHub")

  const res = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: title?.trim() || branch,
        body: body ?? "",
        head: branch,
        base: defaultBranch,
      }),
    },
  )

  if (!res.ok) {
    let message = `GitHub API error (${res.status})`
    try {
      const errJson = (await res.json()) as {
        message?: string
        errors?: Array<{ message?: string }>
      }
      if (errJson.message) message = errJson.message
      if (Array.isArray(errJson.errors) && errJson.errors.length > 0) {
        const detail = errJson.errors
          .map((e) => e.message)
          .filter(Boolean)
          .join("; ")
        if (detail) message = `${message}: ${detail}`
      }
    } catch {}
    throw new Error(message)
  }

  const pr = (await res.json()) as { html_url: string; number: number }
  return { url: pr.html_url, number: pr.number }
}

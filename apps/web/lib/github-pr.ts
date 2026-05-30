import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { readRoomDoc } from "@/lib/yjs/server"

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

export async function createGitHubPr(
  input: CreateGitHubPrInput,
): Promise<CreateGitHubPrResult> {
  const { userId, roomId, sandboxName, title, body } = input

  const { branch, repoOwner, repoName, defaultBranch } = await readRoomDoc(
    roomId,
    ({ branches, repos }) => {
      const agent = branches.toArray().find((a) => a.sandboxName === sandboxName)
      if (!agent) return {}
      const ws = repos.get(agent.repoId)
      return {
        branch: agent.ref,
        repoOwner: ws?.repoOwner,
        repoName: ws?.repoName,
        defaultBranch: ws?.defaultBranch,
      }
    },
  )

  if (!branch) throw new Error("Agent branch not found in storage")
  if (!repoOwner || !repoName || !defaultBranch) {
    throw new Error("Workspace repo info not found in storage")
  }

  const token = await getGitHubTokenForUser(userId)
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

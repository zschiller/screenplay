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

/**
 * Derive a PR title/body from a branch's commits, deterministically — no model
 * turn. This is what lets the UI open a PR directly (#355): with the agent out
 * of the loop there's no one to write the title/body, so we synthesise them from
 * the commit log the same way a human skimming `git log` would.
 *
 * - **No commits** (head is level with base): fall back to the branch name as the
 *   title and an empty body. GitHub will reject the create anyway, but we never
 *   want to surface an empty title.
 * - **One commit**: its subject line is the title and its message body is the PR
 *   body — the single-commit case where the commit message *is* the PR.
 * - **Many commits**: the first subject is the title and the body is a bullet
 *   list of every subject, a reasonable changelog.
 */
export function buildPrContent(
  commits: ReadonlyArray<{ commit: { message: string } }>,
  fallbackTitle: string
): { title: string; body: string } {
  const subjects = commits
    .map((c) => c.commit.message.split("\n")[0]?.trim())
    .filter((s): s is string => Boolean(s))

  if (subjects.length === 0) return { title: fallbackTitle, body: "" }
  if (subjects.length === 1) {
    const body = commits[0].commit.message.split("\n").slice(1).join("\n").trim()
    return { title: subjects[0], body }
  }
  return { title: subjects[0], body: subjects.map((s) => `- ${s}`).join("\n") }
}

/**
 * Fetch the commits unique to `head` (relative to `base`) and fold them into a
 * PR title/body via {@link buildPrContent}. Returns null on any failure so the
 * caller falls back to a branch-name title rather than aborting the create.
 */
async function fetchPrContent(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token: string
): Promise<{ title: string; body: string } | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      commits?: Array<{ commit: { message: string } }>
    }
    return buildPrContent(data.commits ?? [], head)
  } catch {
    return null
  }
}

export async function createGitHubPr(
  input: CreateGitHubPrInput
): Promise<CreateGitHubPrResult> {
  const { userId, roomId, sandboxName, title, body } = input

  const { branch, repoOwner, repoName, defaultBranch } = await readRoomDoc(
    roomId,
    ({ branches, repos }) => {
      const agent = branches
        .toArray()
        .find((a) => a.sandboxName === sandboxName)
      if (!agent) return {}
      const ws = repos.get(agent.repoId)
      return {
        branch: agent.ref,
        repoOwner: ws?.repoOwner,
        repoName: ws?.repoName,
        defaultBranch: ws?.defaultBranch,
      }
    }
  )

  if (!branch) throw new Error("Agent branch not found in storage")
  if (!repoOwner || !repoName || !defaultBranch) {
    throw new Error("Workspace repo info not found in storage")
  }

  const token = await getGitHubTokenForUser(userId)
  if (!token) throw new Error("Not authenticated with GitHub")

  // When a caller (the direct UI action) leaves title/body unset, synthesise
  // them from the branch's commits so a PR can be opened with no model turn.
  // The agent tool still passes its own, so this fetch only runs when needed.
  const generated =
    !title?.trim() || body === undefined
      ? await fetchPrContent(repoOwner, repoName, defaultBranch, branch, token)
      : null

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
        title: title?.trim() || generated?.title || branch,
        body: body ?? generated?.body ?? "",
        head: branch,
        base: defaultBranch,
      }),
    }
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

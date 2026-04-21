"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"

export interface GitHubRepo {
  id: number
  fullName: string
  name: string
  private: boolean
  defaultBranch: string
  cloneUrl: string
  htmlUrl: string
  owner: string
  pushedAt: string
}

export async function listUserRepos(): Promise<GitHubRepo[]> {
  const { userId } = await auth()
  if (!userId) return []

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  if (!token) return []

  const repos: GitHubRepo[] = []
  let page = 1

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    )

    if (!res.ok) break

    const data = await res.json()
    if (data.length === 0) break

    for (const repo of data) {
      repos.push({
        id: repo.id,
        fullName: repo.full_name,
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        cloneUrl: repo.clone_url,
        htmlUrl: repo.html_url,
        owner: repo.owner.login,
        pushedAt: repo.pushed_at,
      })
    }

    if (data.length < 100) break
    page++
  }

  return repos
}

export interface GitHubBranch {
  name: string
}

export async function createBranch(
  owner: string,
  repo: string,
  newBranchName: string,
  fromBranch: string,
  ghToken?: string,
): Promise<{ success: boolean; error?: string }> {
  let token = ghToken
  if (!token) {
    const { userId } = await auth()
    if (!userId) return { success: false, error: "Not authenticated" }

    const client = await clerkClient()
    const tokens = await client.users.getUserOauthAccessToken(userId, "github")
    token = tokens.data?.[0]?.token
  }
  if (!token) return { success: false, error: "No GitHub token" }

  // Get the SHA of the source branch
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${fromBranch}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  )

  if (!refRes.ok) {
    const err = await refRes.json().catch(() => ({}))
    const detail = err?.message ? `: ${err.message}` : ""
    return {
      success: false,
      error: `Failed to get ref for ${fromBranch} (${refRes.status})${detail}`,
    }
  }

  const refData = await refRes.json()
  const sha = refData.object.sha

  // Create the new branch
  const createRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: `refs/heads/${newBranchName}`,
        sha,
      }),
    },
  )

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}))
    return {
      success: false,
      error: err.message || `Failed to create branch ${newBranchName}`,
    }
  }

  return { success: true }
}

export async function renameBranch(
  owner: string,
  repo: string,
  oldBranch: string,
  newBranch: string,
): Promise<{ success: boolean; error?: string }> {
  const { userId } = await auth()
  if (!userId) return { success: false, error: "Not authenticated" }

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  if (!token) return { success: false, error: "No GitHub token" }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches/${oldBranch}/rename`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ new_name: newBranch }),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      error: err.message || `Failed to rename branch ${oldBranch} to ${newBranch}`,
    }
  }

  return { success: true }
}

export async function compareBranch(
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<{ additions: number; deletions: number } | null> {
  const { userId } = await auth()
  if (!userId) return null

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  if (!token) return null

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  )

  if (!res.ok) return null

  const data = await res.json()
  let additions = 0
  let deletions = 0
  for (const file of data.files ?? []) {
    additions += file.additions ?? 0
    deletions += file.deletions ?? 0
  }
  return { additions, deletions }
}

export async function listRepoBranches(
  owner: string,
  repo: string,
): Promise<GitHubBranch[]> {
  const { userId } = await auth()
  if (!userId) return []

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  if (!token) return []

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    },
  )

  if (!res.ok) return []

  const data = await res.json()
  return data.map((b: { name: string }) => ({ name: b.name }))
}

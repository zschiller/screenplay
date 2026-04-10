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

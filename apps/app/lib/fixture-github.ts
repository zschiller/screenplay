import { cookies } from "next/headers"

import { isFixtureWorld } from "@/lib/fixture-world"
import type { GitHubRepo } from "@/lib/github-actions"

/**
 * A **connected GitHub account** for a Fixture World capture (issue #781).
 *
 * A capture container has no `gh` login and no device token, so every
 * GitHub-backed list in the app is empty there. The Add project dialog's GitHub
 * tab is one of those lists, and its populated state is the one worth
 * reviewing. A screen in `screenshots/screens.ts` seeds this cookie to have the
 * repo list answer with {@link FIXTURE_GITHUB_REPOS}, the same way it seeds an
 * entry state (`@/lib/fixture-entry`) or a fault (`@/lib/fixture-faults`).
 *
 * Only ever honoured under {@link isFixtureWorld}, so the hosted app and a real
 * desktop install never read it.
 */
const COOKIE_NAME = "screenplay_fixture_github"

/** The cookie a capture screen sets to sign the fixture world in to GitHub. */
export function fixtureGitHubCookieName(): string {
  return COOKIE_NAME
}

/** Whether this request asked for a connected GitHub. Always false outside the Fixture World. */
export async function hasFixtureGitHub(): Promise<boolean> {
  if (!isFixtureWorld) return false
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value === "connected"
}

function repo(
  id: number,
  owner: string,
  name: string,
  isPrivate: boolean,
  pushedAt: string
): GitHubRepo {
  return {
    id,
    fullName: `${owner}/${name}`,
    name,
    private: isPrivate,
    defaultBranch: "main",
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    htmlUrl: `https://github.com/${owner}/${name}`,
    owner,
    pushedAt,
  }
}

/** The fixture account's repositories, most recently pushed first. */
export const FIXTURE_GITHUB_REPOS: GitHubRepo[] = [
  repo(101, "acme", "storefront", true, "2026-09-26T10:00:00Z"),
  repo(102, "acme", "web", false, "2026-09-25T10:00:00Z"),
  repo(103, "acme", "design-system", true, "2026-09-24T10:00:00Z"),
  repo(104, "acme", "docs", false, "2026-09-20T10:00:00Z"),
  repo(105, "acme", "mobile", true, "2026-09-18T10:00:00Z"),
  repo(106, "acme", "admin-dashboard", true, "2026-09-12T10:00:00Z"),
  repo(107, "designer", "portfolio", false, "2026-09-02T10:00:00Z"),
  repo(108, "designer", "dotfiles", false, "2026-08-21T10:00:00Z"),
]

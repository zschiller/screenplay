import { isLocalBuild } from "@/lib/local-mode"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { BranchData, RepoData } from "@/lib/types"
import { isCustomized } from "./canvas"

/**
 * Whether a Canvas Repo follows the Repository it was switched on from, and
 * every question that answer decides. Desktop has one person, so a Canvas
 * Repo follows its Repository: Settings edits reach it until it's customized
 * (#1420). Hosted Canvases are shared, so the copy belongs to the Canvas once
 * it's added (#1427). The repository library and the Settings, Canvas
 * settings and Repo settings UI ask this instead of checking the build.
 */
export interface RepositoryLinkPolicy {
  /** A Settings edit to a Repository reaches the Canvas Repos linked to it,
   *  and Save to all is allowed. */
  propagatesEdits: boolean
  /** The one-time migration gives each Canvas Repo with no matching
   *  Repository one of its own (hosted can't tell whose it was). */
  createsMissingRepositories: boolean
  /** Deleting a Repository counts and unlinks the Canvases using it; without
   *  it, delete never opens another Canvas. */
  deleteUnlinksCanvases: boolean
  /** The Repository a Canvas Repo follows, if any. Its edit form offers
   *  Reset to Settings and Save to all only against one (#1424, #1425). */
  followedRepository(
    repo: RepoData,
    repositories: readonly RepoConfig[]
  ): RepoConfig | undefined
  /** Whether the Repo differs from the Repository it follows. */
  isCustomized(repo: RepoData, repositories: readonly RepoConfig[]): boolean
  /** Whether removing the Repo from the Canvas asks first. */
  removeConfirms(
    repo: RepoData,
    branches: readonly BranchData[],
    repositories: readonly RepoConfig[]
  ): boolean
  /** Whether the list names who added each Repo ("Added by X"). */
  showsAddedBy: boolean
}

const linked = (repo: RepoData, repositories: readonly RepoConfig[]) =>
  repositories.find((r) => r.id === repo.repositoryId)

/** Desktop: one person, so a Canvas Repo follows its Repository. */
export const desktopLinkPolicy: RepositoryLinkPolicy = {
  propagatesEdits: true,
  createsMissingRepositories: true,
  deleteUnlinksCanvases: true,
  followedRepository: linked,
  isCustomized(repo, repositories) {
    const repository = linked(repo, repositories)
    return repository !== undefined && isCustomized(repo, repository)
  },
  // Your Repository stays in Settings, so only Workspaces, or edits made on
  // this Canvas alone, make it worth asking.
  removeConfirms(repo, branches, repositories) {
    return (
      branches.some((b) => b.repoId === repo.id) ||
      desktopLinkPolicy.isCustomized(repo, repositories)
    )
  },
  showsAddedBy: false,
}

/** Hosted: a Canvas's copy belongs to the Canvas (#1427). */
export const hostedLinkPolicy: RepositoryLinkPolicy = {
  propagatesEdits: false,
  createsMissingRepositories: false,
  deleteUnlinksCanvases: false,
  followedRepository: () => undefined,
  isCustomized: () => false,
  // The canvas's copy, and anyone's edits to it, go for everyone here.
  removeConfirms: () => true,
  showsAddedBy: true,
}

/** This build's policy: the one place that reads the build for it. */
export const repositoryLinkPolicy: RepositoryLinkPolicy = isLocalBuild
  ? desktopLinkPolicy
  : hostedLinkPolicy

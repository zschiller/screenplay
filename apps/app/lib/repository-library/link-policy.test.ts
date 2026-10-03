import { describe, expect, it } from "vitest"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { BranchData, RepoData } from "@/lib/types"
import { desktopLinkPolicy, hostedLinkPolicy } from "@/lib/repository-library"

function repository(id: string, over: Partial<RepoConfig> = {}): RepoConfig {
  return {
    id,
    name: "",
    repoFullName: `acme/${id}`,
    repoOwner: "acme",
    repoName: id,
    defaultBranch: "main",
    cloneUrl: `https://github.com/acme/${id}.git`,
    private: false,
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 3000,
    envVars: "",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function repo(id: string, over: Partial<RepoData> = {}): RepoData {
  return {
    id,
    name: "",
    repoFullName: "acme/web",
    repoOwner: "acme",
    repoName: "web",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/web.git",
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 3000,
    createdAt: 1,
    ...over,
  }
}

const WEB = repository("web")
const API = repository("api")
const REPOSITORIES = [WEB, API]
/** Switched on from your "web", as it was. */
const LINKED = repo("r1", { repositoryId: "web", addedBy: "zack" })
/** Switched on from "web", then edited on the canvas. */
const EDITED = { ...LINKED, devScript: "pnpm dev --turbo" }
/** On the canvas, linked to none of your Repositories. */
const OWN = repo("r2", { repoFullName: "acme/docs", repoName: "docs" })
const BRANCHES = [{ id: "b1", repoId: "r1" } as BranchData]

describe("desktop: a canvas repo follows its repository", () => {
  const policy = desktopLinkPolicy

  it("propagates Settings edits and allows Save to all", () => {
    expect(policy.propagatesEdits).toBe(true)
  })

  it("gives an unmatched canvas repo a repository in the migration", () => {
    expect(policy.createsMissingRepositories).toBe(true)
  })

  it("counts and unlinks canvases when a repository is deleted", () => {
    expect(policy.deleteUnlinksCanvases).toBe(true)
  })

  it("follows the repository it's linked to, for Reset and Save to all", () => {
    expect(policy.followedRepository(LINKED, REPOSITORIES)).toBe(WEB)
    expect(policy.followedRepository(OWN, REPOSITORIES)).toBeUndefined()
    // Linked to one that isn't yours (or was deleted).
    expect(policy.followedRepository(LINKED, [API])).toBeUndefined()
  })

  it("marks a repo customized when it differs from its repository", () => {
    expect(policy.isCustomized(LINKED, REPOSITORIES)).toBe(false)
    expect(policy.isCustomized(EDITED, REPOSITORIES)).toBe(true)
    expect(policy.isCustomized({ ...OWN, devScript: "x" }, REPOSITORIES)).toBe(
      false
    )
  })

  it("confirms removing only when workspaces use it or it's customized", () => {
    expect(policy.removeConfirms(LINKED, BRANCHES, REPOSITORIES)).toBe(true)
    expect(policy.removeConfirms(OWN, BRANCHES, REPOSITORIES)).toBe(false)
    expect(policy.removeConfirms(EDITED, [], REPOSITORIES)).toBe(true)
  })

  it("doesn't name who added a repo", () => {
    expect(policy.showsAddedBy).toBe(false)
  })
})

describe("hosted: a canvas's copy belongs to the canvas", () => {
  const policy = hostedLinkPolicy

  it("keeps Settings edits off canvases and refuses Save to all", () => {
    expect(policy.propagatesEdits).toBe(false)
  })

  it("leaves an unmatched canvas repo unlinked in the migration", () => {
    expect(policy.createsMissingRepositories).toBe(false)
  })

  it("neither counts nor unlinks canvases when a repository is deleted", () => {
    expect(policy.deleteUnlinksCanvases).toBe(false)
  })

  it("follows no repository, so there's no Reset or Save to all", () => {
    expect(policy.followedRepository(LINKED, REPOSITORIES)).toBeUndefined()
  })

  it("never marks a repo customized", () => {
    expect(policy.isCustomized(EDITED, REPOSITORIES)).toBe(false)
  })

  it("always confirms removing", () => {
    expect(policy.removeConfirms(LINKED, BRANCHES, REPOSITORIES)).toBe(true)
    expect(policy.removeConfirms(OWN, [], REPOSITORIES)).toBe(true)
  })

  it("names who added a repo", () => {
    expect(policy.showsAddedBy).toBe(true)
  })
})

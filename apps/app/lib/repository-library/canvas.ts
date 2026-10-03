import { planRepoTeardown } from "@/lib/branch/intake"
import { createCanvasOps } from "@/lib/canvas/ops"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RepoData } from "@/lib/types"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The Canvas half of the repository library (#1420): how a person's
 * Repositories (`RepoConfig`, kept in their encrypted store) become Canvas
 * Repos (`RepoData` in the room Y.Doc) and stay linked to them. React-free and
 * store-free, so the Canvas can run it against its own doc and the server
 * against one it opened; every write goes through Canvas Operations.
 */

/** The run settings a Repository hands to the Canvas Repos switched on from
 *  it. Env var values are copied but left out of "customized" until #1416
 *  decides where they live. */
type RunSettings = Pick<
  RepoData,
  | "setupScript"
  | "devScript"
  | "devServerPort"
  | "envVars"
  | "copyPatterns"
  | "defaultIframeLayerSizeId"
  | "systemPrompt"
>

/**
 * What tells two Repositories apart: the remote (or, for a remote-less folder,
 * the folder name that stands in for it) plus the Repository's name, so one
 * GitHub repository can be two Repositories ("web" and "api"). Same key the
 * preset upsert has always used.
 */
export function sameRepository(
  a: { repoFullName: string; name: string },
  b: { repoFullName: string; name: string }
): boolean {
  return a.repoFullName === b.repoFullName && a.name === b.name
}

/** Copies just the run settings, from a Repository or a Canvas Repo. */
function runSettings(source: RunSettings): RunSettings {
  return {
    setupScript: source.setupScript,
    devScript: source.devScript,
    devServerPort: source.devServerPort,
    envVars: source.envVars,
    copyPatterns: source.copyPatterns,
    defaultIframeLayerSizeId: source.defaultIframeLayerSizeId,
    systemPrompt: source.systemPrompt,
  }
}

/** Every Canvas Repo, read fresh by id (a server-side `toArray()` snapshot can
 *  lag its own writes; ids are stable). */
function canvasRepos(collections: RoomCollections): RepoData[] {
  return collections.repos
    .toArray()
    .map((r) => collections.repos.get(r.id))
    .filter((r): r is RepoData => Boolean(r))
}

/** The Canvas Repo switched on from `repositoryId`, if this Canvas uses it. */
export function linkedRepo(
  collections: RoomCollections,
  repositoryId: string
): RepoData | undefined {
  return canvasRepos(collections).find((r) => r.repositoryId === repositoryId)
}

/**
 * Switch a Repository on for a Canvas: copy it in as a Repo linked back to it
 * and record who added it. Already on = nothing changes, and the existing
 * Repo's id comes back.
 */
export function switchOn(
  collections: RoomCollections,
  repository: RepoConfig,
  { id, createdAt, addedBy }: { id: string; createdAt: number; addedBy: string }
): string {
  const existing = linkedRepo(collections, repository.id)
  if (existing) return existing.id
  const repo: RepoData = {
    id,
    name: repository.name,
    repoFullName: repository.repoFullName,
    repoOwner: repository.repoOwner,
    repoName: repository.repoName,
    defaultBranch: repository.defaultBranch,
    cloneUrl: repository.cloneUrl,
    // A folder Repository points the Repo at the existing checkout (ADR 0013).
    localPath: repository.localPath,
    ...runSettings(repository),
    createdAt,
    repositoryId: repository.id,
    addedBy,
  }
  createCanvasOps(collections).createRepo(id, repo)
  return id
}

/** What switching off removed, for the caller to finish today's remove path:
 *  tear down `sandboxNames` and drop the chats' client mirrors. */
export interface SwitchOffResult {
  /** The Canvas Repo removed; `null` when the Repository wasn't on. */
  repoId: string | null
  sandboxNames: string[]
  removedChatIds: string[]
}

/**
 * Switch a Repository off for a Canvas: remove its linked Repo through the
 * same Canvas Operation as Remove repository, which takes its Workspaces,
 * frames and chats with it. Not on = nothing changes.
 */
export function switchOff(
  collections: RoomCollections,
  repositoryId: string
): SwitchOffResult {
  const repo = linkedRepo(collections, repositoryId)
  if (!repo) return { repoId: null, sandboxNames: [], removedChatIds: [] }
  // Planned before the records go, so a Sandbox never outlives its Branch.
  const { sandboxNames } = planRepoTeardown(
    repo.id,
    collections.branches.toArray(),
    { deleteOnRemote: false }
  )
  const { removedChatIds } = createCanvasOps(collections).removeRepo(repo.id)
  return { repoId: repo.id, sandboxNames, removedChatIds }
}

/**
 * The one-time migration for one Canvas: link each unlinked Repo to the
 * Repository with the same identity. With `createMissing` (desktop), a Repo
 * that matches none becomes a new Repository from its own settings; without it
 * (hosted) it stays unlinked, with no "added by", since nobody recorded who
 * added it. Returns the Repositories it created, for the caller to save.
 */
export function linkCanvasRepos(
  collections: RoomCollections,
  repositories: readonly RepoConfig[],
  {
    userId,
    createMissing,
    mint,
  }: {
    userId: string
    createMissing: boolean
    mint: () => { id: string; now: number }
  }
): RepoConfig[] {
  const known = [...repositories]
  const created: RepoConfig[] = []
  const ops = createCanvasOps(collections)
  ops.batch(() => {
    for (const repo of canvasRepos(collections)) {
      if (repo.repositoryId) continue
      let repository = known.find((r) => sameRepository(r, repo))
      if (!repository && createMissing) {
        const { id, now } = mint()
        repository = {
          id,
          name: repo.name,
          repoFullName: repo.repoFullName,
          repoOwner: repo.repoOwner,
          repoName: repo.repoName,
          defaultBranch: repo.defaultBranch,
          cloneUrl: repo.cloneUrl,
          localPath: repo.localPath,
          // A Canvas Repo never recorded visibility; only the lock icon reads it.
          private: false,
          ...runSettings(repo),
          createdAt: now,
          updatedAt: now,
        }
        known.push(repository)
        created.push(repository)
      }
      if (repository) {
        ops.patch("repos", repo.id, {
          repositoryId: repository.id,
          addedBy: userId,
        })
      }
    }
  })
  return created
}

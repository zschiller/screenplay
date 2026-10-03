import { planRepoTeardown } from "@/lib/branch/intake"
import { createCanvasOps } from "@/lib/canvas/ops"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { repoShortName, repoSource } from "@/lib/repo-identity"
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
 *  decides where they live. Exported for the edit form's Reset to Settings. */
export type RunSettings = Pick<
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
export function runSettings(source: RunSettings): RunSettings {
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

/** What a Canvas Repo takes from its Repository: its name and run settings. */
function settingsFrom(
  repository: RepoConfig
): Pick<RepoData, "name"> & RunSettings {
  return { name: repository.name, ...runSettings(repository) }
}

/** The settings "customized" compares, with unset fields at their defaults
 *  so a Repo saved through a form that fills them doesn't read as changed.
 *  Env var values stay out (#1416). */
function comparable(source: Pick<RepoData, "name"> & RunSettings) {
  return [
    source.name ?? "",
    source.setupScript ?? "",
    source.devScript ?? "",
    source.devServerPort ?? 3000,
    source.copyPatterns ?? "",
    source.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID,
    source.systemPrompt ?? "",
  ]
}

/**
 * Whether a Canvas Repo has been customized for its Canvas: its name or any
 * run setting differs from its Repository's. Derived, never stored, so
 * Resetting (or editing back by hand) clears it. Env var values don't count.
 */
export function isCustomized(
  repo: Pick<RepoData, "name"> & RunSettings,
  repository: RepoConfig
): boolean {
  const a = comparable(repo)
  const b = comparable(repository)
  return a.some((v, i) => v !== b[i])
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

/**
 * Reset to Settings: give a Canvas Repo its Repository's name and run
 * settings again, env var values included, so it's no longer customized.
 */
export function resetToRepository(
  collections: RoomCollections,
  repoId: string,
  repository: RepoConfig
): void {
  if (!collections.repos.get(repoId)) return
  createCanvasOps(collections).patch("repos", repoId, settingsFrom(repository))
}

/**
 * An edit made in Settings reaching one Canvas: every Repo linked to the
 * Repository that wasn't customized against its settings `before` the edit
 * takes the new ones. Customized Repos keep theirs. Env var values follow only
 * where the Canvas still had the old values, so a Canvas's own env vars
 * survive. Returns the ids of the Repos it updated.
 */
export function applyRepositoryEdit(
  collections: RoomCollections,
  before: RepoConfig,
  after: RepoConfig
): string[] {
  const ops = createCanvasOps(collections)
  const updated: string[] = []
  ops.batch(() => {
    for (const repo of canvasRepos(collections)) {
      if (repo.repositoryId !== after.id || isCustomized(repo, before)) continue
      const next = settingsFrom(after)
      if (repo.envVars !== before.envVars) next.envVars = repo.envVars
      ops.patch("repos", repo.id, next)
      updated.push(repo.id)
    }
  })
  return updated
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

/** One row of a Canvas's Repositories list: on (a Canvas Repo, linked to one
 *  of your Repositories or not) or off (one of your Repositories this Canvas
 *  doesn't use). */
export type CanvasRepositoryRow =
  | { on: true; repo: RepoData; repository?: RepoConfig }
  | { on: false; repository: RepoConfig }

/**
 * The Canvas's switch list: every one of your Repositories, on when this
 * Canvas has a Repo linked to it, plus every other Canvas Repo (unlinked, or
 * another member's) as on. Sorted by name, then source, so the list keeps its
 * order as switches flip.
 */
export function canvasRepositoryRows(
  repositories: readonly RepoConfig[],
  repos: readonly RepoData[]
): CanvasRepositoryRow[] {
  const rows: CanvasRepositoryRow[] = repositories.map((repository) => {
    const repo = repos.find((r) => r.repositoryId === repository.id)
    return repo ? { on: true, repo, repository } : { on: false, repository }
  })
  for (const repo of repos) {
    if (!repositories.some((r) => r.id === repo.repositoryId)) {
      rows.push({ on: true, repo })
    }
  }
  const key = (row: CanvasRepositoryRow) => {
    const r = row.on ? row.repo : row.repository
    return [repoShortName(r), repoSource(r)] as const
  }
  return rows.sort((a, b) => {
    const [an, as] = key(a)
    const [bn, bs] = key(b)
    return an.localeCompare(bn) || as.localeCompare(bs)
  })
}

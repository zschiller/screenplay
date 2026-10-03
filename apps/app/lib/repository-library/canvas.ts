import { planRepoTeardown } from "@/lib/branch/intake"
import { createCanvasOps } from "@/lib/canvas/ops"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { repoShortName, repoSource } from "@/lib/repo-identity"
import { envVarNames } from "@/lib/repo-env/names"
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
 *  it. Env vars ride as names and a digest: their values go to the Canvas's
 *  encrypted store, never the room doc (#1416). Exported for the edit form's
 *  Reset to Settings. */
export type RunSettings = Pick<
  RepoData,
  | "setupScript"
  | "devScript"
  | "devServerPort"
  | "envVarNames"
  | "envVarsDigest"
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

/**
 * A Repository's run settings as a Canvas Repo carries them: its env vars as
 * names plus the digest the library stamps on it (`envVarsDigest`).
 */
export function runSettings(repository: RepoConfig): RunSettings {
  const names = envVarNames(repository.envVars)
  return {
    setupScript: repository.setupScript,
    devScript: repository.devScript,
    devServerPort: repository.devServerPort,
    envVarNames: names.length > 0 ? names : undefined,
    envVarsDigest: repository.envVarsDigest,
    copyPatterns: repository.copyPatterns,
    defaultIframeLayerSizeId: repository.defaultIframeLayerSizeId,
    systemPrompt: repository.systemPrompt,
  }
}

/**
 * What a Canvas Repo takes from its Repository when it follows it: its name
 * and run settings. Env var names and digest are left out: only the Canvas
 * Repo env module (`lib/repo-env/canvas-repo-env`) writes them, after storing
 * the values they describe (#1492). Exported for the edit form's Reset to
 * Settings.
 */
export function repositorySettings(
  repository: RepoConfig
): Pick<RepoData, "name" | "envVars"> &
  Omit<RunSettings, "envVarNames" | "envVarsDigest"> {
  const {
    envVarNames: _names,
    envVarsDigest: _digest,
    ...settings
  } = runSettings(repository)
  // A legacy plain-text copy goes with the rest (#1416).
  return { name: repository.name, ...settings, envVars: undefined }
}

/** The settings "customized" compares, with unset fields at their defaults
 *  so a Repo saved through a form that fills them doesn't read as changed.
 *  Agent instructions compare trimmed, as the forms store them (#1479).
 *  Env var values compare by digest (#1416). */
function comparable(source: Pick<RepoData, "name"> & RunSettings) {
  return [
    source.name ?? "",
    source.setupScript ?? "",
    source.devScript ?? "",
    source.devServerPort ?? 3000,
    source.envVarsDigest ?? "",
    source.copyPatterns ?? "",
    source.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID,
    source.systemPrompt?.trim() ?? "",
  ]
}

/**
 * Whether a Canvas Repo has been customized for its Canvas: its name or any
 * run setting differs from its Repository's, env var values included (a
 * member typing their own is their customization, #1416). Derived, never
 * stored, so Resetting (or editing back by hand) clears it.
 */
export function isCustomized(
  repo: Pick<RepoData, "name"> & RunSettings,
  repository: RepoConfig
): boolean {
  const a = comparable(repo)
  const b = comparable({ name: repository.name, ...runSettings(repository) })
  return a.some((v, i) => v !== b[i])
}

/** Every Canvas Repo, read fresh by id (a server-side `toArray()` snapshot can
 *  lag its own writes; ids are stable). */
export function canvasRepos(collections: RoomCollections): RepoData[] {
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

/** The env var fields a save to the Canvas's encrypted store hands back. */
type StoredEnvFields = Pick<RepoData, "envVarNames" | "envVarsDigest">

/**
 * Switch a Repository on for a Canvas: copy it in as a Repo linked back to it
 * and record who added it. Already on = nothing changes, and the existing
 * Repo's id comes back. `env`, when given, is what storing the values
 * returned, and replaces the names and digest taken from the Repository.
 */
export function switchOn(
  collections: RoomCollections,
  repository: RepoConfig,
  {
    id,
    createdAt,
    addedBy,
  }: { id: string; createdAt: number; addedBy: string },
  env?: StoredEnvFields
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
    ...env,
    createdAt,
    repositoryId: repository.id,
    addedBy,
  }
  createCanvasOps(collections).createRepo(id, repo)
  return id
}

/**
 * {@link switchOn} with the Repository's env var values stored for the Canvas
 * first (`saveEnv`, under the new Repo's id), so the doc never lists names
 * whose values weren't stored (#1476). A failed save rejects and leaves the
 * Repository switched off; one without values skips the save.
 */
export async function switchOnWithEnv(
  collections: RoomCollections,
  repository: RepoConfig,
  opts: { id: string; createdAt: number; addedBy: string },
  saveEnv: (repoId: string, text: string) => Promise<StoredEnvFields>
): Promise<string> {
  const existing = linkedRepo(collections, repository.id)
  if (existing) return existing.id
  const env = repository.envVars.trim()
    ? await saveEnv(opts.id, repository.envVars)
    : undefined
  return switchOn(collections, repository, opts, env)
}

/**
 * Reset to Settings: give a Canvas Repo its Repository's name and run
 * settings again. Its env vars reset through the Canvas Repo env module
 * (`reset`), which stores the Repository's values first (#1492).
 */
export function resetToRepository(
  collections: RoomCollections,
  repoId: string,
  repository: RepoConfig
): void {
  if (!collections.repos.get(repoId)) return
  createCanvasOps(collections).patch(
    "repos",
    repoId,
    repositorySettings(repository)
  )
}

/**
 * An edit made in Settings reaching one Canvas: every Repo linked to the
 * Repository that wasn't customized against its settings `before` the edit
 * takes the new ones. Customized Repos keep theirs, unless `overrideCustomized`
 * (Save to all, #1425) gives them the new ones too. Env var values follow only
 * where the Canvas still had the old values, so a Canvas's own env vars
 * survive. Returns the ids of the Repos whose values follow; the caller writes
 * `after`'s values for each through the Canvas Repo env module, which stores
 * them before the doc lists their names (#1492).
 */
export function applyRepositoryEdit(
  collections: RoomCollections,
  before: RepoConfig,
  after: RepoConfig,
  { overrideCustomized = false }: { overrideCustomized?: boolean } = {}
): string[] {
  const ops = createCanvasOps(collections)
  const updated: string[] = []
  ops.batch(() => {
    for (const repo of canvasRepos(collections)) {
      if (repo.repositoryId !== after.id) continue
      if (!overrideCustomized && isCustomized(repo, before)) continue
      ops.patch("repos", repo.id, repositorySettings(after))
      // A Canvas's own values are left unwritten, not rewritten, so a save
      // racing the editing Canvas's own write can't put the old ones back.
      if (repo.envVarsDigest === before.envVarsDigest) updated.push(repo.id)
    }
  })
  return updated
}

/**
 * A Repository deleted from Settings, on one Canvas: every Repo linked to it
 * stays, with its settings, Workspaces and chats, and becomes unlinked, so it
 * shows no dot and no longer takes Settings edits. Who added it stays.
 * Returns the ids of the Repos it unlinked.
 */
export function unlinkRepository(
  collections: RoomCollections,
  repositoryId: string
): string[] {
  const ops = createCanvasOps(collections)
  const unlinked: string[] = []
  ops.batch(() => {
    for (const repo of canvasRepos(collections)) {
      if (repo.repositoryId !== repositoryId) continue
      ops.patch("repos", repo.id, { repositoryId: undefined })
      unlinked.push(repo.id)
    }
  })
  return unlinked
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
          setupScript: repo.setupScript,
          devScript: repo.devScript,
          devServerPort: repo.devServerPort,
          // Only a legacy plain-text copy is at hand here; desktop, the one
          // build that creates Repositories this way, has no env vars field.
          envVars: repo.envVars ?? "",
          copyPatterns: repo.copyPatterns,
          defaultIframeLayerSizeId: repo.defaultIframeLayerSizeId,
          systemPrompt: repo.systemPrompt,
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
 * The Canvas's Repositories list: every one of your Repositories, on when this
 * Canvas has a Repo linked to it, plus every other Canvas Repo (unlinked, or
 * another member's) as on. One of yours the Canvas already has under the same
 * remote and name (a teammate added theirs) is left out, so Add can't make a
 * second Repo nobody could tell apart (#1420's identity rule). Sorted by name,
 * then source, so the list keeps its order as Repos are added and removed.
 */
export function canvasRepositoryRows(
  repositories: readonly RepoConfig[],
  repos: readonly RepoData[]
): CanvasRepositoryRow[] {
  const rows: CanvasRepositoryRow[] = []
  for (const repository of repositories) {
    const repo = repos.find((r) => r.repositoryId === repository.id)
    if (repo) rows.push({ on: true, repo, repository })
    else if (!repos.some((r) => sameRepository(r, repository))) {
      rows.push({ on: false, repository })
    }
  }
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

/** One labelled run of a Canvas's Repositories list. */
export interface CanvasRepositoryGroup {
  label: string
  rows: CanvasRepositoryRow[]
}

/** The Canvas's Repositories list in its groups: the Canvas's Repos (every
 *  member's) first, then your others to add. Empty groups are left out. */
export function canvasRepositoryGroups(
  rows: readonly CanvasRepositoryRow[]
): CanvasRepositoryGroup[] {
  return [
    { label: "On this canvas", rows: rows.filter((row) => row.on) },
    { label: "Your other repositories", rows: rows.filter((row) => !row.on) },
  ].filter((group) => group.rows.length > 0)
}

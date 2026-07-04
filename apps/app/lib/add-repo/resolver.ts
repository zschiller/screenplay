import type { RepoPickerSelection } from "@/components/repo-picker"
import type { RepoData } from "@/lib/types"

/**
 * The essential run settings the confirm-and-configure add modal resolves
 * before anything is provisioned (PRD #673, spine slice #676): the fields a
 * Sandbox needs to boot correctly on the first preview. Detection and the
 * advanced fields land in later slices; here they arrive already resolved
 * from the modal's form state.
 */
export interface ResolvedRepoSettings {
  setupScript: string
  devScript: string
  devServerPort: number
  envVars: string
  /** Desktop-only glob patterns; only meaningful for a `localPath` Repo. */
  copyPatterns?: string
}

/** The impure bits the caller mints per create — kept out so the resolver stays
 *  a pure function of its inputs and can be exercised against fixtures. */
export interface RepoCreateMeta {
  id: string
  createdAt: number
}

/**
 * The React-free add-repo resolver — this slice implements its **confirm**
 * decision only: given the picker pick identity plus (optionally) the run
 * settings the modal resolved, produce the {@link RepoData} to create.
 *
 * The seed/merge and preset-upsert halves arrive in later slices (#673).
 *
 * `settings` is the modal path: when present, the unconfigured arms use those
 * resolved values instead of the hardcoded empty-scripts / port-3000 defaults.
 * When absent — a saved-preset pick, or any programmatic caller — the output is
 * exactly today's: the branching below reproduces the former inline logic in
 * `useBranchIntake.createRepo` verbatim.
 */
export function resolveRepoData(
  pick: RepoPickerSelection,
  settings: ResolvedRepoSettings | undefined,
  { id, createdAt }: RepoCreateMeta
): RepoData {
  if (pick.kind === "config") {
    // A saved preset already carries its settings; it never routes through the
    // modal, so `settings` is ignored on this arm (behavior unchanged).
    return {
      id,
      name: pick.config.name,
      repoFullName: pick.config.repoFullName,
      repoOwner: pick.config.repoOwner,
      repoName: pick.config.repoName,
      defaultBranch: pick.config.defaultBranch,
      cloneUrl: pick.config.cloneUrl,
      // A folder-sourced preset points the Repo at the existing checkout (ADR
      // 0013) — the `localPath` rides along and routes acquisition down the
      // local-path arm.
      localPath: pick.config.localPath,
      setupScript: pick.config.setupScript,
      devScript: pick.config.devScript,
      devServerPort: pick.config.devServerPort,
      envVars: pick.config.envVars,
      copyPatterns: pick.config.copyPatterns,
      defaultIframeLayerSizeId: pick.config.defaultIframeLayerSizeId,
      systemPrompt: pick.config.systemPrompt,
      createdAt,
    }
  }

  if (pick.kind === "source") {
    // A Repo from the local build's URL / local-folder entry points (PRD #428).
    // `localPath` is the acquisition source the provision path routes on; the
    // GitHub identity fields may be empty (non-GitHub repo), which just leaves
    // API features dark.
    return {
      id,
      name: "",
      repoFullName: pick.source.repoFullName,
      repoOwner: pick.source.repoOwner,
      repoName: pick.source.repoName,
      defaultBranch: pick.source.defaultBranch,
      cloneUrl: pick.source.cloneUrl,
      localPath: pick.source.localPath,
      setupScript: settings?.setupScript ?? "",
      devScript: settings?.devScript ?? "",
      devServerPort: settings?.devServerPort ?? 3000,
      envVars: settings?.envVars ?? "",
      // A local-folder Repo's worktrees get the checkout's env files carried
      // over by default — the common gitignored config a dev server can't run
      // without. The modal may override with its own resolved patterns.
      copyPatterns:
        settings?.copyPatterns ?? (pick.source.localPath ? ".env*" : undefined),
      createdAt,
    }
  }

  // An unconfigured GitHub-repo pick.
  return {
    id,
    name: "",
    repoFullName: pick.repo.fullName,
    repoOwner: pick.repo.owner,
    repoName: pick.repo.name,
    defaultBranch: pick.repo.defaultBranch,
    cloneUrl: pick.repo.cloneUrl,
    setupScript: settings?.setupScript ?? "",
    devScript: settings?.devScript ?? "",
    devServerPort: settings?.devServerPort ?? 3000,
    envVars: settings?.envVars ?? "",
    createdAt,
  }
}

import type { RepoPickerSelection } from "@/components/repo-picker"
import type { RepoConfig } from "@/lib/repo-configs.types"
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
 * The run settings deterministic detection fills (PRD #673, slice #678): the
 * essential trio a Sandbox needs to boot. Env vars, frame size, and the system
 * prompt are never detected. The port rides as a number here (detection's
 * native shape); the modal's text field mirrors it as a string.
 */
export interface DetectedSettings {
  setupScript: string
  devScript: string
  devServerPort: number
}

/**
 * The subset of the add-modal's form that detection can seed. All strings — the
 * port is a text input — so this is the shape the merge reads and writes; the
 * component holds these three in one state object and feeds them straight in.
 */
export interface DetectableFields {
  setupScript: string
  devScript: string
  devServerPort: string
}

export type DetectableField = keyof DetectableFields

/**
 * The seed/merge half of the add-repo resolver (PRD #673, slice #678): given the
 * form's current detectable values, a detection result, and which of those the
 * user has already touched, produce the next values.
 *
 * The rule is per-field dirty gating and nothing more — detection fills a field
 * the user hasn't touched and never clobbers one they have, regardless of what
 * the untouched field currently holds (it's still a plain default at that
 * point). Keeping it pure lets the component apply it inside a `setState`
 * updater against the live values, so a fill can't race a keystroke.
 */
export function mergeDetectedSettings(
  current: DetectableFields,
  detected: DetectedSettings,
  dirty: Partial<Record<DetectableField, boolean>>
): DetectableFields {
  return {
    setupScript: dirty.setupScript ? current.setupScript : detected.setupScript,
    devScript: dirty.devScript ? current.devScript : detected.devScript,
    devServerPort: dirty.devServerPort
      ? current.devServerPort
      : String(detected.devServerPort),
  }
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

/** The repo-identity fields a preset carries, lifted off whichever pick kind
 *  the modal is confirming. `null` for a saved-preset pick — that never routes
 *  through the modal, so it never re-saves a preset. */
function presetIdentity(
  pick: RepoPickerSelection
): Pick<
  RepoConfig,
  | "repoFullName"
  | "repoOwner"
  | "repoName"
  | "defaultBranch"
  | "cloneUrl"
  | "localPath"
  | "private"
> | null {
  if (pick.kind === "config") return null
  if (pick.kind === "source") {
    // A local-build source can't know visibility, so `private` defaults false —
    // matching the homescreen preset form's `applySource`. The `localPath`
    // rides along so the saved preset re-opens the existing checkout.
    return {
      repoFullName: pick.source.repoFullName,
      repoOwner: pick.source.repoOwner,
      repoName: pick.source.repoName,
      defaultBranch: pick.source.defaultBranch,
      cloneUrl: pick.source.cloneUrl,
      localPath: pick.source.localPath,
      private: false,
    }
  }
  return {
    repoFullName: pick.repo.fullName,
    repoOwner: pick.repo.owner,
    repoName: pick.repo.name,
    defaultBranch: pick.repo.defaultBranch,
    cloneUrl: pick.repo.cloneUrl,
    private: pick.repo.private,
  }
}

/** The impure bits minted for a *new* preset — kept out of the resolver so it
 *  stays a pure function of its inputs. Ignored when an existing preset matches
 *  (its own `id`/`createdAt` are preserved). */
export interface PresetUpsertMeta {
  id: string
  createdAt: number
  updatedAt: number
}

/**
 * The confirm decision's second half (PRD #673, save-as-preset slice #680):
 * given the pick identity, the settings the modal resolved, and the user's
 * existing presets, produce the preset to upsert when the "save these settings"
 * checkbox is on — or `null` when it's off (or the pick can't own a preset).
 *
 * This slice targets the repo's **default** preset (empty name). Matching an
 * existing default preset by `repoFullName` + name **updates** it in place —
 * its `id`, `createdAt`, and any advanced fields (system prompt, layer size)
 * are preserved, only the resolved run settings and `updatedAt` change — so
 * re-adding a repo you already saved never duplicates or errors. No match mints
 * a fresh preset from {@link PresetUpsertMeta}.
 *
 * Pure: no React, network, or disk. The best-effort persistence and any toast
 * live in the caller; a thrown save must never undo the Project add.
 */
export function resolvePresetUpsert(
  pick: RepoPickerSelection,
  settings: ResolvedRepoSettings,
  existingPresets: RepoConfig[],
  meta: PresetUpsertMeta,
  save: boolean
): RepoConfig | null {
  if (!save) return null

  const identity = presetIdentity(pick)
  if (!identity) return null

  // The default preset for this repo carries the empty name.
  const name = ""
  const resolvedSettings = {
    setupScript: settings.setupScript,
    devScript: settings.devScript,
    devServerPort: settings.devServerPort,
    envVars: settings.envVars,
    copyPatterns: settings.copyPatterns,
  }

  const existing = existingPresets.find(
    (c) => c.repoFullName === identity.repoFullName && c.name === name
  )

  if (existing) {
    // Match-by-key-and-update: keep the preset's identity, id, and createdAt
    // plus any advanced fields it already carries; overwrite only the resolved
    // run settings and stamp the update time.
    return {
      ...existing,
      ...resolvedSettings,
      updatedAt: meta.updatedAt,
    }
  }

  return {
    id: meta.id,
    name,
    ...identity,
    ...resolvedSettings,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }
}

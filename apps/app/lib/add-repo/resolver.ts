import type { RepoPickerSelection } from "@/components/repo-picker"
import type { RepoConfig } from "@/lib/repo-configs.types"
import {
  pickRunSettings,
  type RunSettings,
  type RunSettingsFields,
} from "@/lib/run-settings"

/**
 * The run settings the confirm-and-configure add modal resolves before anything
 * is provisioned (PRD #673, spine slice #676): the essential fields a Sandbox
 * needs to boot correctly on the first preview, plus the advanced-section fields
 * the expander reveals (#681). They arrive already resolved from the modal's
 * form state.
 */
export interface ResolvedRepoSettings extends RunSettings {
  envVars: string
  /**
   * The optional name from the advanced section (#681). Empty/undefined
   * targets the repo's "default" Repository. A given name keys the idempotent
   * upsert (`repoFullName` + name), so one GitHub repository can be two
   * Repositories ("web" and "api").
   */
  presetName?: string
}

/**
 * The run settings deterministic detection fills (PRD #673, slice #678): the
 * essential trio a Sandbox needs to boot. Env vars, frame size, and the system
 * prompt are never detected. The port rides as a number here (detection's
 * native shape); the modal's text field mirrors it as a string.
 */
export type DetectedSettings = Pick<
  RunSettings,
  "setupScript" | "devScript" | "devServerPort"
>

/**
 * The subset of the add-modal's form that detection can seed. All strings — the
 * port is a text input — so this is the shape the merge reads and writes; the
 * component holds them in its one `RunSettingsFields` object.
 */
export type DetectableFields = Pick<
  RunSettingsFields,
  "setupScript" | "devScript" | "devServerPort"
>

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

/** The repo-identity fields a Repository carries, lifted off whichever pick
 *  kind the modal is confirming. */
function repositoryIdentity(
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
> {
  if (pick.kind === "source") {
    // A local-build source can't know visibility, so `private` defaults false —
    // matching the Settings form's `applySource`. The `localPath` rides along
    // so the Repository re-opens the existing checkout.
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

/** The impure bits minted for a *new* Repository. Ignored when an existing
 *  one matches (its own `id`/`createdAt` are preserved). */
export interface RepositoryMeta {
  id: string
  createdAt: number
  updatedAt: number
}

/**
 * New repository's confirm decision (#1423, from the save-as-preset slice
 * #680): given the pick identity, the settings the modal resolved, and the
 * person's existing Repositories, produce the Repository to save. Adding is
 * saving: there is no separate "save as preset" choice any more.
 *
 * The name (empty → the repo's **default** Repository) keys the upsert with
 * `repoFullName` (#681). Matching an existing Repository by that pair
 * **updates** it in place — its `id`, `createdAt`, and any advanced fields the
 * modal didn't set are preserved, only the resolved run settings and
 * `updatedAt` change — so adding a repository you already have never
 * duplicates it. No match mints a fresh one from {@link RepositoryMeta}.
 *
 * Pure: no React, network, or disk. Saving it, and switching it on for a
 * Canvas, live in the caller.
 */
export function resolveNewRepository(
  pick: RepoPickerSelection,
  settings: ResolvedRepoSettings,
  existing: readonly RepoConfig[],
  meta: RepositoryMeta
): RepoConfig {
  const identity = repositoryIdentity(pick)

  // The name keys the upsert alongside `repoFullName` (#681): empty targets the
  // repo's "default" Repository, a given name its own — so "web" and "api"
  // across a monorepo never collide.
  const name = settings.presetName?.trim() ?? ""
  const { defaultIframeLayerSizeId, systemPrompt, ...essential } =
    pickRunSettings(settings)
  const resolvedSettings = {
    ...essential,
    envVars: settings.envVars,
    // Only overwrite the advanced fields the modal actually set — an untouched
    // field is left `undefined` by the modal and preserved from the match below
    // rather than clobbered to empty.
    ...(defaultIframeLayerSizeId ? { defaultIframeLayerSizeId } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
  }

  const match = existing.find(
    (c) => c.repoFullName === identity.repoFullName && c.name === name
  )

  if (match) {
    // Match-by-key-and-update: keep the Repository's identity, id, and
    // createdAt plus any advanced fields it already carries; overwrite only the
    // resolved run settings and stamp the update time.
    return {
      ...match,
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

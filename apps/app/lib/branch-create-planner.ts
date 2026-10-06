/**
 * Branch-creation planner — the pure decision core behind the prompt-first
 * New-Workspace dialog (see PRD #314).
 *
 * Given the Repo's default branch and one Composer spec per Branch, it resolves
 * exactly one {@link BranchPlan} per spec. Two switches drive every field:
 *
 * 1. **Prompt presence.** An empty prompt makes a bare scratch Branch — no
 *    Chat Session, no model applied, nothing fired on `running`. A non-empty
 *    prompt seeds a Chat Session, fires the prompt once the Sandbox is
 *    `running`, and carries the model.
 *    Either way the Branch stays auto-named (`autoNamedBranch`), so its first
 *    turn names the Workspace and its branch (#1182): a bare Branch would
 *    otherwise read "New Workspace" for good.
 * 2. **Base vs default.** `base === defaultBranch` is the `"new"` flow (fresh
 *    branch off the default); any other base is `"duplicate-branch"` (fork the
 *    chosen source). This mirrors the existing server behaviour, so the
 *    `/api/branch/create` contract is unchanged.
 *
 * The planner is **pure**: it performs no name generation, no network, and no
 * I/O. The caller names the Branches and issues the create requests.
 */

/** One Composer's resolved inputs — the per-Branch unit the dialog produces. */
export interface ComposerSpec {
  /** The branch the new Branch is based on. */
  baseBranch: string
  /** The model the seed prompt's agent should run. */
  model: string
  /** The seed prompt; empty (or whitespace-only) means a bare Branch. */
  prompt: string
  /**
   * Plan-mode toggle for the seed turn. The planner ignores it — it changes
   * only *how* the fired first message runs, not which Branch to create — but
   * it rides along on the Composer spec so the caller can carry it through to
   * the fired turn unchanged.
   */
  planMode?: boolean
}

/** The slice of Repo context the planner needs. */
export interface RepoContext {
  /** The Repo's default branch — the dividing line between the two flows. */
  defaultBranch: string
}

export interface BranchPlan {
  /**
   * The `/api/branch/create` flow: `"new"` for a fresh branch off the default,
   * `"duplicate-branch"` to fork a non-default base.
   */
  flow: "new" | "duplicate-branch"
  /** Whether a Chat Session is seeded for this Branch. */
  seedChat: boolean
  /** Whether the server's first-chat rename may name the Workspace and its branch. */
  autoNamedBranch: boolean
  /** Whether the seed prompt fires as the first message once the Sandbox is `running`. */
  firePromptOnRunning: boolean
  /** The model to apply — present only when a prompt was given. */
  model?: string
}

/**
 * Map a Repo context and an array of Composer specs to one resolved
 * {@link BranchPlan} per spec. Pure and order-preserving: plan `i` describes
 * spec `i`, resolved independently of the others.
 */
export function planBranchCreations(
  repo: RepoContext,
  specs: ComposerSpec[]
): BranchPlan[] {
  return specs.map((spec) => planBranchCreation(repo, spec))
}

function planBranchCreation(repo: RepoContext, spec: ComposerSpec): BranchPlan {
  const hasPrompt = spec.prompt.trim().length > 0
  const flow: BranchPlan["flow"] =
    spec.baseBranch === repo.defaultBranch ? "new" : "duplicate-branch"

  if (!hasPrompt) {
    return {
      flow,
      seedChat: false,
      autoNamedBranch: true,
      firePromptOnRunning: false,
    }
  }

  return {
    flow,
    seedChat: true,
    autoNamedBranch: true,
    firePromptOnRunning: true,
    model: spec.model,
  }
}

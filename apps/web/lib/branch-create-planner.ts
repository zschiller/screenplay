/**
 * Branch-creation planner — the pure decision core behind the prompt-first
 * New-Workspace dialog (see PRD #314).
 *
 * Given the Repo's default branch and one Composer spec per Branch, it resolves
 * exactly one {@link BranchPlan} per spec. Two switches drive every field:
 *
 * 1. **Prompt presence.** An empty prompt makes a bare scratch Branch — random
 *    name, no Chat Session, no model applied, nothing fired on `running`. A
 *    non-empty prompt derives the name from the prompt, seeds a Chat Session,
 *    pins the name against the server's first-chat rename (`autoNamedBranch`),
 *    fires the prompt once the Sandbox is `running`, and carries the model.
 * 2. **Base vs default.** `base === defaultBranch` is the `"new"` flow (fresh
 *    branch off the default); any other base is `"duplicate-branch"` (fork the
 *    chosen source). This mirrors the existing server behaviour, so the
 *    `/api/branch/create` contract is unchanged.
 *
 * The planner is **pure**: it performs no name generation, no network, and no
 * I/O. It only *flags* which Branches need a generated name via `nameSource`;
 * the caller resolves names (via the name-generation endpoint) and issues the
 * create requests.
 */

/** One Composer's resolved inputs — the per-Branch unit the dialog produces. */
export interface ComposerSpec {
  /** The branch the new Branch is based on. */
  baseBranch: string
  /** The model the seed prompt's agent should run. */
  model: string
  /** The seed prompt; empty (or whitespace-only) means a bare Branch. */
  prompt: string
}

/** The slice of Repo context the planner needs. */
export interface RepoContext {
  /** The Repo's default branch — the dividing line between the two flows. */
  defaultBranch: string
}

export interface BranchPlan {
  /**
   * Whether the Branch's name comes from a random `adjective-color-animal`
   * generator (`"random"`) or is derived from the prompt (`"from-prompt"`).
   * The planner only flags the source; the caller does the generation.
   */
  nameSource: "random" | "from-prompt"
  /**
   * The `/api/branch/create` flow: `"new"` for a fresh branch off the default,
   * `"duplicate-branch"` to fork a non-default base.
   */
  flow: "new" | "duplicate-branch"
  /** Whether a Chat Session is seeded for this Branch. */
  seedChat: boolean
  /** Whether the generated name is pinned against the server's first-chat rename. */
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
      nameSource: "random",
      flow,
      seedChat: false,
      autoNamedBranch: false,
      firePromptOnRunning: false,
    }
  }

  return {
    nameSource: "from-prompt",
    flow,
    seedChat: true,
    autoNamedBranch: true,
    firePromptOnRunning: true,
    model: spec.model,
  }
}

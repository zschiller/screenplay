import { describe, expect, it } from "vitest"
import {
  planBranchCreations,
  type ComposerSpec,
} from "@/lib/branch-create-planner"

const repo = { defaultBranch: "main" }

// A spec off the default branch, parameterised by prompt so each test states
// only the bit it cares about.
const spec = (overrides: Partial<ComposerSpec> = {}): ComposerSpec => ({
  baseBranch: "main",
  model: "claude-opus-4-8",
  prompt: "",
  ...overrides,
})

describe("planBranchCreations", () => {
  it("resolves an empty prompt to a bare, random-named, no-model Branch", () => {
    const [plan] = planBranchCreations(repo, [spec({ prompt: "" })])

    expect(plan).toEqual({
      nameSource: "random",
      flow: "new",
      seedChat: false,
      autoNamedBranch: false,
      firePromptOnRunning: false,
    })
    expect(plan!.model).toBeUndefined()
  })

  it("treats a whitespace-only prompt as empty", () => {
    const [plan] = planBranchCreations(repo, [spec({ prompt: "   \n\t " })])

    expect(plan!.nameSource).toBe("random")
    expect(plan!.seedChat).toBe(false)
    expect(plan!.firePromptOnRunning).toBe(false)
    expect(plan!.model).toBeUndefined()
  })

  it("resolves a non-empty prompt to a seeded, prompt-named Branch carrying the model", () => {
    const [plan] = planBranchCreations(repo, [
      spec({ prompt: "add a settings page", model: "claude-sonnet-4-6" }),
    ])

    expect(plan).toEqual({
      nameSource: "from-prompt",
      flow: "new",
      seedChat: true,
      autoNamedBranch: true,
      firePromptOnRunning: true,
      model: "claude-sonnet-4-6",
    })
  })

  it("trims surrounding whitespace when judging prompt presence", () => {
    const [plan] = planBranchCreations(repo, [
      spec({ prompt: "  real work  " }),
    ])

    expect(plan!.nameSource).toBe("from-prompt")
    expect(plan!.seedChat).toBe(true)
  })

  it("derives flow:'new' when the base is the default branch", () => {
    const [plan] = planBranchCreations(repo, [spec({ baseBranch: "main" })])

    expect(plan!.flow).toBe("new")
  })

  it("derives flow:'duplicate-branch' for any non-default base", () => {
    const [plan] = planBranchCreations(repo, [spec({ baseBranch: "feat/x" })])

    expect(plan!.flow).toBe("duplicate-branch")
  })

  it("derives flow from the base independently of the prompt", () => {
    const [empty] = planBranchCreations(repo, [
      spec({ baseBranch: "release", prompt: "" }),
    ])
    const [withPrompt] = planBranchCreations(repo, [
      spec({ baseBranch: "release", prompt: "do it" }),
    ])

    expect(empty!.flow).toBe("duplicate-branch")
    expect(withPrompt!.flow).toBe("duplicate-branch")
  })

  it("honours a non-'main' default branch", () => {
    const trunkRepo = { defaultBranch: "trunk" }

    const [onTrunk] = planBranchCreations(trunkRepo, [
      spec({ baseBranch: "trunk" }),
    ])
    const [offTrunk] = planBranchCreations(trunkRepo, [
      spec({ baseBranch: "main" }),
    ])

    expect(onTrunk!.flow).toBe("new")
    expect(offTrunk!.flow).toBe("duplicate-branch")
  })

  it("produces exactly one plan per spec, in order", () => {
    const specs = [spec(), spec(), spec()]

    expect(planBranchCreations(repo, specs)).toHaveLength(3)
  })

  it("resolves a heterogeneous multi-spec (parallel) input independently", () => {
    const plans = planBranchCreations(repo, [
      spec({ baseBranch: "main", prompt: "", model: "claude-opus-4-8" }),
      spec({
        baseBranch: "feat/x",
        prompt: "fix the bug",
        model: "claude-sonnet-4-6",
      }),
      spec({
        baseBranch: "main",
        prompt: "write docs",
        model: "claude-haiku-4-5",
      }),
    ])

    expect(plans).toEqual([
      {
        nameSource: "random",
        flow: "new",
        seedChat: false,
        autoNamedBranch: false,
        firePromptOnRunning: false,
      },
      {
        nameSource: "from-prompt",
        flow: "duplicate-branch",
        seedChat: true,
        autoNamedBranch: true,
        firePromptOnRunning: true,
        model: "claude-sonnet-4-6",
      },
      {
        nameSource: "from-prompt",
        flow: "new",
        seedChat: true,
        autoNamedBranch: true,
        firePromptOnRunning: true,
        model: "claude-haiku-4-5",
      },
    ])
  })

  it("returns an empty plan list for no specs", () => {
    expect(planBranchCreations(repo, [])).toEqual([])
  })

  it("does not mutate its inputs (no side effects)", () => {
    const input = spec({ prompt: "hello", baseBranch: "feat/y" })
    const snapshot = { ...input }

    planBranchCreations(repo, [input])

    expect(input).toEqual(snapshot)
  })
})

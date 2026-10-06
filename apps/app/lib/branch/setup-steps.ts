import type { BranchData } from "@/lib/types"

import { workspaceBooting } from "./workspace-state"

/**
 * Setup Steps: what a chat shows in place of its transcript while its code is
 * still being set up, as a short list of steps ticked off as they finish. It
 * reads only what setup already writes to the Branch: its status, the step
 * message provisioning reports (`provisioning.ts`), `codeReady` and the error.
 *
 * The list ends where the agent can start (`codeReady`): install and the
 * preview carry on in the background, and the bar under the composer shows
 * them. So a failure after that point is not a setup step's; the chat is live
 * by then and keeps its transcript.
 *
 * - A new chat (`creating`) lists the branch, the clone and git.
 * - Recreate (`starting`, reporting the provisioning steps) lists the clone
 *   and git: its branch already exists.
 * - A restart, Start or Reopen (`starting`, anything else) is one step: the
 *   code coming back from its snapshot.
 *
 * Pure, so `setup-steps.test.ts` covers every path without React.
 */

export type SetupStepState = "done" | "now" | "todo" | "failed"

export interface SetupStep {
  /** The step as it reads in its state: "Cloning repository", "Repository cloned". */
  label: string
  state: SetupStepState
}

export interface SetupProgress {
  steps: SetupStep[]
  /** Set when a step failed: the raw error, shown under the list. */
  error?: string
}

type SetupBranch = Pick<
  BranchData,
  "status" | "statusMessage" | "codeReady" | "error"
>

interface StepCopy {
  /** The message provisioning reports when the step starts. */
  message: string
  now: string
  done: string
}

const BRANCH: StepCopy = {
  message: "Setting up the code…",
  now: "Creating the branch",
  done: "Branch created",
}
const CLONE: StepCopy = {
  message: "Cloning repository…",
  now: "Cloning repository",
  done: "Repository cloned",
}
const GIT: StepCopy = {
  message: "Configuring git…",
  now: "Configuring git",
  done: "Git configured",
}
/** Recreate's first message, written before its old checkout is torn down. */
const RECREATE_MESSAGE = "Setting up the code again…"
const RESTORE: SetupStep = { label: "Restoring the code", state: "now" }

const NEW_CHAT = [BRANCH, CLONE, GIT]
const RECREATE = [CLONE, GIT]

const PROVISIONING_MESSAGES = new Set([
  BRANCH.message,
  RECREATE_MESSAGE,
  CLONE.message,
  GIT.message,
])

/** The steps, with the one `message` names as current (the first when none does). */
function stepsAt(
  copy: StepCopy[],
  message: string | undefined,
  current: "now" | "failed"
): SetupStep[] {
  const at = Math.max(
    0,
    copy.findIndex((step) => step.message === message)
  )
  return copy.map((step, i) =>
    i < at
      ? { label: step.done, state: "done" }
      : i === at
        ? { label: step.now, state: current }
        : { label: step.now, state: "todo" }
  )
}

/**
 * The chat's setup steps, or null once there's nothing to wait on: the code is
 * ready, or the chat failed after it was (or outside provisioning, as a
 * failed restart does), where the chat stays as it is.
 */
export function setupProgress(branch: SetupBranch): SetupProgress | null {
  const message = branch.statusMessage?.trim()
  if (workspaceBooting(branch)) {
    if (branch.status === "creating")
      return { steps: stepsAt(NEW_CHAT, message, "now") }
    if (message && PROVISIONING_MESSAGES.has(message))
      return { steps: stepsAt(RECREATE, message, "now") }
    return { steps: [RESTORE] }
  }
  // A failure before the code was ready: the step that was running failed.
  if (
    branch.status === "error" &&
    !branch.codeReady &&
    (!message || PROVISIONING_MESSAGES.has(message))
  ) {
    const copy = message === RECREATE_MESSAGE ? RECREATE : NEW_CHAT
    return {
      steps: stepsAt(copy, message, "failed").map((step) =>
        step.state === "failed"
          ? { ...step, label: `${step.label} failed` }
          : step
      ),
      error: branch.error || "Couldn’t set up the code.",
    }
  }
  return null
}

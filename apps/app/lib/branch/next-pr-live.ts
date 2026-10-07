import "server-only"

import { githubAccess } from "@/lib/github-access"
import { runSandboxAction } from "@/lib/sandbox/run"
import {
  mergedPrNote,
  moveToDefaultTip,
  type MergedPrMoveClaim,
  type MoveOutcome,
} from "./next-pr"

/**
 * The move after a merge (`next-pr.ts`) in the Workspace's sandbox, on either
 * backend, and the note it leaves the agent for this turn. Git talks to origin
 * as the turn's member: their token through the sandbox's credential helper
 * when git is brokered, the host's own credentials otherwise.
 */
export async function moveMergedBranch(
  claim: MergedPrMoveClaim
): Promise<string> {
  const { git } = githubAccess
  const token =
    git.kind === "host" ? null : await git.token(claim.userId).catch(() => null)
  const env = token ? { SCREENPLAY_GH_TOKEN: token } : undefined
  const result = await runSandboxAction(claim.sandboxName, (sandbox) =>
    moveToDefaultTip(async (args, opts) => {
      const run = await sandbox.runCommand({
        cmd: "git",
        args,
        ...(opts?.remote && env ? { env } : {}),
      })
      return { ok: run.exitCode === 0, out: (await run.stdout()).trim() }
    }, claim)
  )
  const outcome: MoveOutcome = result.success
    ? result.value
    : { kind: "handover", reason: "unreachable" }
  return mergedPrNote(outcome, claim)
}

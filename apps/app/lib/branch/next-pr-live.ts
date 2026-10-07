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
 * as the turn's member, through the GitHub access adapter: their token for the
 * sandbox's credential helper on hosted, the host's own credentials on the
 * desktop.
 */
export async function moveMergedBranch(
  claim: MergedPrMoveClaim
): Promise<string> {
  const env = await githubAccess
    .transportEnv(claim.userId)
    .catch(() => undefined)
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

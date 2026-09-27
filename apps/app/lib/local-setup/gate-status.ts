"use server"

import { listHarnessSetupRows } from "@/lib/agent/harnesses/setup-actions"
import { getGitHubLocalStatus } from "@/lib/github-local/actions"
import { isFixtureWorld } from "@/lib/fixture-world"
import { isLocalBuild } from "@/lib/local-mode"
import { deriveGateStatus } from "./is-complete"

/**
 * The first-run gate's release poll (ADR 0016): the two booleans the
 * `LocalSetupGate` needs to decide "open", read **live** so a terminal sign-in
 * that just finished lights up Finish without a reload. It reuses the same live
 * status reads the setup panels are built on (`listHarnessSetupRows()`,
 * `getGitHubLocalStatus()`) and folds them through the shared pure
 * {@link deriveGateStatus}.
 *
 * Returns **only** `{ harnessSatisfied, githubSatisfied }` — the raw credential
 * shapes behind those reads (tokens, the GitHub handle, device-token presence)
 * never cross to the client. Off the desktop build it is a no-op
 * `false`/`false`: the gate itself is `isLocalBuild`-gated (so this is never
 * reached on the hosted build), and the guard keeps a stray call from ever
 * probing host state on a server.
 *
 * In the {@link isFixtureWorld} build it short-circuits to `true`/`true`
 * *without probing the host at all*: a capture container has no coding CLI and
 * no GitHub by design (issue #716). Doing it here rather than at either call
 * site is what keeps that honest — the initial paint and the client poll both
 * read the release facts through this one action, so they cannot disagree about
 * whether the gate is open.
 */
export async function getLocalSetupGateStatus(): Promise<{
  harnessSatisfied: boolean
  githubSatisfied: boolean
}> {
  if (!isLocalBuild) return { harnessSatisfied: false, githubSatisfied: false }
  if (isFixtureWorld) return { harnessSatisfied: true, githubSatisfied: true }
  const [harnesses, github] = await Promise.all([
    listHarnessSetupRows(),
    getGitHubLocalStatus(),
  ])
  return deriveGateStatus({ harnesses, github })
}

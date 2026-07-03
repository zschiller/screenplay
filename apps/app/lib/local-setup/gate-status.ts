"use server"

import { listHarnessSetupStatus } from "@/lib/agent/harnesses/setup-actions"
import { getGitHubLocalStatus } from "@/lib/github-local/actions"
import { isLocalBuild } from "@/lib/local-mode"
import { deriveGateStatus } from "./is-complete"

/**
 * The first-run gate's release poll (ADR 0016): the two booleans the
 * `LocalSetupGate` needs to decide "open", read **live** so a terminal sign-in
 * that just finished lights up Finish without a reload. It reuses the same live
 * status reads the setup panels are built on (`listHarnessSetupStatus()`,
 * `getGitHubLocalStatus()`) and folds them through the shared pure
 * {@link deriveGateStatus}.
 *
 * Returns **only** `{ harnessSatisfied, githubSatisfied }` — the raw credential
 * shapes behind those reads (tokens, the GitHub handle, device-token presence)
 * never cross to the client. Off the desktop build it is a no-op
 * `false`/`false`: the gate itself is `isLocalBuild`-gated (so this is never
 * reached on the hosted build), and the guard keeps a stray call from ever
 * probing host state on a server.
 */
export async function getLocalSetupGateStatus(): Promise<{
  harnessSatisfied: boolean
  githubSatisfied: boolean
}> {
  if (!isLocalBuild) return { harnessSatisfied: false, githubSatisfied: false }
  const [harnesses, github] = await Promise.all([
    listHarnessSetupStatus(),
    getGitHubLocalStatus(),
  ])
  return deriveGateStatus({ harnesses, github })
}

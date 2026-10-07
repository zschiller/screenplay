"use server"

import { listHarnessReadiness } from "@/lib/agent/harnesses/setup-actions"
import { readLocalGitHubTokenSource } from "@/lib/github-local/token-resolver"
import { isFixtureWorld } from "@/lib/fixture-world"
import { readFixtureEntryState } from "@/lib/fixture-entry"
import { buildIdentity } from "@/lib/capabilities"
import { deriveGateStatus } from "./is-complete"

/**
 * The first-run gate's release poll (ADR 0016): the two booleans the
 * `LocalSetupGate` needs to decide "open", read **live** so a terminal sign-in
 * that just finished lights up Finish without a reload. It reuses the same live
 * status reads the setup panels are built on (`listHarnessSetupRows()`,
 * `getGitHubLocalStatus()`) and folds them through the shared pure
 * {@link deriveGateStatus}.
 *
 * It reads only what the release predicate folds (install/auth per harness,
 * where a GitHub token resolves), not the Settings rows' facts line or the
 * `gh` handle: the root layout awaits this on every hard load, app launch
 * included, so each extra CLI spawn or network call delays the first paint.
 *
 * Returns **only** `{ harnessSatisfied, githubSatisfied }` — the raw credential
 * shapes behind those reads (tokens, the GitHub handle) never cross to the
 * client. Off the desktop build it is a no-op
 * `false`/`false`: the gate itself is host-only (so this is never
 * reached on the hosted build), and the guard keeps a stray call from ever
 * probing host state on a server.
 *
 * In the {@link isFixtureWorld} build it short-circuits to `true`/`true`
 * *without probing the host at all*: a capture container has no coding CLI and
 * no GitHub by design (issue #716). Doing it here rather than at either call
 * site is what keeps that honest — the initial paint and the client poll both
 * read the release facts through this one action, so they cannot disagree about
 * whether the gate is open. A capture screen that wants the gate itself on screen
 * asks for one of its blocked states through the fixture entry cookie
 * (`@/lib/fixture-entry`), read here for the same reason.
 */
export async function getLocalSetupGateStatus(): Promise<{
  harnessSatisfied: boolean
  githubSatisfied: boolean
}> {
  if (buildIdentity === "account")
    return { harnessSatisfied: false, githubSatisfied: false }
  if (isFixtureWorld) {
    const entry = await readFixtureEntryState()
    return {
      harnessSatisfied: entry !== "setup-pending",
      githubSatisfied:
        entry !== "setup-pending" && entry !== "setup-agent-ready",
    }
  }
  const [harnesses, tokenSource] = await Promise.all([
    listHarnessReadiness(),
    readLocalGitHubTokenSource(),
  ])
  return deriveGateStatus({ harnesses, github: { tokenSource } })
}

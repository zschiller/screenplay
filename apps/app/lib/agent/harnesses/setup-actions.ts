"use server"

import { readFixtureEntryState } from "@/lib/fixture-entry"
import { isFixtureWorld } from "@/lib/fixture-world"
import { isLocalBuild } from "@/lib/local-mode"
import {
  createHarnessSetup,
  harnessSetup,
  type HarnessSetup,
  type HarnessSetupActionKind,
  type HarnessSetupRow,
  type HarnessSetupRun,
} from "./setup"

/**
 * Server actions backing the desktop "Coding agents" setup surface (ADR 0015) and
 * the first-run gate (ADR 0016), the harness sibling of the GitHub-connection
 * actions. Each one is a thin pass-through to the **Harness Setup** module
 * (`./setup.ts`) — every rule lives there — plus the local-build gate: the
 * surfaces are `isLocalBuild`-only client-side, and the guard keeps a stray
 * hosted-build call from ever probing host state.
 */

/**
 * The live setup rows — read **fresh every call** (never the launch-memoized
 * availability resolver), so a connect that just finished is reflected without a
 * restart. One row per distinct `hostBinary`. `[]` off the desktop build.
 */
export async function listHarnessSetupRows(): Promise<HarnessSetupRow[]> {
  if (!isLocalBuild) return []
  return (await setupFor()).rows()
}

/**
 * What harness `key`'s `kind` action runs in the inline host terminal — the
 * descriptor's install command (against live host facts) chained into its own
 * sign-in, or the bare sign-in. `null` when the key is unknown or the harness
 * carries no sign-in path. Kept server-side so the descriptors' command builders
 * never ship to the client.
 */
export async function resolveHarnessSetupRun(
  key: string,
  kind: HarnessSetupActionKind
): Promise<HarnessSetupRun | null> {
  if (!isLocalBuild) return null
  return (await setupFor()).commandsFor(key, kind)
}

/**
 * Record a finished setup run: bust the shared launch-memoized availability memo
 * so the model dropdown and new-tab picker re-probe the host (ADR 0015), and hand
 * back freshly probed rows — one round trip for "the connect landed app-wide, and
 * here is the row's new state".
 */
export async function noteHarnessConnected(): Promise<HarnessSetupRow[]> {
  if (!isLocalBuild) return []
  return (await setupFor()).markConnected()
}

/**
 * The module to read through. A Fixture World capture of the setup gate asks
 * for a host by its entry state (`@/lib/fixture-entry`) instead of probing the
 * capture container's own: nothing installed while setup is pending, and only
 * Claude Code installed and signed in once an agent is ready. Every other
 * request, fixture or not, reads the real host.
 */
async function setupFor(): Promise<HarnessSetup> {
  if (!isFixtureWorld) return harnessSetup
  const entry = await readFixtureEntryState()
  if (entry !== "setup-pending" && entry !== "setup-agent-ready") {
    return harnessSetup
  }
  return createHarnessSetup({
    probe: async (binary) =>
      entry === "setup-agent-ready" && binary === "claude",
    run: async () => ({ exitCode: 0, stdout: "fixture-credential" }),
  })
}

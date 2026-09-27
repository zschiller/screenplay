"use server"

import { defaultHostBinaryProber } from "./host-binary"
import { HARNESSES } from "./index"
import { harnessAvailability } from "./availability"
import {
  liveHarnessSetupStatuses,
  resolveHarnessSetupCommandsFor,
  type HarnessSetupCommands,
  type HarnessSetupStatus,
} from "./setup-status"
import type { HostFacts } from "./types"
import { isLocalBuild } from "@/lib/local-mode"

/**
 * Server actions backing the desktop "Coding agents" setup surface (ADR 0015),
 * the harness sibling of the GitHub-connection actions. Every action is gated to
 * the local build — the surface is `isLocalBuild`-only client-side, and the
 * guard keeps a stray hosted-build call from ever probing host state.
 */

/**
 * The live per-row setup status — read **fresh every call** (never the
 * launch-memoized availability resolver), so a connect that just finished is
 * reflected without a restart. One row per distinct `hostBinary`. `[]` off the
 * desktop build.
 */
export async function listHarnessSetupStatus(): Promise<HarnessSetupStatus[]> {
  if (!isLocalBuild) return []
  return liveHarnessSetupStatuses()
}

/**
 * Resolve the install / sign-in argv for harness `key` — the descriptor's
 * `buildInstallCommand` + `authCommand` against the live host facts
 * (`npm`/`brew` presence, arch), via {@link resolveHarnessSetupCommandsFor}.
 * Returns `null` when the key is unknown or the harness carries no
 * `authCommand` (nothing this surface can run). Kept server-side so the
 * descriptor's command builders never ship to the client.
 */
export async function resolveHarnessSetupCommands(
  key: string
): Promise<HarnessSetupCommands | null> {
  if (!isLocalBuild) return null
  const harness = HARNESSES.find((h) => h.key === key)
  if (!harness) return null
  return resolveHarnessSetupCommandsFor(harness, probeHostFacts)
}

/**
 * Bust the shared launch-memoized availability resolver so the model dropdown and
 * new-tab picker re-probe the host on their next read (ADR 0015). The setup
 * surface calls this after a connect finishes, so a freshly installed CLI reaches
 * those surfaces without a restart.
 */
export async function noteHarnessConnected(): Promise<void> {
  if (!isLocalBuild) return
  harnessAvailability.invalidate()
}

/**
 * The live host facts the install-command builders map to a shell command:
 * `npm`/`brew` presence via the same `command -v` prober host-binary detection
 * uses, and the Node runtime's CPU arch. Never throws — an absent binary probes
 * `false`.
 */
async function probeHostFacts(): Promise<HostFacts> {
  const [npmPresent, brewPresent] = await Promise.all([
    defaultHostBinaryProber("npm"),
    defaultHostBinaryProber("brew"),
  ])
  return { npmPresent, brewPresent, arch: process.arch }
}

"use server"

import { defaultHostBinaryProber } from "@/lib/agent/harnesses/host-binary"
import { isLocalBuild } from "@/lib/local-mode"

/**
 * Server actions the guided-install setup step calls before it builds an install
 * command (ADR 0014, issue #649). Desktop-only, like the other GitHub-connection
 * actions — the guard keeps a stray hosted-build call from touching host state.
 */

/**
 * Whether Homebrew is on the host `PATH` — the one bit
 * {@link buildGhInstallCommand} needs to pick `brew install gh` over the binary
 * fallback. Reuses the harness resolver's `command -v` prober
 * (`lib/agent/harnesses/host-binary.ts`), so the brew check is the exact shape
 * already trusted for host-binary detection. Never throws: an absent `brew`
 * resolves to `false`, which just routes the install down the binary path.
 */
export async function probeHomebrewPresent(): Promise<boolean> {
  if (!isLocalBuild) return false
  return defaultHostBinaryProber("brew")
}

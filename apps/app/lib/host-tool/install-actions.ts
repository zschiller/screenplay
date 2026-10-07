"use server"

import { probeHostFacts } from "@/lib/agent/harnesses/host-binary"
import { buildIdentity } from "@/lib/capabilities"

/**
 * Server actions the guided-install setup step calls before it builds an install
 * command (ADR 0014, issue #649). Desktop-only, like the other GitHub-connection
 * actions — the guard keeps a stray hosted-build call from touching host state.
 */

/**
 * Whether Homebrew is on the host `PATH` — the one bit
 * {@link buildGhInstallCommand} needs to pick `brew install gh` over the binary
 * fallback. Reads it off the **one** host-facts probe
 * (`probeHostFacts`, `lib/agent/harnesses/host-binary.ts`), the same live read
 * the Harness Setup module's install commands are built from, so `brew` presence
 * is never probed two ways. Never throws: an absent `brew` resolves to `false`,
 * which just routes the install down the binary path.
 */
export async function probeHomebrewPresent(): Promise<boolean> {
  if (buildIdentity === "account") return false
  return (await probeHostFacts()).brewPresent
}

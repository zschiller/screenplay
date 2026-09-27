import "server-only"

import { spawn } from "node:child_process"
import type { Harness, HostFacts } from "./types"

/**
 * The host-binary detector behind the **desktop** Harness Availability resolver
 * (issue #476, parent #466). Where the hosted backend folds
 * `SANDBOX_HARNESSES ∩ broker-egress`, the desktop backend has no env keys and
 * no install step — the agent rides an installed CLI's own login — so a harness
 * is "available" exactly when its `hostBinary` is present on the host `PATH`.
 *
 * The prober is **injected** so the fold is testable without touching the real
 * host: the desktop resolver memoizes one probe per app launch (a fresh install
 * shows up after a restart, by design — live re-probe is out of scope), and a
 * test passes a fake prober reporting which binaries "exist".
 */

/**
 * Probe whether a single binary is present on the host `PATH`. Resolves `true`
 * when it is, `false` otherwise — never rejects, so a missing binary is a
 * dropped harness, not a fold failure. Injected into {@link detectInstalledHarnessKeys}.
 */
export type HostBinaryProber = (binary: string) => Promise<boolean>

/**
 * The production prober: `command -v <binary>` in the host sidecar (a POSIX
 * shell builtin that resolves the binary on `PATH` and exits non-zero when it's
 * absent). Run under `sh -c` since `command` is a builtin, not an executable.
 * stdio is discarded — only the exit code matters. The binary names come from
 * the trusted catalog (`Harness.hostBinary`), so there is no untrusted shell
 * interpolation.
 */
export const defaultHostBinaryProber: HostBinaryProber = (binary) =>
  new Promise((resolve) => {
    const child = spawn("sh", ["-c", `command -v "$0"`, binary], {
      stdio: "ignore",
    })
    child.on("error", () => resolve(false))
    child.on("exit", (code) => resolve(code === 0))
  })

/**
 * The **one** dedupe-by-`hostBinary` rule: the catalog collapsed to one entry per
 * distinct `hostBinary`, in catalog order, each represented by the **first**
 * descriptor that names it. The two opencode slots (`opencode-gateway`,
 * `opencode-compat`) share one binary — one install, one login, a hosted
 * broker-provider distinction with no meaning on desktop — so they collapse to
 * one entry, with `opencode-gateway` as the representative.
 *
 * Both desktop consumers of that rule fold through here rather than re-deriving
 * it: {@link detectInstalledHarnessKeys} probes each distinct binary exactly once,
 * and the **Harness Setup** module renders one row per representative (ADR 0015).
 */
export function distinctByHostBinary(harnesses: Harness[]): Harness[] {
  const representatives: Harness[] = []
  const seen = new Set<string>()
  for (const harness of harnesses) {
    if (seen.has(harness.hostBinary)) continue
    seen.add(harness.hostBinary)
    representatives.push(harness)
  }
  return representatives
}

/**
 * Probe the live {@link HostFacts} a descriptor's `buildInstallCommand` maps to a
 * shell command (ADR 0015): `npm` / `brew` presence through the **same** prober
 * host-binary detection uses, plus the Node runtime's CPU arch. The one
 * host-facts probe in the codebase — the Harness Setup module composes it from
 * its injected prober, and the `gh` guided install reads its `brewPresent` from
 * it. Never throws: an absent binary probes `false`.
 */
export async function probeHostFacts(
  probe: HostBinaryProber = defaultHostBinaryProber
): Promise<HostFacts> {
  const [npmPresent, brewPresent] = await Promise.all([
    probe("npm"),
    probe("brew"),
  ])
  return { npmPresent, brewPresent, arch: process.arch }
}

/**
 * Fold a catalog + an injected prober → the set of harness *keys* whose
 * `hostBinary` the prober reports present. Each *distinct* `hostBinary` is probed
 * exactly once (the two opencode slots share `opencode`, so it is probed once and
 * lists whichever slots are configured — {@link distinctByHostBinary}), and probes
 * run concurrently. Returns a key set rather than `{key,label}` so the desktop
 * resolver can decide listing order and status; an absent binary simply drops
 * every harness keyed on it.
 */
export async function detectInstalledHarnessKeys(
  harnesses: Harness[],
  probe: HostBinaryProber
): Promise<Set<string>> {
  const binaries = distinctByHostBinary(harnesses).map((h) => h.hostBinary)
  const results = await Promise.all(
    binaries.map(async (binary) => [binary, await probe(binary)] as const)
  )
  const present = new Set(
    results.filter(([, ok]) => ok).map(([binary]) => binary)
  )

  const keys = new Set<string>()
  for (const harness of harnesses) {
    if (present.has(harness.hostBinary)) keys.add(harness.key)
  }
  return keys
}

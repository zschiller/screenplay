import "server-only"

import { defaultHostBinaryProber, type HostBinaryProber } from "./host-binary"
import { HARNESSES } from "./index"
import { defaultHarnessProcessRunner } from "./process-runner"
import type { Harness, HarnessProcessRunner } from "./types"

/**
 * The **live** per-row status behind the desktop "Coding agents" Settings surface
 * (ADR 0015). Where {@link import("./availability").createDesktopResolver} probes
 * host presence *once per launch and memoized* (the hot path the dropdown reads),
 * this is read **fresh every call** so a connect that just finished is reflected
 * without a restart — and it adds the per-descriptor auth fact the memoized
 * resolver never probes.
 *
 * One entry **per distinct `hostBinary`** (the dedupe fold): the two opencode
 * slots share one binary, one install, one login — a hosted broker distinction
 * with no meaning on desktop — so they collapse to a single row, the same way
 * detection already probes `opencode` once. The representative descriptor for a
 * binary is the first catalog entry that names it (so its `key`/`label`/auth
 * probe drive the row).
 */
export interface HarnessSetupStatus {
  /** Representative harness key for this row (first catalog entry on the binary). */
  key: string
  /** Human-readable label shown on the row. */
  label: string
  /** The host binary this row installs / detects — the dedupe key. */
  hostBinary: string
  /** Whether the binary is on the host `PATH` right now (probed live). */
  installed: boolean
  /**
   * Whether the CLI's own login is present: `boolean` when the representative
   * descriptor carries a `probeAuth` and the binary is installed, else `null`
   * ("not probed / can't tell"). Never used to gate listing — only to label the
   * row (the Harness Availability invariant: presence lists, auth is surfaced).
   */
  authenticated: boolean | null
}

/**
 * Fold a catalog + a live host prober + a process runner → one
 * {@link HarnessSetupStatus} per distinct `hostBinary`, in catalog order. Both
 * seams are injected so the fold is unit-testable with fakes (a prober reporting
 * which binaries "exist", a runner returning canned credential replies), and
 * both are read **live on every call** — there is no memo here, so a second call
 * re-probes (that freshness is the whole point of the setup surface).
 *
 * Auth is probed only for an **installed** binary whose representative descriptor
 * has a `probeAuth`; a not-installed row is `authenticated: null` (moot — the row
 * reads "Not installed"), and a descriptor without a probe is `null` ("can't
 * tell"), which the surface treats as *not authed* (offer sign-in), never a false
 * "connected".
 */
export async function resolveHarnessSetupStatuses(
  harnesses: Harness[],
  probe: HostBinaryProber,
  run: HarnessProcessRunner
): Promise<HarnessSetupStatus[]> {
  // Distinct hostBinaries in catalog order, each mapped to its representative
  // (first) descriptor — the dedupe fold that collapses the opencode slots.
  const representatives: Harness[] = []
  const seen = new Set<string>()
  for (const harness of harnesses) {
    if (seen.has(harness.hostBinary)) continue
    seen.add(harness.hostBinary)
    representatives.push(harness)
  }

  return Promise.all(
    representatives.map(async (harness) => {
      const installed = await probe(harness.hostBinary)
      const authenticated =
        installed && harness.probeAuth ? await harness.probeAuth(run) : null
      return {
        key: harness.key,
        label: harness.label,
        hostBinary: harness.hostBinary,
        installed,
        authenticated,
      }
    })
  )
}

/**
 * The production live read: the real catalog through the production host prober
 * and process runner. The server action wraps this behind the `isLocalBuild`
 * gate.
 */
export function liveHarnessSetupStatuses(): Promise<HarnessSetupStatus[]> {
  return resolveHarnessSetupStatuses(
    HARNESSES,
    defaultHostBinaryProber,
    defaultHarnessProcessRunner
  )
}

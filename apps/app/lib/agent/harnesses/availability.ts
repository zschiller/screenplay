import "server-only"

import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import type { ModelProvider } from "@/lib/agent/providers"
import { HARNESSES, selectHarnesses } from "./index"
import {
  defaultHostBinaryProber,
  detectInstalledHarnessKeys,
  type HostBinaryProber,
} from "./host-binary"
import type { Harness } from "./types"

/**
 * The **Harness Availability** seam (issue #476, parent #466): the single
 * per-backend fold over the *one* Harness catalog that answers "which harnesses
 * can this deployment offer, and in what state". The model dropdown, the
 * Terminal-Tab new-tab picker, and the external-Engine backing all read this one
 * answer instead of three divergent lists.
 *
 * Two resolvers sit behind it, selected by the build-time backend the way
 * `SandboxProvider` is (ADR 0003) — see {@link harnessAvailability}:
 *  - the **hosted** resolver generalizes today's selection fold,
 *    `SANDBOX_HARNESSES ∩ broker-egress` (provider configured AND
 *    header-brokerable), installed into the sandbox;
 *  - the **desktop** resolver detects installed CLIs by probing each
 *    descriptor's `hostBinary` on the host — no broker, no install.
 *
 * Listing is gated on **presence**, never on auth, mirroring how the hosted side
 * lists on provider-*configured*, not provider-*verified*. The status object is
 * shaped (`installed` today) so `authenticated` can be added later additively.
 */

/**
 * Per-harness availability status. `installed` is the only fact this slice
 * surfaces (and is `true` for every *listed* harness, since listing is gated on
 * presence); the object is kept open so an auth-aware pass can add
 * `authenticated` without reshaping every consumer.
 */
export interface HarnessStatus {
  installed: boolean
}

/** A harness the deployment can offer, paired with its availability status. */
export interface AvailableHarness {
  harness: Harness
  status: HarnessStatus
}

/** The seam: a backend-aware fold over the catalog → the available harnesses. */
export interface HarnessResolver {
  list(): Promise<AvailableHarness[]>
}

/**
 * A consumer's capability requirement, used to filter the one availability list
 * per surface (the whole point is one fold, many consumers):
 *  - `"chat"` needs a harness that can back the external Engine — i.e. one with
 *    an `acpAdapter`;
 *  - `"terminal"` needs only presence (any available harness can launch a tab).
 */
export type HarnessCapability = "chat" | "terminal"

/**
 * Filter an availability list by what a consumer needs. `"chat"` keeps only
 * harnesses with an `acpAdapter` (the rest can't back agent chat); `"terminal"`
 * keeps everything (presence is enough to launch a tab). Pure — preserves order.
 */
export function filterByCapability(
  available: AvailableHarness[],
  capability: HarnessCapability
): AvailableHarness[] {
  if (capability === "terminal") return available
  return available.filter(({ harness }) => harness.acpAdapter !== null)
}

/**
 * The hosted resolver: `SANDBOX_HARNESSES ∩ broker-egress`, the same selection
 * fold provisioning runs, lifted into the seam. Every installable harness lists
 * as `installed` (it is provisioned into the sandbox). Reads
 * `process.env.SANDBOX_HARNESSES` and the configured provider registry by
 * default; both are injectable so the fold is testable without the provider
 * graph (the `getModelProviders` import is loaded lazily only when no providers
 * are supplied, keeping this module's import free of the providers' db chain).
 */
export function createHostedResolver(
  opts: { sandboxHarnesses?: string; providers?: ModelProvider[] } = {}
): HarnessResolver {
  return {
    async list() {
      const sandboxHarnesses =
        opts.sandboxHarnesses ?? process.env.SANDBOX_HARNESSES
      const providers =
        opts.providers ??
        (await import("@/lib/agent/providers")).getModelProviders()
      return selectHarnesses(sandboxHarnesses, providers).installable.map(
        (harness) => ({ harness, status: { installed: true } })
      )
    },
  }
}

/**
 * The desktop resolver: lists every catalog harness whose `hostBinary` the
 * injected prober reports present on the host PATH (no broker, no install). The
 * probe runs **once per app launch** and is cached — a freshly-installed CLI
 * shows up after a restart, by design (live re-probe is out of scope) — so two
 * `list()` calls share one detection. `probe` defaults to the production
 * `command -v` prober; tests pass a fake.
 */
export function createDesktopResolver(
  opts: { harnesses?: Harness[]; probe?: HostBinaryProber } = {}
): HarnessResolver {
  const harnesses = opts.harnesses ?? HARNESSES
  const probe = opts.probe ?? defaultHostBinaryProber
  let detected: Promise<Set<string>> | undefined
  return {
    async list() {
      detected ??= detectInstalledHarnessKeys(harnesses, probe)
      const present = await detected
      return harnesses
        .filter((harness) => present.has(harness.key))
        .map((harness) => ({ harness, status: { installed: true } }))
    },
  }
}

/**
 * The configured Harness Availability seam singleton, selected at build time by
 * the sandbox backend the build targets — the same `isLocalSandboxBackend()`
 * switch that picks the `SandboxProvider` (ADR 0003). The hosted build folds
 * `SANDBOX_HARNESSES ∩ broker-egress`; the desktop build (`SANDBOX_BACKEND=local`)
 * detects installed CLIs on the host. Selection is a single read at module load,
 * not a per-call branch.
 */
function selectHarnessAvailability(): HarnessResolver {
  if (isLocalSandboxBackend()) return createDesktopResolver()
  return createHostedResolver()
}

export const harnessAvailability: HarnessResolver = selectHarnessAvailability()

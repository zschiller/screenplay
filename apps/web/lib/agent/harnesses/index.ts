import "server-only"

import type { ModelProvider } from "@/lib/agent/providers"
import { claudeCodeHarness } from "./claude-code"
import { BROKERED_VALUE } from "./types"
import type { Harness, HarnessSelection, SkippedHarness } from "./types"

export { BROKERED_VALUE } from "./types"
export type { Harness, HarnessSelection, SkippedHarness } from "./types"

/**
 * The active harness catalog. Extend it the same way the provider registry
 * (`lib/agent/providers/index.ts`) is extended: drop a sibling descriptor file
 * and add its export to this array. Nothing else needs to change — the
 * selection fold, the brokered-env fold, and the installer all generalize over
 * the array.
 *
 * Order is preserved through selection, so entries install in catalog order.
 */
const HARNESSES: Harness[] = [claudeCodeHarness]

const HARNESSES_BY_KEY = new Map<string, Harness>(
  HARNESSES.map((h) => [h.key, h]),
)

/** The catalog, read-only. */
export function getHarnesses(): Harness[] {
  return HARNESSES
}

/**
 * Parse a `SANDBOX_HARNESSES` value into harness keys: comma-separated, trimmed,
 * empties dropped, duplicates collapsed (first wins), order preserved. Unset or
 * empty yields no keys.
 */
export function parseHarnessKeys(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const keys: string[] = []
  for (const part of raw.split(",")) {
    const key = part.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }
  return keys
}

/**
 * Pure selection fold over already-parsed harness keys + the provider registry.
 * A key is installable only when (a) it's a known catalog entry and (b) its
 * broker provider is configured AND header-brokerable (`egress()` non-null).
 * Unknown keys and unconfigured/non-brokerable harnesses are dropped with a
 * skip reason — never a hard failure. Order is preserved.
 */
export function resolveHarnesses(
  keys: string[],
  providers: ModelProvider[],
): HarnessSelection {
  const providersByKey = new Map(providers.map((p) => [p.key, p]))
  const installable: Harness[] = []
  const skipped: SkippedHarness[] = []
  for (const key of keys) {
    const harness = HARNESSES_BY_KEY.get(key)
    if (!harness) {
      skipped.push({ key, reason: `unknown harness "${key}"` })
      continue
    }
    const provider = providersByKey.get(harness.brokerProviderKey)
    if (!provider || provider.egress() === null) {
      skipped.push({
        key,
        reason: `broker provider "${harness.brokerProviderKey}" is not configured or not header-brokerable`,
      })
      continue
    }
    installable.push(harness)
  }
  return { installable, skipped }
}

/**
 * The selection fold the issue describes: `(SANDBOX_HARNESSES string + provider
 * registry) → installable descriptors + skip reasons`. Parses the raw env value
 * then resolves it. Unset/empty → none installable.
 */
export function selectHarnesses(
  sandboxHarnesses: string | undefined,
  providers: ModelProvider[],
): HarnessSelection {
  return resolveHarnesses(parseHarnessKeys(sandboxHarnesses), providers)
}

/**
 * Pure fold over the installable harnesses → the dummy gate vars each needs to
 * boot (`ANTHROPIC_API_KEY=brokered`, etc.) plus any base-url override env.
 * Generalizes the old `BROKERED_ANTHROPIC_ENV` constant. Never emits a real
 * provider key — the firewall injects the real key on egress (ADR 0002
 * invariant), so only the dummy `BROKERED_VALUE` is set here.
 */
export function buildBrokeredEnv(harnesses: Harness[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const harness of harnesses) {
    env[harness.gateEnvVar] = BROKERED_VALUE
    if (harness.baseUrlEnv) env[harness.baseUrlEnv.name] = harness.baseUrlEnv.value
  }
  return env
}

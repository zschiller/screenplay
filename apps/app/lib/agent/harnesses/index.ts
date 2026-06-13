import "server-only"

import type { ModelProvider } from "@/lib/agent/providers"
import { claudeCodeHarness } from "./claude-code"
import { codexHarness } from "./codex"
import { opencodeCompatHarness, opencodeGatewayHarness } from "./opencode"
import { BROKERED_VALUE } from "./types"
import type {
  AcpAdapter,
  Harness,
  HarnessSelection,
  SkippedHarness,
} from "./types"

export { BROKERED_VALUE } from "./types"
export type {
  AcpAdapter,
  Harness,
  HarnessSelection,
  SkippedHarness,
} from "./types"

/**
 * The active harness catalog. Extend it the same way the provider registry
 * (`lib/agent/providers/index.ts`) is extended: drop a sibling descriptor file
 * and add its export to this array. Nothing else needs to change — the
 * selection fold, the brokered-env fold, and the installer all generalize over
 * the array.
 *
 * Order is preserved through selection, so entries install in catalog order.
 */
export const HARNESSES: Harness[] = [
  claudeCodeHarness,
  codexHarness,
  opencodeGatewayHarness,
  opencodeCompatHarness,
]

const HARNESSES_BY_KEY = new Map<string, Harness>(
  HARNESSES.map((h) => [h.key, h])
)

/**
 * The ACP adapter spawn argv for harness `key`, or `null` when `key` names no
 * catalog entry or names a terminal-only harness (one whose descriptor carries
 * no `acpAdapter`). Reads the *one* catalog entry — there is no separate adapter
 * map — so `resolveAcpLaunch` (`./acp-launch`) and the chat-capability filter
 * agree on which CLIs can back agent chat. An unknown key returns `null` so the
 * caller falls back rather than spawning a guessed binary.
 */
export function harnessAcpAdapter(
  key: string | null | undefined
): AcpAdapter | null {
  if (!key) return null
  return HARNESSES_BY_KEY.get(key)?.acpAdapter ?? null
}

/**
 * Argv that launches the harness CLI for `key` in an interactive terminal tab
 * (binary + boot flags), or `null` when `key` names no catalog entry. The
 * terminal / default-tab plumbing uses this to drop a fresh tab straight into a
 * configured harness; an unknown key returns `null` so the caller falls back to
 * a plain shell rather than failing.
 */
export function harnessLaunchArgv(key: string): string[] | null {
  return HARNESSES_BY_KEY.get(key)?.launchArgv ?? null
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
  providers: ModelProvider[]
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
  providers: ModelProvider[]
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
    if (harness.baseUrlEnv)
      env[harness.baseUrlEnv.name] = harness.baseUrlEnv.value
  }
  return env
}

/**
 * Resolve a terminal tab's stored `harnessKey` → the launch argv ttyd appends
 * after the tmux session name, against the set of harnesses actually installed
 * in the sandbox (`installable`). The harness is wrapped as
 * `sh -c '<launchCommand>; exec $SHELL'` so quitting it (Ctrl-D) drops the
 * operator into a normal shell in the same persistent tmux session rather than
 * killing the tab.
 *
 * Returns `[]` (a plain login shell — ttyd's base `tmux new -A -s <session>`
 * with no command) when the tab has no `harnessKey` (a row created before
 * harness auto-launch, #285) or when its key isn't installed (an operator
 * dropped it from `SANDBOX_HARNESSES`, or its broker provider is unconfigured).
 * That graceful fall-through, not an error, is the tracer-bullet's safety net.
 */
export function resolveLaunchArgv(
  harnessKey: string | null | undefined,
  installable: Harness[]
): string[] {
  if (!harnessKey) return []
  const harness = installable.find((h) => h.key === harnessKey)
  if (!harness) return []
  return ["sh", "-c", `${harness.launchCommand}; exec $SHELL`]
}

/**
 * Launch argv for a terminal tab when the backend offers no harness at all: a
 * bare login shell preceded by a banner telling the operator how to make one
 * available, so the empty state explains itself instead of presenting a silent
 * blank shell. Wrapped like the harness launch (`exec $SHELL`) so the operator
 * lands in a normal shell after the banner prints. Used only when the tab would
 * otherwise open a plain shell *and* nothing is available — a tab whose harness
 * launches never shows it.
 *
 * The guidance is backend-specific: the **hosted** backend installs harnesses
 * from `SANDBOX_HARNESSES`, so its banner points there; the **desktop** backend
 * detects a CLI on the host PATH (no env, no install), so its banner points at
 * installing one (managed from the deferred homescreen Settings surface).
 */
export function unconfiguredBannerArgv(
  backend: "hosted" | "desktop" = "hosted"
): string[] {
  const banner =
    backend === "desktop"
      ? "No coding harness was detected. " +
        "Install a coding CLI (e.g. claude, codex, or opencode) on your PATH and " +
        "restart Screenplay to launch it in this terminal — manage harnesses from Settings."
      : "No coding harness is configured. " +
        "Set SANDBOX_HARNESSES (e.g. SANDBOX_HARNESSES=claude-code) and reprovision " +
        "to launch a CLI in this terminal."
  // The banner is a fixed literal with no single quotes, so a single-quoted
  // shell arg is safe; printf interprets the `\n`s in the format string.
  return ["sh", "-c", `printf '\\n%s\\n\\n' '${banner}'; exec $SHELL`]
}

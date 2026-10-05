import "server-only"

import type { ModelProvider } from "@/lib/agent/providers"
import type { ToolNaming } from "@/lib/agent/tool-name"
import { claudeCodeHarness } from "./claude-code"
import { codexHarness } from "./codex"
import { opencodeCompatHarness, opencodeGatewayHarness } from "./opencode"
import { BROKERED_VALUE } from "./types"
import type {
  AcpAdapter,
  Harness,
  HarnessOwnSkills,
  HarnessSelection,
  SkippedHarness,
} from "./types"

export { BROKERED_VALUE } from "./types"
export type {
  AcpAdapter,
  Harness,
  HarnessOwnSkills,
  HarnessSelection,
  SkippedHarness,
} from "./types"
export {
  decodeHarnessModelId,
  encodeHarnessModelId,
  isValidHarnessKey,
} from "./model-id"
export type { HarnessModelId } from "./model-id"

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
 * How a system prompt names Screenplay's tools for harness `key`, which
 * reaches them as the MCP server `server` (#1223). A harness whose descriptor
 * states its MCP tool names ({@link AcpAdapter.mcpToolName}: Claude Code's
 * `mcp__<server>__<tool>`, OpenCode's `<server>_<tool>`) gets them exactly.
 * Any other namespaces MCP tools in ways that vary by version (Codex's
 * `screenplay/<tool>` titles aren't what its model calls), so its prompt
 * keeps the bare names and says where they come from.
 */
export function harnessToolNaming(key: string, server: string): ToolNaming {
  const mcpToolName = harnessAcpAdapter(key)?.mcpToolName
  if (mcpToolName) {
    return { name: (tool) => mcpToolName(server, tool), harness: true }
  }
  return {
    name: (tool) => tool,
    harness: true,
    note: `Screenplay’s own tools named in these instructions come from the MCP server \`${server}\`, so they may be listed under that server’s namespace rather than by the bare names below.`,
  }
}

/**
 * Where harness `key` keeps its own Skills on the desktop host (#1560), or
 * `null` for an unknown key or one with none.
 */
export function harnessOwnSkills(
  key: string | null | undefined
): HarnessOwnSkills | null {
  if (!key) return null
  return HARNESSES_BY_KEY.get(key)?.ownSkills ?? null
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
 * with no command) when the tab has no `harnessKey` (every new tab since
 * shells became plain, #1343, and rows from before #285) or when its key isn't
 * installed (an operator dropped it from `SANDBOX_HARNESSES`, or its broker
 * provider is unconfigured).
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

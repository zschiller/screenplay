import "server-only"

import { sandboxProvider } from "@/lib/sandbox"
import { engineChoiceFromEnv, selectEngine } from "./engine-select"
import type { Engine } from "./engine-seam"
import { SpawnAcpSessionFactory } from "./spawn-session-factory"

/**
 * The harness whose ACP adapter backs **agent chat** on the external engine.
 *
 * Distinct from a Terminal Tab's harness (a per-tab, user-picked column): agent
 * chat has no per-chat harness today, so the desktop build names one installed
 * CLI here to drive every chat. The value is an *ACP-adapter* key
 * (`@/lib/agent/harnesses/acp-launch`: `claude`, `codex`), not a terminal
 * catalog key. Default `claude` — the Claude Code adapter, which rides the
 * user's existing login with no model key (PRD #404).
 */
export const ACP_HARNESS_ENV_VAR = "SCREENPLAY_ACP_HARNESS"
const DEFAULT_ACP_HARNESS = "claude"

/** Read the configured ACP harness key, defaulting to `claude`. */
export function acpHarnessFromEnv(
  env: Record<string, string | undefined> = process.env
): string {
  return env[ACP_HARNESS_ENV_VAR]?.trim() || DEFAULT_ACP_HARNESS
}

/**
 * Resolve the {@link Engine} for a live agent turn, wiring the external engine's
 * production transport when `AGENT_ENGINE=external` (the desktop build).
 *
 * This is the assembly point ADR 0006 / `engine-select` deferred: `selectEngine`
 * alone throws under `AGENT_ENGINE=external` because it has no session factory:
 * the factory is request-scoped, since the external engine spawns the harness's
 * ACP adapter **in the Branch's worktree**, so its `cwd` is only known once the
 * turn's `sandboxName` is. This builds the {@link SpawnAcpSessionFactory} for the
 * configured harness and resolves that worktree path, then hands both to
 * `selectEngine`.
 *
 * On the in-process default it returns that engine directly — the `external`
 * config is never constructed, so no sandbox lookup happens on the hosted path.
 * Like `selectEngine`, a misconfigured `external` deployment throws here at the
 * route boundary rather than silently degrading.
 */
export async function resolveLiveEngine(
  opts: { sandboxName?: string } = {}
): Promise<Engine> {
  if (engineChoiceFromEnv() !== "external") {
    // In-process default: self-contained, no transport to wire.
    return selectEngine()
  }

  // The agent runs in the Branch's worktree — the same absolute path the
  // terminal transport and tools resolve (`SandboxInstance.worktreePath`). A
  // layer-targeted chat has no sandbox, so the engine falls back to "/".
  const cwd = opts.sandboxName
    ? (await sandboxProvider.get({ name: opts.sandboxName })).worktreePath
    : undefined

  const sessionFactory = new SpawnAcpSessionFactory({
    harnessKey: acpHarnessFromEnv(),
  })
  return selectEngine({ external: { sessionFactory, cwd } })
}

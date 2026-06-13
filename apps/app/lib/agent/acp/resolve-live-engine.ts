import "server-only"

import { sandboxProvider } from "@/lib/sandbox"
import { getAcpSessionId, setAcpSessionId } from "@/lib/agent/persistence"
import { engineChoiceFromEnv, selectEngine } from "./engine-select"
import type { Engine } from "./engine-seam"
import { SpawnAcpSessionFactory } from "./spawn-session-factory"

/**
 * The harness whose ACP adapter backs **agent chat** on the external engine.
 *
 * Agent chat has no per-chat harness today, so the desktop build names one
 * installed CLI here to drive every chat. The value is a Harness **catalog key**
 * (`claude-code`, `codex`) — the same key that names the Terminal Tab and the
 * `harness:` model id, since the per-CLI adapter is now folded into the one
 * descriptor (#476) with no separate adapter-key namespace. Default `claude-code`
 * — the Claude Code adapter, which rides the user's existing login with no model
 * key (PRD #404).
 */
export const ACP_HARNESS_ENV_VAR = "SCREENPLAY_ACP_HARNESS"
const DEFAULT_ACP_HARNESS = "claude-code"

/** Read the configured ACP harness key, defaulting to `claude-code`. */
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
 *
 * When `chatId` is given on the external path it wires native session resume:
 * the chat's stored ACP session id (if any) seeds `session/load`, and a callback
 * persists a freshly created id back to the chat so the next turn resumes it.
 * Without it the agent would boot a context-less `session/new` every turn — the
 * desktop bug where the model couldn't see earlier messages.
 */
export async function resolveLiveEngine(
  opts: { sandboxName?: string; chatId?: string } = {}
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
  // Resume the agent's own session across turns/reloads when we have a chat to
  // key it on. The id is loaded once here (per-request) and re-bound by the
  // engine on a fresh `session/new`.
  const loadSessionId = opts.chatId
    ? ((await getAcpSessionId(opts.chatId)) ?? undefined)
    : undefined
  const onSessionId = opts.chatId
    ? (sessionId: string) => setAcpSessionId(opts.chatId!, sessionId)
    : undefined

  return selectEngine({
    external: { sessionFactory, cwd, loadSessionId, onSessionId },
  })
}

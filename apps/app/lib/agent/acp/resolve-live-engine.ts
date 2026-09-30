import "server-only"

import { sandboxProvider } from "@/lib/sandbox"
import {
  getAcpSessionId,
  getChatModel,
  setAcpSessionId,
  setChatModel,
} from "@/lib/agent/persistence"
import {
  decodeHarnessModelId,
  encodeHarnessModelId,
} from "@/lib/agent/harnesses"
import { roomIdOfRoomChat } from "@/lib/chat/room-chat"
import { isLocalBuild } from "@/lib/local-mode"
import {
  BARE_TOOL_NAMING,
  harnessToolNaming,
  type ToolNaming,
} from "@/lib/agent/tool-name"
import {
  COORDINATOR_MCP_SERVER_NAME,
  coordinatorMcpServer,
  coordinatorSessionMeta,
  ensureCoordinatorFolder,
  ensureDocumentsFolder,
} from "@/lib/agent/coordinator-mcp"
import { engineChoiceFromEnv, selectEngine } from "./engine-select"
import type { ExternalEngineConfig } from "./acp-engine"
import type { Engine } from "./engine-seam"
import { SpawnAcpSessionFactory } from "./spawn-session-factory"

/**
 * The **default** harness whose ACP adapter backs the external engine for a chat
 * with **no stored harness id**.
 *
 * A chat picks its own Harness through its stored `model` id (`harness:<key>`,
 * read by {@link decodeHarnessModelId}); this env var is the fallback for a chat
 * that hasn't — no longer "the one harness" for every chat (#479). The value is a
 * Harness **catalog key** (`claude-code`, `codex`) — the same key that names the
 * Terminal Tab and the `harness:` model id, since the per-CLI adapter is folded
 * into the one descriptor (#476) with no separate adapter-key namespace. Default
 * `claude-code` — the Claude Code adapter, which rides the user's existing login
 * with no model key (PRD #404).
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
 * How a turn's system prompt names Screenplay's tools (#1223): by the names
 * the harness gives them when {@link resolveLiveEngine} serves them to it over
 * MCP (the desktop build), else by their bare names. `model` is the chat's
 * model id for the turn, which picks the harness as it does there.
 */
export function toolNamingForTurn(
  model: string | undefined,
  env: Record<string, string | undefined> = process.env
): ToolNaming {
  if (engineChoiceFromEnv(env) !== "external" || !isLocalBuild) {
    return BARE_TOOL_NAMING
  }
  const harnessKey = decodeHarnessModelId(model)?.key ?? acpHarnessFromEnv(env)
  return harnessToolNaming(harnessKey, COORDINATOR_MCP_SERVER_NAME)
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
 *
 * `model` is the chat's stored `model` id, parsed by the harness codec into
 * `{ harnessKey, modelId? }` (#526, AC#1). A `harness:<key>` id picks which
 * adapter the (already build-selected) external engine spawns; the optional
 * `:<modelId>` half refines *which model* that adapter runs, threaded to both
 * the spawn (codex's `-c model=`) and the session (claude-code's
 * `set_config_option`). Any other id — a `provider:` model, or none — falls back
 * to {@link acpHarnessFromEnv} with no model. The id only ever selects the
 * adapter and refines its model, never the engine (ADR 0006): it can't flip a
 * deployment between in-process and external. A harness the user picked but
 * hasn't logged into isn't dropped here — it's spawned, and fails loud at turn
 * time with the CLI's own login prompt.
 */
export async function resolveLiveEngine(
  opts: {
    sandboxName?: string
    /** The document a document chat's turn targets. */
    markdownLayerId?: string
    chatId?: string
    model?: string
    /** The turn's Room, which a Workspace chat's MCP token is bound to. */
    roomId?: string
  } = {}
): Promise<Engine> {
  if (engineChoiceFromEnv() !== "external") {
    // In-process default: self-contained, no transport to wire.
    return selectEngine()
  }

  // The agent runs in the Branch's worktree — the same absolute path the
  // terminal transport and tools resolve (`SandboxInstance.worktreePath`). The
  // Coordinator and a document chat run in an app-owned folder with their
  // tools served over MCP.
  const folderSession =
    (await coordinatorSession(opts.chatId)) ?? (await documentSession(opts))
  const mcp = folderSession ?? workspaceSession(opts)
  const cwd = opts.sandboxName
    ? (await sandboxProvider.get({ name: opts.sandboxName })).worktreePath
    : folderSession?.cwd

  // Parse the stored id once into `{ key, modelId? }`. A non-harness id (a
  // `provider:` model, or none) decodes to null → the env-default harness and no
  // model. The key picks the adapter; the modelId refines its model (#526).
  const decoded = decodeHarnessModelId(opts.model)
  const harnessKey = decoded?.key ?? acpHarnessFromEnv()
  const modelId = decoded?.modelId

  const sessionFactory = new SpawnAcpSessionFactory({ harnessKey, modelId })
  // Resume the agent's own session across turns/reloads when we have a chat to
  // key it on. The id is loaded once here (per-request) and re-bound by the
  // engine on a fresh `session/new`.
  //
  // The stored session belongs to the Harness that made it. A chat that switched
  // to another Harness's model since its last turn starts a fresh session there
  // (the engine replays the history into it) rather than handing one adapter
  // another's session id. The chat's stored model is still the last turn's
  // here: the turn's own model is written when its target prepares, after this.
  const loadSessionId =
    opts.chatId && (await sameHarnessAsLastTurn(opts.chatId, harnessKey))
      ? ((await getAcpSessionId(opts.chatId)) ?? undefined)
      : undefined
  const onSessionId = opts.chatId
    ? (sessionId: string) => setAcpSessionId(opts.chatId!, sessionId)
    : undefined
  // Rewrite the chat's stored model to the one the session settled on when the
  // stored model was stale (#526): re-encode the resolved bare id under the same
  // Harness key. Only when we can key it on a chat.
  const reconcileModel = opts.chatId
    ? (resolved: string) =>
        setChatModel(opts.chatId!, encodeHarnessModelId(harnessKey, resolved))
    : undefined

  return selectEngine({
    external: {
      sessionFactory,
      cwd,
      loadSessionId,
      onSessionId,
      modelId,
      reconcileModel,
      mcpServers: mcp?.mcpServers,
      sessionMeta: mcp?.sessionMeta,
    },
  })
}

/**
 * Whether a chat's last turn ran on `harnessKey`, so its stored ACP session can
 * be resumed. A chat with no stored model ran on the env-default Harness.
 */
async function sameHarnessAsLastTurn(
  chatId: string,
  harnessKey: string
): Promise<boolean> {
  const last = decodeHarnessModelId(await getChatModel(chatId))
  return (last?.key ?? acpHarnessFromEnv()) === harnessKey
}

/**
 * The Coordinator's harness session setup (#903), or null for any other chat:
 * its Room's stable folder, its tools as an MCP server on the sidecar, and
 * Claude's allow rule for them. Only the local build serves that MCP route, so
 * anywhere else the Coordinator gets no server rather than a dead one.
 */
async function coordinatorSession(chatId: string | undefined): Promise<
  | (Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> & {
      cwd: string
    })
  | null
> {
  const roomId = chatId ? roomIdOfRoomChat(chatId) : null
  if (!roomId || !chatId || !isLocalBuild) return null
  return {
    cwd: await ensureCoordinatorFolder(roomId),
    mcpServers: [coordinatorMcpServer({ roomId, chatId })],
    sessionMeta: coordinatorSessionMeta(),
  }
}

/**
 * A document chat's harness session setup: its Room's documents folder, and
 * its tools (the document's edits, document reads, and reads of the
 * Workspaces' code) as the same MCP server, bound to its document. Without
 * them a harness has nothing to edit the document with. Local build only,
 * like the route.
 */
async function documentSession(opts: {
  markdownLayerId?: string
  chatId?: string
  roomId?: string
}): Promise<
  | (Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> & {
      cwd: string
    })
  | null
> {
  const { markdownLayerId, chatId, roomId } = opts
  if (!markdownLayerId || !chatId || !roomId || !isLocalBuild) return null
  return {
    cwd: await ensureDocumentsFolder(roomId),
    mcpServers: [coordinatorMcpServer({ roomId, chatId, markdownLayerId })],
    sessionMeta: coordinatorSessionMeta(),
  }
}

/**
 * A Workspace chat's harness session setup: its own dev server's tools (log
 * and Dev Server Restart, `dev-server-tools.ts`) as the same MCP server, bound
 * to its Sandbox. The harness's shell runs in the worktree but never sees the
 * dev server Screenplay supervises. Local build only, like the route.
 */
function workspaceSession(opts: {
  sandboxName?: string
  chatId?: string
  roomId?: string
}): Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> | null {
  const { sandboxName, chatId, roomId } = opts
  if (!sandboxName || !chatId || !roomId || !isLocalBuild) return null
  return {
    mcpServers: [coordinatorMcpServer({ roomId, chatId, sandboxName })],
    sessionMeta: coordinatorSessionMeta(),
  }
}

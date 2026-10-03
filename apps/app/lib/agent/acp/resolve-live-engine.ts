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
} from "@/lib/agent/coordinator-mcp"
import { ExternalEngine, type ExternalEngineConfig } from "./acp-engine"
import type { Engine } from "./engine-seam"
import { inProcessEngine } from "./in-process-engine"
import { SpawnAcpSessionFactory } from "./spawn-session-factory"
import {
  acpHarnessFromEnv,
  engineChoiceFromEnv,
  turnHarnessKey,
} from "./engine-choice"

export {
  ACP_HARNESS_ENV_VAR,
  acpHarnessFromEnv,
  ENGINE_ENV_VAR,
  engineChoiceFromEnv,
  turnHarnessKey,
  type EngineChoice,
} from "./engine-choice"

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
  const harnessKey = turnHarnessKey(model, env)
  if (!harnessKey) return BARE_TOOL_NAMING
  return harnessToolNaming(harnessKey, COORDINATOR_MCP_SERVER_NAME)
}

/**
 * Resolve the {@link Engine} for a live agent turn: the one place Engine
 * selection and assembly happen (ADR 0006). On the in-process default it
 * returns that engine directly, so no sandbox lookup happens on the hosted
 * path. Under `AGENT_ENGINE=external` (the desktop build) it assembles the
 * external engine per request, since the engine spawns the Harness's ACP
 * adapter **in the Branch's worktree**, whose path is only known once the
 * turn's `sandboxName` is. Everything that differs between Harnesses (the
 * adapter's spawn argv, how it takes the model, whether it queues prompts) is
 * read off the Harness descriptor's `acpAdapter` by the
 * {@link SpawnAcpSessionFactory}, not decided here.
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
 * `:<modelId>` half refines *which model* that adapter runs, applied in-session
 * through the adapter's `set_config_option`. Any other id — a `provider:` model, or none — falls back
 * to {@link acpHarnessFromEnv} with no model. The id only ever selects the
 * adapter and refines its model, never the engine (ADR 0006): it can't flip a
 * deployment between in-process and external. A harness the user picked but
 * hasn't logged into isn't dropped here — it's spawned, and fails loud at turn
 * time with the CLI's own login prompt.
 */
export async function resolveLiveEngine(
  opts: {
    sandboxName?: string
    chatId?: string
    model?: string
    /** The turn's Room, which a Workspace chat's MCP token is bound to. */
    roomId?: string
    /** Nobody sent the turn: its MCP tools get no account memory (#1515). */
    senderless?: boolean
  } = {}
): Promise<Engine> {
  if (engineChoiceFromEnv() !== "external") {
    // In-process default: self-contained, no transport to wire.
    return inProcessEngine
  }

  // The agent runs in the Branch's worktree — the same absolute path the
  // terminal transport and tools resolve (`SandboxInstance.worktreePath`). The
  // Coordinator runs in an app-owned folder with its tools served over MCP.
  // A Sketch Chat (no sandbox) shares its Room's folder, with its own tools.
  const folderSession =
    (await coordinatorSession(opts)) ?? (await sketchSession(opts))
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

  const sessionFactory = new SpawnAcpSessionFactory({ harnessKey })
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

  return new ExternalEngine({
    sessionFactory,
    cwd,
    loadSessionId,
    onSessionId,
    modelId,
    reconcileModel,
    mcpServers: mcp?.mcpServers,
    sessionMeta: mcp?.sessionMeta,
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
async function coordinatorSession(opts: {
  chatId?: string
  senderless?: boolean
}): Promise<
  | (Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> & {
      cwd: string
    })
  | null
> {
  const { chatId } = opts
  const roomId = chatId ? roomIdOfRoomChat(chatId) : null
  if (!roomId || !chatId || !isLocalBuild) return null
  return {
    cwd: await ensureCoordinatorFolder(roomId),
    mcpServers: [coordinatorMcpServer({ roomId, chatId, ...senderless(opts) })],
    sessionMeta: coordinatorSessionMeta(),
  }
}

/**
 * A Sketch Chat's harness session setup (`lib/chat/sketch-chat.ts`): any chat
 * with no sandbox that isn't the Coordinator. It runs in its Room's folder,
 * like the Coordinator, with its Document and Mockup tools served over MCP.
 */
async function sketchSession(opts: {
  sandboxName?: string
  chatId?: string
  roomId?: string
  senderless?: boolean
}): Promise<
  | (Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> & {
      cwd: string
    })
  | null
> {
  const { sandboxName, chatId, roomId } = opts
  if (sandboxName || !chatId || !roomId || !isLocalBuild) return null
  if (roomIdOfRoomChat(chatId)) return null
  return {
    cwd: await ensureCoordinatorFolder(roomId),
    mcpServers: [
      coordinatorMcpServer({
        roomId,
        chatId,
        sketch: true,
        ...senderless(opts),
      }),
    ],
    sessionMeta: coordinatorSessionMeta(),
  }
}

/**
 * A Workspace chat's harness session setup: its own dev server's tools (log
 * and Dev Server Restart, `dev-server-tools.ts`) and its Document tools
 * (#1314) as the same MCP server, bound to its Sandbox and chat. The
 * harness's shell runs in the worktree but never sees the dev server or the
 * canvas Screenplay supervises. Local build only, like the route.
 */
function workspaceSession(opts: {
  sandboxName?: string
  chatId?: string
  roomId?: string
  senderless?: boolean
}): Pick<ExternalEngineConfig, "mcpServers" | "sessionMeta"> | null {
  const { sandboxName, chatId, roomId } = opts
  if (!sandboxName || !chatId || !roomId || !isLocalBuild) return null
  return {
    mcpServers: [
      coordinatorMcpServer({
        roomId,
        chatId,
        sandboxName,
        ...senderless(opts),
      }),
    ],
    sessionMeta: coordinatorSessionMeta(),
  }
}

/** A token's `senderless` flag, set only when it is. */
function senderless(opts: { senderless?: boolean }): { senderless?: true } {
  return opts.senderless ? { senderless: true } : {}
}

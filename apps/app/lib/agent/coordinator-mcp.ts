import "server-only"

import { randomBytes } from "node:crypto"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { BASE_PATH } from "@/lib/base-path"
import type { McpServer } from "@/lib/agent/acp/schema"

/**
 * The Coordinator on a desktop harness (#903). A harness session (Claude,
 * Codex) runs outside the app, so the Coordinator tools module reaches it as an
 * MCP server: the sidecar serves it over Streamable HTTP at
 * {@link COORDINATOR_MCP_PATH} (local build only), and each Coordinator
 * session is handed that URL with a bearer token bound to its chat and Room.
 * Research: docs/research/canvas-coordinator-harness-mcp.md.
 */

/** The MCP server name. Short and space-free so every harness keeps it as is. */
export const COORDINATOR_MCP_SERVER_NAME = "screenplay"

/** Where the sidecar serves the Coordinator's MCP server. */
export const COORDINATOR_MCP_PATH = "/api/agent/mcp"

/**
 * Claude's allow rule for every tool on the server, so none of them raises a
 * permission request (Claude names MCP tools `mcp__<server>__<tool>`).
 */
export const COORDINATOR_ALLOWED_TOOLS = [
  `mcp__${COORDINATOR_MCP_SERVER_NAME}__*`,
]

/**
 * Which chat a token acts for. A Coordinator chat gets the Coordinator tools;
 * a Workspace chat (one with a `sandboxName`) gets the tools for its own dev
 * server, which a harness has no other way to see (`dev-server-tools.ts`); a
 * document chat (one with a `markdownLayerId`) gets its document chat tools.
 */
export interface CoordinatorBinding {
  roomId: string
  chatId: string
  /** The Workspace's Sandbox, for a Workspace chat. */
  sandboxName?: string
  /** The document, for a document chat. */
  markdownLayerId?: string
}

/**
 * Tokens live in memory for the sidecar's lifetime, on `globalThis` so the
 * stream route and the MCP route share one registry however Next bundles them.
 * One token per chat, reused across turns: the harness is re-spawned every
 * turn and gets the same server entry, and a sidecar restart mints fresh ones.
 */
const registry = ((
  globalThis as { __coordinatorMcpTokens?: CoordinatorTokens }
).__coordinatorMcpTokens ??= { byToken: new Map(), byChat: new Map() })

interface CoordinatorTokens {
  byToken: Map<string, CoordinatorBinding>
  byChat: Map<string, string>
}

/** The bearer token for a Coordinator chat, minted on first use. */
export function coordinatorToken(binding: CoordinatorBinding): string {
  const existing = registry.byChat.get(binding.chatId)
  const bound = existing ? registry.byToken.get(existing) : undefined
  if (
    existing &&
    bound?.roomId === binding.roomId &&
    bound.sandboxName === binding.sandboxName &&
    bound.markdownLayerId === binding.markdownLayerId
  ) {
    return existing
  }
  const token = randomBytes(32).toString("base64url")
  registry.byToken.set(token, { ...binding })
  registry.byChat.set(binding.chatId, token)
  return token
}

/** The Coordinator a request's `Authorization` header acts for, or null. */
export function resolveCoordinatorToken(
  authorization: string | null
): CoordinatorBinding | null {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i)
  if (!match) return null
  return registry.byToken.get(match[1]!) ?? null
}

/** The sidecar's own loopback origin (random port per launch). */
export function sidecarOrigin(
  env: Record<string, string | undefined> = process.env
): string {
  return `http://127.0.0.1:${env.PORT || "3000"}`
}

/**
 * The MCP server entry a Coordinator's (or a Workspace's) harness session gets
 * on both `session/new` and `session/load`. `http` is the one transport every adapter
 * takes (research §1).
 */
export function coordinatorMcpServer(binding: CoordinatorBinding): McpServer {
  return {
    type: "http",
    name: COORDINATOR_MCP_SERVER_NAME,
    url: `${sidecarOrigin()}${BASE_PATH}${COORDINATOR_MCP_PATH}`,
    headers: [
      {
        name: "Authorization",
        value: `Bearer ${coordinatorToken(binding)}`,
      },
    ],
  }
}

/** Claude adapter `_meta` that pre-allows the server's tools. */
export function coordinatorSessionMeta(): Record<string, unknown> {
  return {
    claudeCode: { options: { allowedTools: COORDINATOR_ALLOWED_TOOLS } },
  }
}

/**
 * Whether a request's `Origin` may reach the MCP route. MCP requires a
 * localhost server to check it against DNS rebinding. Harness adapters send
 * none; a browser page may only come from the sidecar's own origin.
 */
export function isAllowedMcpOrigin(
  origin: string | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (origin === null) return true
  const port = env.PORT || "3000"
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  )
}

/**
 * The working folder a Room's document chats share: app-owned and not a git
 * repo, like the Coordinator's, so a harness keys their sessions by a stable
 * folder and never mistakes one for a project.
 */
export async function ensureDocumentsFolder(
  roomId: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const safe = roomId.replace(/[^A-Za-z0-9_-]/g, "_")
  const folder = path.join(coordinatorRoot(env), "documents", safe)
  await mkdir(folder, { recursive: true })
  return folder
}

export const COORDINATOR_ROOT_ENV_VAR = "SCREENPLAY_COORDINATOR_ROOT"

/** The folder that holds every Room's Coordinator folder. */
export function coordinatorRoot(
  env: Record<string, string | undefined> = process.env
): string {
  return (
    env[COORDINATOR_ROOT_ENV_VAR]?.trim() ||
    path.join(os.homedir(), ".screenplay", "coordinator")
  )
}

/**
 * The Coordinator's working folder for a Room: stable, app-owned and not a git
 * repo, created before the harness is spawned in it. Harnesses key sessions by
 * folder, so `session/load` needs the same one every turn; the old fallback
 * was `/`, which Claude reads as a project and Codex doesn't trust.
 */
export async function ensureCoordinatorFolder(
  roomId: string,
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  // Room ids are generated, but never let one climb out of the root.
  const safe = roomId.replace(/[^A-Za-z0-9_-]/g, "_")
  const folder = path.join(coordinatorRoot(env), safe)
  await mkdir(folder, { recursive: true })
  return folder
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type SandboxStatus =
  | "creating"
  | "starting"
  | "running"
  | "error"
  | "stopped"

export type WorkspaceData = {
  id: string
  name: string
  repoFullName: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  cloneUrl: string
  setupScript: string
  devScript: string
  devServerPort: number
  envVars: string
  createdAt: number
}

export type AgentData = {
  id: string
  workspaceId: string
  sandboxName: string
  gitUrl: string
  branch: string
  previewDomain: string
  port: number
  status: SandboxStatus
  statusMessage?: string
  error?: string
  createdAt: number
  /** False when the branch was opened from an existing remote branch — skip auto-rename on first chat. */
  autoNamedBranch?: boolean
}

export type ChatSessionData = {
  id: string
  agentId: string
  sessionId?: string
  label: string
  createdAt: number
  isStreaming?: boolean
  closedAt?: number
  planMode?: boolean
  model?: string
}

export type PlanData = {
  id: string
  chatId: string
  agentId: string
  content: string
  status: "pending" | "approved" | "rejected"
  toolEventId: string
  sessionId: string
  feedback?: string
  createdAt: number
  resolvedAt?: number
}

export type ArtboardData = {
  id: string
  sandboxId: string
  x: number
  y: number
  width: number
  height: number
  label: string
  iframeState: JsonObject
  route?: string
  scrollX?: number
  scrollY?: number
}

export type TextLayerData = {
  id: string
  x: number
  y: number
  width: number
  autoWidth: boolean
}

export type ViewportData = {
  x: number
  y: number
  zoom: number
}

/**
 * Liveblocks "Storage" is no longer used — canvas state lives in the Y.Doc.
 * The interface stays declared so RoomProvider's `initialStorage` requirement
 * is satisfied with an empty object.
 */
export type Storage = Record<string, never>

/**
 * Liveblocks Presence/UserMeta/ThreadMetadata are no longer used — presence
 * lives in Yjs awareness, threads/comments live in Postgres. The interface is
 * declared with empty types so RoomProvider's required props are satisfied
 * with `{}` literals.
 */
export type Presence = Record<string, never>

declare global {
  interface Liveblocks {
    Storage: Storage
    Presence: Presence
  }
}

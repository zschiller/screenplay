import type { LiveMap, LiveObject } from "@liveblocks/client"

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
}

export type ViewportData = {
  x: number
  y: number
  zoom: number
}

export type Storage = {
  workspaces: LiveMap<string, LiveObject<WorkspaceData>>
  sandboxes: LiveMap<string, LiveObject<AgentData>>
  artboards: LiveMap<string, LiveObject<ArtboardData>>
  chatSessions: LiveMap<string, LiveObject<ChatSessionData>>
  plans: LiveMap<string, LiveObject<PlanData>>
  savedViewport?: LiveObject<ViewportData>
}

export type Presence = {
  cursor: { x: number; y: number } | null
  viewport: { x: number; y: number; zoom: number }
  name: string
  color: string
  selectedArtboardIds: string[]
}

export type UserMeta = {
  id: string
  info: {
    name: string
    avatar?: string
  }
}

declare global {
  interface Liveblocks {
    Storage: Storage
    Presence: Presence
    UserMeta: UserMeta
    ThreadMetadata: {
      x: number
      y: number
      artboardId?: string
    }
  }
}

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
  error?: string
  createdAt: number
  sessionId?: string
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

export type Storage = {
  workspaces: LiveMap<string, LiveObject<WorkspaceData>>
  sandboxes: LiveMap<string, LiveObject<AgentData>>
  artboards: LiveMap<string, LiveObject<ArtboardData>>
}

export type Presence = {
  cursor: { x: number; y: number } | null
  viewport: { x: number; y: number; zoom: number }
  name: string
  color: string
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
  }
}

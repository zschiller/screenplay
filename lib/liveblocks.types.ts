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

export type SandboxData = {
  id: string
  sandboxId: string
  gitUrl: string
  branch: string
  previewDomain: string
  port: number
  status: SandboxStatus
  error?: string
  createdAt: number
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
  sandboxes: LiveMap<string, LiveObject<SandboxData>>
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

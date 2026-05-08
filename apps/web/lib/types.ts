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
  /** Preset id from `lib/artboard-sizes`. Falls back to the default preset when unset. */
  defaultArtboardSizeId?: string
  /** Extra workspace-specific instructions appended to the agent's system prompt. */
  systemPrompt?: string
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
  /** Routes discovered for this sandbox — initially crawled at startup, appended as the user navigates. */
  discoveredRoutes?: { route: string; label: string }[]
  /** Set true by the parallel-create flow, which defers artboard seeding until `previewDomain` is known.
   *  The deferred-seed effect seeds once and clears the flag, so deleting the last frame never re-seeds. */
  pendingArtboardSeed?: boolean
}

/**
 * A chat session targets exactly one of:
 *  - an *agent* (the existing flow): edits files in the agent's sandbox,
 *    drives a branch, etc. — `agentId` is set.
 *  - a *document* layer: edits the document body / title via doc-mutation
 *    tools — `documentId` is set, `agentId` is undefined.
 *
 * Multiple chat tabs can target the same doc (or agent), so a user can
 * keep parallel conversations going against the same document.
 */
export type ChatSessionData = {
  id: string
  /** Set when the chat targets an agent. Mutually exclusive with `documentId`. */
  agentId?: string
  /** Set when the chat targets a document layer. */
  documentId?: string
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
  feedback?: string
  createdAt: number
  resolvedAt?: number
}

export type ArtboardData = {
  id: string
  /** Undefined for empty frames not yet associated with an agent. */
  sandboxId?: string
  width: number
  height: number
  label: string
  iframeState: JsonObject
  route?: string
  scrollX?: number
  scrollY?: number
  /** Knob declarations posted by the running prototype. Replaced wholesale on each declaration. */
  knobs?: JsonValue[]
  /** Current knob values keyed by knob id. Source of truth — synced down into the iframe. */
  knobValues?: JsonObject
  /**
   * Bidirectional shared state published by the prototype via
   * `@screenplay.space/state`. The canvas persists the merged map and pushes
   * it back down so other clients' iframes stay in sync. Read-only on the
   * canvas surface today (no editor UI).
   */
  sharedState?: JsonObject
}

/**
 * Tagged reference to a child of a group. Designed to be open-ended so new
 * layer kinds (images, embeds, etc.) can drop in without rewriting groups —
 * each new kind just adds its case here and registers a sizer in
 * `artboard-layout.ts`.
 */
export type GroupMemberKind = "artboard" | "document"
export type GroupMember = {
  kind: GroupMemberKind
  id: string
}

/**
 * Container for a row of frame-like layers (artboards, documents, …) laid
 * out via flex. Owns the world-space (x, y) origin; each child's position is
 * implicit from its index in `members` and the widths of preceding children
 * plus the row gap.
 *
 * `artboardIds` is legacy — pre-document data only had artboards. The
 * migration in `getRoomCollections` converts any group still carrying it
 * into a typed `members` list and clears the field, so all downstream code
 * can read `members` exclusively.
 */
export type ArtboardGroupData = {
  id: string
  /**
   * Stable display name set at creation time (e.g. "Group 3"). Sidebar
   * reordering must not renumber existing groups, so we persist the name
   * rather than deriving it from sort position.
   */
  name?: string
  x: number
  y: number
  /** Members in left-to-right order. Source of truth for layout + sidebar. */
  members: GroupMember[]
  /** @deprecated Legacy: artboard ids only. Migrated into `members` on read. */
  artboardIds?: string[]
  /** Display order in the sidebar Frames list. Lower values render first. */
  sidebarOrder?: number
  /** Horizontal gap between members in this group. Falls back to ARTBOARD_GROUP_GAP. */
  gap?: number
}

/**
 * A Notion-style document tile on the canvas. Lives inside an
 * `ArtboardGroup` exactly like artboards do — the group anchors world-space
 * `(x, y)`, and the doc carries only its own size + title. Body content
 * lives in a Yjs XmlFragment keyed by `doc-${id}` (owned by TipTap, same
 * shape as text layers' `text-${id}` fragments).
 */
export type DocumentLayerData = {
  id: string
  width: number
  height: number
  title: string
}

export type ViewportData = {
  x: number
  y: number
  zoom: number
}

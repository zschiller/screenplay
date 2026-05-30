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

export type RepoData = {
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
  /** Preset id from `lib/iframe-layer-sizes`. Falls back to the default preset when unset. */
  defaultIframeLayerSizeId?: string
  /** Extra repo-specific instructions appended to the agent's system prompt. */
  systemPrompt?: string
  createdAt: number
  /** Display order in the in-room sidebar's repo list. Lower values render
   *  first; unset falls back to alphabetical by `repoFullName`. */
  sidebarOrder?: number
}

export type AgentData = {
  id: string
  repoId: string
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
  /** Set true by the parallel-create flow, which defers iframe-layer seeding until `previewDomain` is known.
   *  The deferred-seed effect seeds once and clears the flag, so deleting the last frame never re-seeds. */
  pendingIframeLayerSeed?: boolean
  /** Manual override into `BRANCH_COLORS`. When unset, the badge color is hashed from `id`. */
  colorIndex?: number
  /** Display order within its Repo's branch list in the in-room sidebar.
   *  Lower values render first; unset falls back to `createdAt` (oldest-first). */
  sidebarOrder?: number
}

/**
 * A chat session targets exactly one of:
 *  - an *agent* (the existing flow): edits files in the agent's sandbox,
 *    drives a branch, etc. — `agentId` is set.
 *  - a *markdown layer*: edits the layer's body / title via doc-mutation
 *    tools — `markdownLayerId` is set.
 *
 * Multiple chat tabs can target the same layer (or agent), so a user can
 * keep parallel conversations going against the same target.
 */
export type ChatSessionData = {
  id: string
  /** Set when the chat targets an agent. Mutually exclusive with the layer ids. */
  agentId?: string
  /** Set when the chat targets a markdown layer. */
  markdownLayerId?: string
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

export type IframeLayerData = {
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
 * `iframe-layer-layout.ts`.
 */
export type GroupMemberKind = "iframe-layer" | "markdown-layer"
export type GroupMember = {
  kind: GroupMemberKind
  id: string
}

/**
 * Container for a row of frame-like layers (iframe layers, markdown layers,
 * …) laid out via flex. Owns the world-space (x, y) origin; each child's
 * position is implicit from its index in `members` and the widths of
 * preceding children plus the row gap.
 *
 * `iframeLayerIds` is legacy — pre-markdown-layer data only had iframe
 * layers. The migration in `getRoomCollections` converts any group still
 * carrying it into a typed `members` list and clears the field, so all
 * downstream code can read `members` exclusively.
 */
export type IframeLayerGroupData = {
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
  /** @deprecated Legacy: iframe-layer ids only. Migrated into `members` on read. */
  iframeLayerIds?: string[]
  /** Display order in the sidebar Frames list. Lower values render first. */
  sidebarOrder?: number
  /** Horizontal gap between members in this group. Falls back to IFRAME_LAYER_GROUP_GAP. */
  gap?: number
}

/**
 * A Notion-style markdown tile on the canvas. Lives inside an
 * `IframeLayerGroup` exactly like iframe layers do — the group anchors
 * world-space `(x, y)`, and the layer carries only its own size + title.
 * Body content lives in a Yjs XmlFragment keyed by `markdown-layer-${id}`
 * (owned by TipTap, same shape as text layers' `text-${id}` fragments).
 */
export type MarkdownLayerData = {
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

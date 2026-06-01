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

export type BranchData = {
  id: string
  repoId: string
  sandboxName: string
  gitUrl: string
  /** The git ref (branch name) this Branch maps to. */
  ref: string
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
 * Which kind of tab the "+" new-tab control creates. Purely a UI-level
 * selection — it is *not* a discriminant stored on any tab. The two kinds are
 * distinct domain types: a chat tab is a {@link ChatSessionData}, a terminal
 * tab is a {@link TerminalTabData}.
 */
export type TabKind = "chat" | "terminal"

/**
 * A chat tab: the durable Engine conversation. Targets exactly one of a
 * *Branch* (`branchId` set) or a *markdown layer* (`markdownLayerId` set), and
 * its scrollback is persisted + shared. Multiple chats can target the same
 * Branch (or layer), so a user can keep parallel conversations going.
 *
 * Chat sessions live in the shared `chatSessions` Y.Doc collection. Terminal
 * tabs are deliberately *not* `ChatSessionData` (see {@link TerminalTabData}),
 * so a terminal can never — by type — enter chat history, the Postgres
 * conversation tables, or the conversation Y.Doc.
 */
export type ChatSessionData = {
  id: string
  /** Set when the chat targets a Branch. Mutually exclusive with the layer ids. */
  branchId?: string
  /** Set when the chat targets a markdown layer. */
  markdownLayerId?: string
  label: string
  createdAt: number
  isStreaming?: boolean
  closedAt?: number
  planMode?: boolean
  model?: string
}

/**
 * A terminal tab: a BYO-harness in-sandbox web terminal (#187). Runs against a
 * Branch's sandbox (`branchId`) but is **not** a Chat Session — its scrollback
 * never enters the chat-store, Postgres, or the Y.Doc conversation model. This
 * is guaranteed *structurally*: terminal tabs are their own type held in a
 * client-local collection, never in `chatSessions`.
 *
 * `terminalSessionId` is the shared live-view identity collaborators co-view
 * against (today it equals the tab's own `id`).
 */
export type TerminalTabData = {
  id: string
  /** The Branch whose sandbox this terminal runs against. */
  branchId: string
  /** Shared live-view identity — the key collaborators co-view one PTY against. */
  terminalSessionId: string
  label: string
  createdAt: number
}

export type PlanData = {
  id: string
  chatId: string
  branchId: string
  content: string
  status: "pending" | "approved" | "rejected"
  toolEventId: string
  feedback?: string
  createdAt: number
  resolvedAt?: number
}

export type IframeLayerData = {
  id: string
  /** Id of the Branch this frame is bound to. Undefined for empty frames not yet associated with a Branch. */
  branchId?: string
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
 * `lib/canvas/layout.ts`.
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

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type SandboxStatus =
  "creating" | "starting" | "running" | "error" | "stopped"

export type RepoData = {
  id: string
  name: string
  repoFullName: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  cloneUrl: string
  /**
   * The Repo's acquisition source when it was added from a folder already on
   * disk (PRD #428, local build only): the absolute path of the user's
   * existing clone. When set, provisioning roots the worktree manager there
   * instead of cloning `cloneUrl` (which may then be empty — a clone-less
   * local repo is fully supported through host git auth).
   */
  localPath?: string
  setupScript: string
  devScript: string
  devServerPort: number
  /**
   * The names of the Repo's env vars (#1416), so settings can show which are
   * set. The values never live in the room doc: they're encrypted on the
   * server per Canvas + Repo (`lib/repo-env`), and provisioning reads them
   * there. Absent = none.
   */
  envVarNames?: string[]
  /**
   * A keyed digest of the values (`envVarsDigest` in `lib/repo-env/store`),
   * so "customized" can compare them with the Repository's without anyone
   * seeing them. Absent = none.
   */
  envVarsDigest?: string
  /**
   * @deprecated Plain-text values from before #1416. Only the one-time
   * migration (`lib/repo-env/migrate`) reads it, and it deletes it.
   */
  envVars?: string
  /**
   * Glob patterns (one per line, e.g. `.env*`) of files copied from the
   * Repo's original checkout into each Branch's worktree at provision time —
   * the desktop-mode way to carry gitignored config (env files above all)
   * into a workspace instead of spelling env vars out by hand. Only
   * meaningful for a `localPath` Repo on the local build.
   */
  copyPatterns?: string
  /** Preset id from `lib/iframe-layer-sizes`. Falls back to the default preset when unset. */
  defaultIframeLayerSizeId?: string
  /** Extra repo-specific instructions appended to the agent's system prompt. */
  systemPrompt?: string
  createdAt: number
  /** Display order in the in-room sidebar's repo list. Lower values render
   *  first; unset falls back to alphabetical by `repoFullName`. */
  sidebarOrder?: number
  /**
   * The id of the Repository (a person's saved `RepoConfig`) this Repo was
   * switched on from (#1420). Absent = unlinked: added before the repository
   * library, or its Repository was deleted. Written only by
   * `lib/repository-library`.
   */
  repositoryId?: string
  /** The user id of whoever switched this Repo on, so the Canvas can show
   *  whose settings these are. Absent on Repos added before #1420. */
  addedBy?: string
}

export type BranchData = {
  id: string
  repoId: string
  sandboxName: string
  gitUrl: string
  /** The git ref (branch name) this Branch maps to. */
  ref: string
  /**
   * The Workspace's display name (#881), written by the first chat's naming
   * call and changed by inline rename. Absent on Workspaces created before
   * titles, which show `ref` instead — read it through `workspaceLabel`.
   */
  title?: string
  previewDomain: string
  port: number
  status: SandboxStatus
  statusMessage?: string
  error?: string
  createdAt: number
  /**
   * When a member marked the Workspace Done (#976). A Done Workspace's sandbox
   * is stopped, its frames are hidden from the Canvas and its sidebar row sits
   * in the collapsed Done section; its chats stay. Reopen clears it. Merging a
   * PR never sets it.
   */
  doneAt?: number
  /**
   * When someone stopped the Workspace's dev server (#1342), from the Terminal
   * Pane or the chat's `stop_dev_server`. Its Sandbox keeps running; a stopped
   * dev server isn't relaunched by a reconnect until someone runs it again
   * (Run, Restart, or `start_dev_server`), which clears this. Shared through
   * the doc, so every member sees the same state.
   */
  devServerStoppedAt?: number
  /**
   * When someone last ran or restarted the dev server (#1342). The Terminal
   * Pane's dot gives a fresh launch a grace period before a preview that
   * isn't answering yet reads as crashed.
   */
  devServerLaunchedAt?: number
  /**
   * When a chat turn last started on the Workspace, stamped by Turn Launch.
   * The sidebar's Recent activity sort reads it (#885); absent until the
   * first turn, when `createdAt` stands in.
   */
  lastActivityAt?: number
  /**
   * How the Workspace was created, and the branch a duplicate forked from. The
   * sidebar's Retry re-runs a failed create with these (#791).
   */
  createFlow?: "new" | "from-branch" | "duplicate-branch"
  createSourceBranch?: string
  /**
   * The member who created the Workspace (#898): whoever asked for its create,
   * or for one the Coordinator created, the member whose message asked for it.
   * Absent on Workspaces created before owners were recorded.
   */
  createdBy?: string
  /**
   * A seed message waiting for the sandbox to run (#898): a Workspace the
   * Coordinator created gets its first turn once provisioning finishes, on the
   * first attempt or a Retry. Cleared when the turn is sent.
   */
  pendingSeed?: {
    chatId: string
    message: string
    /** The Coordinator chat that asked for the Workspace. */
    coordinatorChatId: string
  }
  /** False when the branch was opened from an existing remote branch — skip auto-rename on first chat. */
  autoNamedBranch?: boolean
  /** Routes discovered for this sandbox — initially crawled at startup, appended as the user navigates. */
  discoveredRoutes?: { route: string; label: string }[]
  /** Set true by the parallel-create flow, which defers iframe-layer seeding until `previewDomain` is known.
   *  The deferred-seed effect seeds once and clears the flag, so deleting the last frame never re-seeds. */
  pendingIframeLayerSeed?: boolean
  /** Legacy: the Workspace's picked colour. Workspaces have no colour since
   *  #975; older rooms still carry it, and nothing writes or reads it. */
  colorIndex?: number
  /** Display order within its Repo's branch list in the in-room sidebar.
   *  Lower values render first; unset falls back to `createdAt` (oldest-first). */
  sidebarOrder?: number
  /**
   * Cached GitHub PR for `ref`, refreshed by the branch-git poll and shared
   * through the doc so every client — and a cold page load — renders PR state
   * instantly instead of waiting on a per-client GitHub round-trip. Mirrors
   * `BranchPrInfo` in `lib/github-actions`. Absent until the first refresh (or
   * an optimistic write on PR creation) lands. */
  prNumber?: number
  prUrl?: string
  prState?: "open" | "closed" | "merged"
  /** True when an open PR can't merge (failing checks, a conflict, or a
   *  missing required review or check). Absent otherwise. */
  prBlocked?: boolean
  /**
   * Cached diff stats (additions/deletions vs the Repo's default branch, from
   * the GitHub compare API), refreshed by the same poll. Same rationale as the
   * PR cache above — read straight from the doc, no client round-trip. */
  diffAdditions?: number
  diffDeletions?: number
}

/**
 * A chat tab: the durable Engine conversation. Targets exactly one of a
 * *Branch* (`branchId` set) or the whole *Room* (`target: "room"`), and its
 * scrollback is persisted + shared. A Branch has exactly one chat, the only one
 * that changes its code (#1315, `lib/chat/workspace-chat.ts`); more parallel
 * work means more Branches. A Branch from before then may hold several: the
 * newest is its chat, the rest are read-only **earlier chats**. A Room has
 * exactly one Room Target chat (see `lib/chat/room-chat.ts`). Documents are no longer a chat's
 * target (#1314): a chat writes the Documents it owns
 * ({@link MarkdownLayerData.ownerChatId}). Chats saved against a Document
 * before then have neither field and are listed nowhere.
 *
 * Chat sessions live in the shared `chatSessions` Y.Doc collection. Terminal
 * tabs are deliberately *not* `ChatSessionData` (see {@link TerminalTabData}),
 * so a terminal can never — by type — enter chat history, the Postgres
 * conversation tables, or the conversation Y.Doc.
 */
export type ChatSessionData = {
  id: string
  /** Set when the chat targets a Branch. */
  branchId?: string
  /**
   * `"room"` when the chat targets the whole Room (the Coordinator);
   * `"sketch"` for a chat with no repository (a Sketch Chat), which has no
   * Branch or sandbox and makes only Documents and Mockups.
   */
  target?: "room" | "sketch"
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
  /** The harness this tab launches into (`Harness.key`, e.g. "claude-code"),
   *  resolved server-side → the launch argv at connect time. Only on tabs
   *  saved while terminals could launch a harness (#285 to #1343); new tabs
   *  omit it and open a plain shell. */
  harnessKey?: string
  label: string
  createdAt: number
}

/**
 * One memory entry: a preference, decision or fact chats read in their system
 * prompt. **Canvas memory** (#902) lives in the Room's Y.Doc and every chat on
 * the canvas reads it; **account memory** (#1513) is stored per person and
 * every chat they send a turn in reads it (`lib/memory`).
 */
export type MemoryData = {
  id: string
  text: string
  /**
   * Who saved it: an agent, or a person in settings. Entries saved before
   * #1513 say `coordinator`; read them through `memorySource`, as `agent`.
   */
  source: "agent" | "member" | "coordinator"
  createdAt: number
  updatedAt: number
}

/**
 * One entry of **Canvas Files** (#1514): a file or folder agents saved for
 * the canvas's members, never shown on the canvas. The entry is metadata
 * only; a file's bytes live in the private file store under `blobKey`
 * (`lib/files`). Folders are explicit entries, so an agent can make an empty
 * one.
 */
export type FileEntryData = {
  id: string
  /** Folders joined by `/`, with no leading or trailing slash. */
  path: string
  kind: "file" | "folder"
  /** Bytes; 0 for a folder. */
  size: number
  /** The file's media type; "" for a folder. */
  mediaType: string
  /** Who added it: an agent chat, or a member. */
  addedBy: "agent" | "member"
  /** The chat (for an agent) or user (for a member) that added it. */
  addedById: string
  /** Where its bytes live in the file store; "" for a folder. */
  blobKey: string
  createdAt: number
  updatedAt: number
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
   * The colour scheme a shared frame's browser renders in, set from its
   * Theme knob. Absent is light. A local frame follows the viewer's own.
   */
  colorScheme?: "light" | "dark"
  /**
   * Bidirectional shared state published by the prototype via
   * `@screenplay.space/state`. The canvas persists the merged map and pushes
   * it back down so other clients' iframes stay in sync. Read-only on the
   * canvas surface today (no editor UI).
   */
  sharedState?: JsonObject
  /**
   * Someone turned the frame live (#1516): it's one browser in its
   * Workspace's Sandbox, streamed to everyone on the canvas, instead of each
   * viewer's own iframe. Hosted only. Absent is not live.
   */
  live?: boolean
}

/**
 * Tagged reference to a child of a group. Designed to be open-ended so new
 * layer kinds (images, embeds, etc.) can drop in without rewriting groups —
 * each new kind just adds its case here and registers a sizer in
 * `lib/canvas/layout.ts`.
 */
export type GroupMemberKind = "iframe-layer" | "markdown-layer" | "mockup-layer"
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
  /**
   * The Workspace (Branch) this Group shows, issue #868. Each frame still
   * stores its own `branchId`, which stays the source of truth for what it
   * renders; a frame whose Branch differs from this is an *exception*. Unset on
   * Groups of Documents only. Read it through `groupBranchId`, which falls back
   * to the leftmost frame's for Groups that predate it.
   */
  branchId?: string
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
  /**
   * The chat that made this Document (#1314), which alone edits it with its
   * tools and gets its Send to agent and Reply in chat. Unset for a Document
   * a person made by hand, or one the Coordinator made.
   */
  ownerChatId?: string
}

/**
 * A static HTML page a chat wrote, shown on the canvas without a Sandbox
 * (issue #1309). Lives in a Group like the other layers. The page itself is a
 * `Y.Text` keyed `mockup-layer-${id}` (resolved through `mockupHtml`), so it
 * syncs like a document body; the record carries size, title and owner.
 */
export type MockupLayerData = {
  id: string
  width: number
  height: number
  title: string
  /**
   * The chat that made the mockup (#1309), which alone updates it with its
   * tools, and whose Workspace its label names, as a Document's owner does.
   * Once that chat is gone the mockup stays and names none.
   */
  ownerChatId?: string
  /**
   * Where this take stands (#1310), set by anyone on the canvas or by its
   * owning chat. Nothing else reads it: the chat decides what it means. Unset
   * on a mockup made before statuses, which reads as `current`.
   */
  status?: MockupStatus
  /** Knob declarations the page posted, replaced wholesale on each, as a frame's are. */
  knobs?: JsonValue[]
  /** Current knob values keyed by knob id, synced down into the page. */
  knobValues?: JsonObject
  /** State the page shares through `screenplay.shareState`, kept and synced
   *  to every viewer like a frame's `sharedState`. */
  sharedState?: JsonObject
}

/** A Mockup's status (#1310), in menu order. */
export const MOCKUP_STATUSES = ["set-aside", "current", "built"] as const
export type MockupStatus = (typeof MOCKUP_STATUSES)[number]

export type ViewportData = {
  x: number
  y: number
  zoom: number
}

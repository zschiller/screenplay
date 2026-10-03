import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { LOCAL_USER_ID } from "@/lib/local-user"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { COLD_WORKSPACE_PREFIX, previewDomainFor } from "../lib/preview-url"
import {
  EMPTY_CART_ILLUSTRATED,
  EMPTY_CART_SUGGESTIONS,
  ORDER_RECEIPT,
} from "./mockups"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  MockupLayerData,
  MemoryData,
  PlanData,
  RepoData,
  ViewportData,
} from "@/lib/types"

/**
 * The **Fixture World** — the one declarative description of everything the
 * screenshot harness seeds (issue #716). Data only: no database, no Yjs, no
 * filesystem. `./seed.ts` is the single writer that turns it into PGlite rows,
 * `.ydoc` files, and blobs.
 *
 * Splitting it this way is what makes the world reviewable. A design-polish
 * ticket usually needs *one more state* on screen — a Workspace stuck
 * `starting`, a Folder nested three deep, a Canvas with nothing on it — and that
 * should be a few lines added to a literal here, not a new code path in a
 * seeder.
 *
 * **Every id is a stable literal, never generated.** A capture set is only
 * diffable against another branch's if the URLs are the same on both sides, and
 * `/[roomId]` puts a Room id in the URL. `nanoid()` here would make
 * the screen list's paths unwritable and every before/after pair mismatched.
 *
 * **Every timestamp is relative to one pinned instant** ({@link WORLD_NOW}) for
 * the same reason: "2 days ago" has to read the same in both halves of a
 * before/after pair, and an absolute date would age out of the copy it feeds.
 */

/** Milliseconds in a day — the unit the fixture ages everything in. */
const DAY = 24 * 60 * 60 * 1000

/**
 * The instant the world is anchored to. Deliberately **not** `Date.now()`: it is
 * resolved once per seed run and every fixture timestamp is derived from it, so
 * one run's relative copy ("3 days ago") is identical to the next's. Exposed as
 * a function rather than a constant so a seed run can't pick up a stale value
 * from module-load order.
 */
export function worldNow(): number {
  return Date.now()
}

/** `days` days before the world's anchor instant. */
function daysAgo(now: number, days: number): number {
  return now - days * DAY
}

/** `minutes` minutes before the world's anchor instant. */
function minutesAgo(now: number, minutes: number): number {
  return now - minutes * 60 * 1000
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A Folder in the local user's private tree. */
export interface FixtureFolder {
  id: string
  name: string
  /** Parent Folder id, or `null` for a top-level Folder under "All files". */
  parentFolderId: string | null
  createdAt: number
}

/**
 * One Canvas: its `room` row, the Folder it is filed into, and the Y.Doc
 * contents the canvas surface reads. Everything except `id`/`name` is optional
 * so an empty Canvas is genuinely a two-field entry.
 */
export interface FixtureRoom {
  id: string
  name: string
  createdAt: number
  lastOpenedAt?: number
  /** Folder this Room is filed into; omitted means the user's "All files" root. */
  folderId?: string
  /** Y.Doc contents. Omitted collections are simply absent from the doc. */
  doc?: {
    repos?: RepoData[]
    branches?: BranchData[]
    iframeLayers?: IframeLayerData[]
    iframeLayerGroups?: IframeLayerGroupData[]
    markdownLayers?: MarkdownLayerData[]
    mockupLayers?: MockupLayerData[]
    chatSessions?: ChatSessionData[]
    plans?: PlanData[]
    /** Canvas memory entries (#902), shown in Canvas settings › Memory. */
    memories?: MemoryData[]
    savedViewport?: ViewportData
    /** Markdown body per Markdown Layer id, written into its `markdown-layer-{id}` fragment. */
    markdownBodies?: Record<string, string>
    /** HTML page per Mockup Layer id, written into its `mockup-layer-{id}` text. */
    mockupHtml?: Record<string, string>
  }
  /**
   * Frames to fake a Thumbnail Manifest for, so the home grid composes a real
   * card instead of an empty placeholder. Each entry names an Iframe Layer of
   * this Room; the seeder renders a synthetic capture for it (see
   * `./frame-captures.ts`) and derives the rects from the Room's own groups, so
   * the manifest can never drift from the canvas it claims to depict.
   */
  thumbnailFrames?: string[]
}

/** A persisted terminal tab (`terminal_tab` row) restored into a Canvas. */
export interface FixtureTerminalTab {
  id: string
  roomId: string
  /** The Branch id whose sandbox the terminal runs against. */
  branch: string
  label: string
  harnessKey?: string
  createdAt: number
}

/** An agent chat's durable log: the `agent_chat` row plus its `agent_message`s. */
export interface FixtureChat {
  id: string
  roomId: string
  sandboxName: string
  model: string
  systemPrompt: string
  createdAt: number
  messages: Array<{ id: string; record: AcpMessageRecord; createdAt: number }>
  /**
   * A run paused on a plan awaiting approval. The plan card is **not** rebuilt
   * from the message log — `/api/agent/history` merges it in from the
   * `agent_pending_tool_call` row — so a fixture that wants the plan-review
   * state has to seed the run and the pending call, not just the narration.
   */
  pendingPlan?: {
    runId: string
    /** The tool-call id, which is also the pending row's primary key and the
     *  `planId` the client approves/rejects against. */
    toolCallId: string
    plan: string
    createdAt: number
    /** Defaults to `pending`. A resolved plan renders its approved/rejected
     *  card in the transcript, and its run is seeded as finished. */
    status?: "pending" | "approved" | "rejected"
  }
}

/** A sidebar Pin. Exactly one of `roomId`/`folderId` is set. */
export interface FixturePin {
  id: string
  roomId?: string
  folderId?: string
  position: number
}

export interface FixtureWorld {
  /** The instant every timestamp below was derived from. */
  now: number
  userId: string
  folders: FixtureFolder[]
  rooms: FixtureRoom[]
  terminalTabs: FixtureTerminalTab[]
  chats: FixtureChat[]
  pins: FixturePin[]
  /** Saved Project presets, encrypted into `kv_store` by the seeder. */
  repoConfigs: RepoConfig[]
  /** The hosted build's half, seeded only by a `--hosted` run (#789). */
  hosted: FixtureHostedWorld
}

/**
 * What only the hosted build has: people, and the comment threads between
 * them. The local build has no tables for either.
 */
export interface FixtureHostedWorld {
  /** The name the fixture user signs in with (the local build's is fixed). */
  userName: string
  /** Other members of every Canvas, for comment authors. */
  collaborators: { id: string; name: string; email: string }[]
  threads: FixtureThread[]
}

/**
 * A comment thread, stored as the app would have written it. `branch` writes a
 * thread the way the retired play-mode feed did, so every hosted capture shows
 * the move onto the one comment model (#789).
 */
export interface FixtureThread {
  id: string
  roomId: string
  iframeLayerId?: string
  workspaceId?: string
  route?: string
  anchor?: { path: string; tag: string; text?: string }
  offsetX?: number
  offsetY?: number
  viewportWidth?: number
  viewportHeight?: number
  branch?: string
  comments: { id: string; authorId: string; body: string; createdAt: number }[]
}

// ---------------------------------------------------------------------------
// Stable ids
// ---------------------------------------------------------------------------

/**
 * Every id the world uses, in one place, so `screens/` and
 * `interactions.ts` can build URLs against the same literals the seeder wrote.
 * Named for what they are on screen (a Canvas, a Project, a Workspace), not for
 * their storage shape.
 */
export const FIXTURE_IDS = {
  folders: {
    marketing: "fld-marketing",
    designSystem: "fld-design-system",
    archive: "fld-archive",
    /** Archive → 2025 → Drafts: deep enough that the breadcrumb collapses its
     *  middle ancestors behind the overflow menu. */
    archive2025: "fld-archive-2025",
    drafts: "fld-drafts",
  },
  rooms: {
    /** The rich Canvas: a Project with Workspaces in every status, frames, a doc, a chat. */
    checkout: "room-checkout-flow",
    /** Frames only, mobile + desktop side by side. */
    pricing: "room-pricing-page",
    /** Document Layers only — no sandbox in sight. */
    tokens: "room-design-tokens",
    /** A small two-frame Canvas at the "All files" root. */
    onboarding: "room-onboarding",
    /** Deliberately empty: the Canvas empty state. */
    empty: "room-empty-canvas",
    /** One frame per Workspace stage: booting, starting, failed, stopped, unassigned, ready. */
    frameStates: "room-frame-states",
    /** Filed deep (Design system → Archive), to exercise breadcrumbs. */
    archived: "room-old-experiment",
  },
  /**
   * A Canvas id the world deliberately never seeds, for the Canvas not-found
   * page. `world.test.ts` holds it to staying missing.
   */
  missingRoom: "room-that-does-not-exist",
  repos: {
    storefront: "repo-storefront",
  },
  branches: {
    /** `running`, has an open PR and diff stats. */
    checkoutPolish: "branch-checkout-polish",
    /** `running`, no PR yet — the plain happy path. */
    emptyCart: "branch-empty-cart",
    /** `starting` — mid-provision, with a status message. */
    applePay: "branch-apple-pay",
    /** `error` — a failed setup script. */
    giftCards: "branch-gift-cards",
    /** Frame states Canvas: `creating`, behind a cold preview. */
    framesBooting: "branch-frames-booting",
    /** Frame states Canvas: `starting`, behind a cold preview. */
    framesStarting: "branch-frames-starting",
    /** Frame states Canvas: `error`, behind a cold preview. */
    framesFailed: "branch-frames-failed",
    /** Frame states Canvas: `stopped`, behind a cold preview. */
    framesStopped: "branch-frames-stopped",
    /** Frame states Canvas: `running`, serving a page. */
    framesReady: "branch-frames-ready",
    /** Frame states Canvas: the one the boot recording walks from `creating` to `running`. */
    framesLive: "branch-frames-live",
    /** Frame states Canvas: `running`, its dev server stopped by a member (#1342). */
    framesServerStopped: "branch-frames-server-stopped",
    /** Frame states Canvas: `running`, its dev server crashed: the preview never answers (#1342). */
    framesServerCrashed: "branch-frames-server-crashed",
  },
  chats: {
    checkoutPolish: "chat-checkout-polish",
    /** A markdown-heavy reply: tables, task lists, inline and block code. */
    markdown: "chat-markdown-reply",
    /** No messages yet, on the same Workspace. */
    fresh: "chat-checkout-fresh",
    /** Closed chats: what the chat history lists. */
    stickySummary: "chat-sticky-summary",
    shippingCopy: "chat-shipping-copy",
    closedEmpty: "chat-closed-empty",
  },
} as const

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export interface BuildWorldOptions {
  /** The instant every timestamp is derived from. Defaults to now. */
  now?: number
  /**
   * Origin of the fixture preview server every Workspace's `previewDomain`
   * points at (`lib/preview-server.ts`). Without it, frames sit on "Waiting for
   * dev server…" forever — there is no real dev server in a fixture world.
   */
  previewOrigin: string
}

/** The hosted world's second member, Priya Shah. */
export const COLLABORATOR_ID = "user-priya"

/**
 * The Checkout canvas's threads, all on the Mobile checkout Workspace so the
 * player shows them together: two on frames at `/checkout`, one made in the
 * player on `/cart`, and two from the old play-mode feed (one whose branch was
 * since renamed away).
 */
function hostedWorld(now: number): FixtureHostedWorld {
  const room = FIXTURE_IDS.rooms.checkout
  const workspace = FIXTURE_IDS.branches.checkoutPolish
  return {
    userName: "Jordan Lee",
    collaborators: [
      { id: COLLABORATOR_ID, name: "Priya Shah", email: "priya@example.com" },
    ],
    threads: [
      {
        id: "thread-summary-sticky",
        roomId: room,
        iframeLayerId: "layer-checkout-desktop",
        workspaceId: workspace,
        route: "/checkout",
        anchor: { path: "main > section.cols > aside", tag: "aside" },
        offsetX: 0.5,
        offsetY: 0.45,
        viewportWidth: 1280,
        viewportHeight: 800,
        comments: [
          {
            id: "comment-summary-1",
            authorId: COLLABORATOR_ID,
            body: "Summary should stick to the bottom under 768px.",
            createdAt: minutesAgo(now, 42),
          },
          {
            id: "comment-summary-2",
            authorId: LOCAL_USER_ID,
            body: "Agreed. I'll ask the agent to pin it with position: sticky.",
            createdAt: minutesAgo(now, 18),
          },
        ],
      },
      {
        id: "thread-hero-copy",
        roomId: room,
        iframeLayerId: "layer-checkout-desktop",
        workspaceId: workspace,
        route: "/checkout",
        anchor: { path: "main > section.hero > h1", tag: "h1" },
        offsetX: 1,
        offsetY: 0.1,
        viewportWidth: 1280,
        viewportHeight: 800,
        comments: [
          {
            id: "comment-hero-1",
            authorId: LOCAL_USER_ID,
            body: "Can the title say how many items are in the order?",
            createdAt: minutesAgo(now, 30),
          },
        ],
      },
      {
        id: "thread-cart-empty",
        roomId: room,
        workspaceId: workspace,
        route: "/cart",
        anchor: { path: "main > section.cols > div.card", tag: "div" },
        offsetX: 0.5,
        offsetY: 0.2,
        viewportWidth: 1512,
        viewportHeight: 982,
        comments: [
          {
            id: "comment-cart-1",
            authorId: COLLABORATOR_ID,
            body: "The empty cart needs a way back to the shop.",
            createdAt: minutesAgo(now, 12),
          },
        ],
      },
      {
        id: "thread-feed-note",
        roomId: room,
        branch: "checkout-polish",
        comments: [
          {
            id: "comment-feed-1",
            authorId: COLLABORATOR_ID,
            body: "Played through the whole flow on a phone. Feels fast.",
            createdAt: daysAgo(now, 1),
          },
        ],
      },
      {
        id: "thread-feed-orphan",
        roomId: room,
        branch: "checkout-v1",
        comments: [
          {
            id: "comment-orphan-1",
            authorId: LOCAL_USER_ID,
            body: "Promo field is hidden behind a link, which reads well.",
            createdAt: daysAgo(now, 2),
          },
        ],
      },
    ],
  }
}

/**
 * Build the Fixture World. A function, not a constant, so the timestamps are
 * derived from one instant captured at seed time rather than at module load.
 */
export function buildFixtureWorld(options: BuildWorldOptions): FixtureWorld {
  const { previewOrigin } = options
  const now = options.now ?? worldNow()
  const ids = FIXTURE_IDS

  return {
    now,
    userId: LOCAL_USER_ID,
    folders: [
      {
        id: ids.folders.marketing,
        name: "Marketing site",
        parentFolderId: null,
        createdAt: daysAgo(now, 40),
      },
      {
        id: ids.folders.designSystem,
        name: "Design system",
        parentFolderId: null,
        createdAt: daysAgo(now, 32),
      },
      {
        id: ids.folders.archive,
        name: "Archive",
        parentFolderId: ids.folders.designSystem,
        createdAt: daysAgo(now, 20),
      },
      {
        id: ids.folders.archive2025,
        name: "2025",
        parentFolderId: ids.folders.archive,
        createdAt: daysAgo(now, 18),
      },
      {
        id: ids.folders.drafts,
        name: "Drafts",
        parentFolderId: ids.folders.archive2025,
        createdAt: daysAgo(now, 16),
      },
    ],
    rooms: [
      checkoutRoom(now, previewOrigin),
      pricingRoom(now, previewOrigin),
      tokensRoom(now),
      onboardingRoom(now, previewOrigin),
      frameStatesRoom(now, previewOrigin),
      {
        // The Canvas empty state — no Project, no Layers, nothing in the doc.
        // Two fields is the whole entry, which is the point.
        id: ids.rooms.empty,
        name: "Empty canvas",
        createdAt: minutesAgo(now, 6),
        lastOpenedAt: minutesAgo(now, 6),
      },
      {
        id: ids.rooms.archived,
        name: "Old experiment",
        createdAt: daysAgo(now, 26),
        lastOpenedAt: daysAgo(now, 19),
        folderId: ids.folders.archive,
      },
    ],
    terminalTabs: [
      {
        id: "term-checkout-claude",
        roomId: ids.rooms.checkout,
        branch: ids.branches.checkoutPolish,
        label: "claude",
        harnessKey: "claude-code",
        createdAt: minutesAgo(now, 24),
      },
      {
        id: "term-checkout-shell",
        roomId: ids.rooms.checkout,
        branch: ids.branches.checkoutPolish,
        label: "shell",
        createdAt: minutesAgo(now, 11),
      },
    ],
    chats: [
      checkoutChat(now),
      emptyCartChat(now),
      markdownChat(now),
      oneLineChat(now, {
        id: FIXTURE_IDS.chats.stickySummary,
        minutes: 190,
        text: "Pin the order summary to the bottom of the screen under 768px.",
      }),
      oneLineChat(now, {
        id: FIXTURE_IDS.chats.shippingCopy,
        minutes: 60 * 24 * 3,
        text: "Rewrite the shipping estimate so it says a date, not a range of days.",
      }),
    ],
    pins: [
      { id: "pin-checkout", roomId: ids.rooms.checkout, position: 0 },
      {
        id: "pin-design-system",
        folderId: ids.folders.designSystem,
        position: 1,
      },
    ],
    repoConfigs: repoConfigs(now),
    hosted: hostedWorld(now),
  }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

/**
 * The reference Canvas. It carries one Project with **one Workspace in each
 * status** — `running` with an open PR, `running` clean, `starting`, `error` —
 * because the in-room sidebar's Workspace rows are the surface most polish
 * tickets touch and every one of those rows renders differently.
 */
function checkoutRoom(now: number, previewOrigin: string): FixtureRoom {
  const ids = FIXTURE_IDS
  const repoId = ids.repos.storefront
  const b = ids.branches

  const repo: RepoData = {
    id: repoId,
    name: "storefront",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    setupScript: "pnpm install",
    devScript: "pnpm dev --port $PORT",
    devServerPort: 3000,
    envVars: "NEXT_PUBLIC_API_URL=https://api.acme.test",
    defaultIframeLayerSizeId: DEFAULT_IFRAME_LAYER_SIZE_ID,
    systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
    createdAt: daysAgo(now, 12),
    sidebarOrder: 0,
    // Switched on from the storefront Repository, so Canvas settings shows
    // it linked (#1422).
    repositoryId: "cfg-storefront",
    addedBy: LOCAL_USER_ID,
  }

  const branches: BranchData[] = [
    {
      id: b.checkoutPolish,
      repoId,
      sandboxName: "checkout-polish",
      gitUrl: repo.cloneUrl,
      ref: "checkout-polish",
      title: "Checkout polish",
      previewDomain: previewDomainFor(previewOrigin, "checkout-polish"),
      port: 3000,
      status: "running",
      createdAt: daysAgo(now, 2),
      // Recent activity (#885) puts it second, behind Empty cart state.
      lastActivityAt: minutesAgo(now, 40),
      colorIndex: 0,
      sidebarOrder: 0,
      discoveredRoutes: [
        { route: "/", label: "Home" },
        { route: "/cart", label: "Cart" },
        { route: "/checkout", label: "Checkout" },
      ],
      // A Workspace with an open PR: the row shows the PR chip and the diff stats
      // the branch-git poll caches into the doc.
      prNumber: 482,
      prUrl: "https://github.com/acme/storefront/pull/482",
      prState: "open",
      diffAdditions: 214,
      diffDeletions: 37,
    },
    {
      id: b.emptyCart,
      repoId,
      sandboxName: "empty-cart-state",
      gitUrl: repo.cloneUrl,
      ref: "empty-cart-state",
      title: "Empty cart state",
      previewDomain: previewDomainFor(previewOrigin, "empty-cart-state"),
      port: 3001,
      status: "running",
      createdAt: daysAgo(now, 1),
      lastActivityAt: minutesAgo(now, 12),
      colorIndex: 2,
      sidebarOrder: 1,
      diffAdditions: 46,
      diffDeletions: 4,
    },
    {
      id: b.applePay,
      repoId,
      sandboxName: "apple-pay-button",
      gitUrl: repo.cloneUrl,
      ref: "apple-pay-button",
      title: "Apple Pay button",
      previewDomain: previewDomainFor(previewOrigin, "apple-pay-button"),
      port: 3002,
      status: "starting",
      statusMessage: "Running setup script…",
      createdAt: minutesAgo(now, 3),
      colorIndex: 4,
      sidebarOrder: 2,
    },
    {
      id: b.giftCards,
      repoId,
      sandboxName: "gift-cards",
      gitUrl: repo.cloneUrl,
      ref: "gift-cards",
      // No title: a Workspace from before titles (#881) shows its branch.
      previewDomain: previewDomainFor(previewOrigin, "gift-cards"),
      port: 3003,
      status: "error",
      // The step that was running when setup failed; it titles the error card.
      statusMessage: "Installing dependencies…",
      error:
        'setup script exited with code 1: ERR_PNPM_NO_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is absent',
      createdAt: daysAgo(now, 3),
      colorIndex: 6,
      sidebarOrder: 3,
    },
  ]

  // Two groups plus a standalone doc group. The desktop pair sits in one row so
  // the group chrome (name, gap handles, reorder) is on screen; the mobile frame
  // gets its own group next to it.
  const iframeLayers: IframeLayerData[] = [
    {
      id: "layer-checkout-desktop",
      branchId: b.checkoutPolish,
      width: 1280,
      height: 800,
      label: "Checkout · desktop",
      iframeState: {},
      route: "/checkout",
    },
    {
      id: "layer-checkout-mobile",
      branchId: b.checkoutPolish,
      width: 402,
      height: 874,
      label: "Checkout · iPhone 17 Pro",
      iframeState: {},
      route: "/checkout",
    },
    {
      id: "layer-cart-desktop",
      branchId: b.emptyCart,
      width: 1280,
      height: 800,
      label: "Empty cart",
      iframeState: {},
      route: "/cart",
    },
    {
      // The live page the Empty cart mockups explore, in their Group.
      id: "layer-cart-live",
      branchId: b.emptyCart,
      width: 1280,
      height: 800,
      label: "Empty cart · live",
      iframeState: {},
      route: "/cart",
    },
    {
      // No `branchId`: the empty-frame state, which renders the "pick a
      // Workspace" affordance rather than an iframe.
      id: "layer-unbound",
      width: 1280,
      height: 800,
      label: "Untitled frame",
      iframeState: {},
    },
  ]

  const markdownLayers: MarkdownLayerData[] = [
    {
      id: "doc-checkout-brief",
      width: 720,
      height: 800,
      title: "Checkout brief",
      // The Checkout polish chat wrote it (#1314).
      ownerChatId: FIXTURE_IDS.chats.checkoutPolish,
    },
  ]

  // Mockup Layers (#1309): two options the Empty cart chat drew beside its
  // live page, and a receipt the Checkout polish chat started from no frame.
  const mockupLayers: MockupLayerData[] = [
    {
      id: "mockup-cart-illustrated",
      ownerChatId: EMPTY_CART_CHAT_ID,
      width: 1280,
      height: 800,
      title: "Option A · Illustrated",
      status: "set-aside",
    },
    {
      id: "mockup-cart-suggestions",
      ownerChatId: EMPTY_CART_CHAT_ID,
      width: 1280,
      height: 800,
      title: "Option B · Suggestions",
      status: "current",
    },
    {
      id: "mockup-receipt",
      ownerChatId: FIXTURE_IDS.chats.checkoutPolish,
      width: 720,
      height: 800,
      title: "Order receipt email",
      status: "built",
    },
  ]

  const iframeLayerGroups: IframeLayerGroupData[] = [
    {
      id: "grp-checkout",
      name: "Checkout",
      x: 0,
      y: 0,
      members: [
        { kind: "iframe-layer", id: "layer-checkout-desktop" },
        { kind: "iframe-layer", id: "layer-checkout-mobile" },
        { kind: "markdown-layer", id: "doc-checkout-brief" },
      ],
      sidebarOrder: 0,
    },
    {
      id: "grp-cart",
      name: "Cart",
      x: 0,
      y: 1000,
      members: [
        { kind: "iframe-layer", id: "layer-cart-desktop" },
        { kind: "iframe-layer", id: "layer-unbound" },
      ],
      sidebarOrder: 1,
    },
    {
      id: "grp-cart-ideas",
      name: "Empty cart ideas",
      x: 0,
      y: 2200,
      members: [
        { kind: "iframe-layer", id: "layer-cart-live" },
        { kind: "mockup-layer", id: "mockup-cart-illustrated" },
        { kind: "mockup-layer", id: "mockup-cart-suggestions" },
      ],
      branchId: b.emptyCart,
      sidebarOrder: 2,
    },
    {
      id: "grp-receipt",
      name: "Receipt",
      x: 4140,
      y: 2200,
      members: [{ kind: "mockup-layer", id: "mockup-receipt" }],
      sidebarOrder: 3,
    },
  ]

  const chatSessions: ChatSessionData[] = [
    {
      id: FIXTURE_IDS.chats.checkoutPolish,
      branchId: b.checkoutPolish,
      label: "Checkout polish",
      createdAt: minutesAgo(now, 42),
      model: "claude-sonnet-4-5",
    },
    {
      id: EMPTY_CART_CHAT_ID,
      branchId: b.emptyCart,
      label: "Empty cart",
      createdAt: minutesAgo(now, 18),
      planMode: true,
      model: "claude-sonnet-4-5",
    },
    {
      id: FIXTURE_IDS.chats.markdown,
      branchId: b.checkoutPolish,
      label: "Breakpoint audit",
      createdAt: minutesAgo(now, 6),
      model: "claude-sonnet-4-5",
    },
    {
      // A frame chat with nothing sent yet: the empty state, and the chat the
      // run-state screens stream into (see `screens/`).
      id: FIXTURE_IDS.chats.fresh,
      branchId: b.checkoutPolish,
      label: "New chat",
      createdAt: minutesAgo(now, 3),
      model: "claude-sonnet-4-5",
    },
    // Closed chats — the chat history. One with a title and a first message,
    // one closed days ago, and one that was closed before anything was sent.
    {
      id: FIXTURE_IDS.chats.stickySummary,
      branchId: b.checkoutPolish,
      label: "Sticky summary",
      createdAt: minutesAgo(now, 190),
      closedAt: minutesAgo(now, 125),
      model: "claude-sonnet-4-5",
    },
    {
      id: FIXTURE_IDS.chats.closedEmpty,
      branchId: b.checkoutPolish,
      label: "Untitled",
      createdAt: minutesAgo(now, 60 * 26),
      closedAt: minutesAgo(now, 60 * 25),
      model: "claude-sonnet-4-5",
    },
    {
      id: FIXTURE_IDS.chats.shippingCopy,
      branchId: b.checkoutPolish,
      label: "Shipping estimate copy",
      createdAt: minutesAgo(now, 60 * 24 * 3),
      closedAt: minutesAgo(now, 60 * 24 * 3 - 40),
      model: "claude-sonnet-4-5",
    },
  ]

  const plans: PlanData[] = [
    {
      id: "plan-empty-cart",
      chatId: EMPTY_CART_CHAT_ID,
      branchId: b.emptyCart,
      content: EMPTY_CART_PLAN,
      status: "pending",
      toolEventId: EMPTY_CART_PLAN_TOOL_CALL_ID,
      createdAt: minutesAgo(now, 16),
    },
  ]

  return {
    id: ids.rooms.checkout,
    name: "Checkout flow",
    createdAt: daysAgo(now, 12),
    lastOpenedAt: minutesAgo(now, 4),
    folderId: ids.folders.marketing,
    doc: {
      repos: [repo],
      branches,
      iframeLayers,
      iframeLayerGroups,
      markdownLayers,
      mockupLayers,
      mockupHtml: {
        "mockup-cart-illustrated": EMPTY_CART_ILLUSTRATED,
        "mockup-cart-suggestions": EMPTY_CART_SUGGESTIONS,
        "mockup-receipt": ORDER_RECEIPT,
      },
      chatSessions,
      plans,
      memories: [
        {
          id: "mem-checkout-pnpm",
          text: "Use pnpm, never npm: the lockfile is pnpm-lock.yaml.",
          source: "coordinator",
          createdAt: daysAgo(now, 6),
          updatedAt: daysAgo(now, 6),
        },
        {
          id: "mem-checkout-mobile",
          text: "Design mobile-first. The summary rail becomes a sticky footer under 768px, and nothing on the checkout may shift when it pins.",
          source: "coordinator",
          createdAt: daysAgo(now, 3),
          updatedAt: daysAgo(now, 3),
        },
        {
          id: "mem-checkout-stripe",
          text: "Payments go through Stripe test mode on every Workspace.",
          source: "member",
          createdAt: daysAgo(now, 1),
          updatedAt: daysAgo(now, 1),
        },
      ],
      savedViewport: { x: 120, y: 80, zoom: 0.42 },
      markdownBodies: {
        "doc-checkout-brief": [
          "# Checkout brief",
          "",
          "Cut the checkout down to a single scroll on mobile. The address and",
          "payment steps collapse into one form; the summary rail becomes a",
          "sticky footer under 768px.",
          "",
          "## Open questions",
          "",
          "- Does Apple Pay sit above or below the card form?",
          "- Do we keep the promo-code field expanded by default?",
          "",
          "## Done when",
          "",
          "- One scroll to pay on an iPhone 17 Pro.",
          "- No layout shift when the summary pins.",
        ].join("\n"),
      },
    },
    thumbnailFrames: [
      "layer-checkout-desktop",
      "layer-checkout-mobile",
      "layer-cart-desktop",
    ],
  }
}

/** Frames only — a mobile/desktop pair for one Workspace, no chat, no doc. */
function pricingRoom(now: number, previewOrigin: string): FixtureRoom {
  const repo: RepoData = {
    id: "repo-pricing",
    name: "storefront",
    repoFullName: "acme/storefront",
    repoOwner: "acme",
    repoName: "storefront",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/storefront.git",
    setupScript: "pnpm install",
    devScript: "pnpm dev --port $PORT",
    devServerPort: 3000,
    envVars: "",
    createdAt: daysAgo(now, 8),
    sidebarOrder: 0,
    repositoryId: "cfg-storefront",
    addedBy: LOCAL_USER_ID,
  }
  const apiRepo: RepoData = {
    id: "repo-pricing-api",
    name: "api",
    repoFullName: "acme/platform",
    repoOwner: "acme",
    repoName: "platform",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/platform.git",
    setupScript: "pnpm install",
    devScript: "pnpm --filter api dev --port $PORT",
    devServerPort: 3000,
    envVars: "",
    createdAt: daysAgo(now, 7),
    sidebarOrder: 1,
  }
  const branch: BranchData = {
    id: "branch-pricing-tiers",
    repoId: repo.id,
    sandboxName: "pricing-tiers",
    gitUrl: repo.cloneUrl,
    ref: "pricing-tiers",
    title: "Pricing tiers",
    previewDomain: previewDomainFor(previewOrigin, "pricing-tiers"),
    port: 3000,
    status: "running",
    createdAt: daysAgo(now, 5),
    colorIndex: 3,
    prNumber: 470,
    prUrl: "https://github.com/acme/storefront/pull/470",
    prState: "merged",
    diffAdditions: 88,
    diffDeletions: 120,
  }
  // The api repository's one Workspace, so the flat Workspaces list (#884)
  // shows each row's repository.
  const apiBranch: BranchData = {
    id: "branch-rate-limit-headers",
    repoId: apiRepo.id,
    sandboxName: "rate-limit-headers",
    gitUrl: apiRepo.cloneUrl,
    ref: "rate-limit-headers",
    title: "Rate-limit headers",
    previewDomain: previewDomainFor(previewOrigin, "rate-limit-headers"),
    port: 3000,
    status: "stopped",
    createdAt: daysAgo(now, 4),
    colorIndex: 5,
    diffAdditions: 24,
    diffDeletions: 3,
    // Merged and idle, so its … menu leads with Mark as done.
    prNumber: 212,
    prUrl: "https://github.com/acme/platform/pull/212",
    prState: "merged",
  }

  return {
    id: FIXTURE_IDS.rooms.pricing,
    name: "Pricing page",
    createdAt: daysAgo(now, 8),
    lastOpenedAt: daysAgo(now, 1),
    folderId: FIXTURE_IDS.folders.marketing,
    doc: {
      // Two repositories, so Canvas settings (#883) and the Workspaces list
      // (#884) have a two-repository canvas to show.
      repos: [repo, apiRepo],
      branches: [branch, apiBranch],
      iframeLayers: [
        {
          id: "layer-pricing-desktop",
          branchId: branch.id,
          width: 1440,
          height: 900,
          label: "Pricing · laptop",
          iframeState: {},
          route: "/pricing",
        },
        {
          id: "layer-pricing-mobile",
          branchId: branch.id,
          width: 402,
          height: 874,
          label: "Pricing · mobile",
          iframeState: {},
          route: "/pricing",
        },
      ],
      iframeLayerGroups: [
        {
          id: "grp-pricing",
          name: "Pricing",
          x: 0,
          y: 0,
          members: [
            { kind: "iframe-layer", id: "layer-pricing-desktop" },
            { kind: "iframe-layer", id: "layer-pricing-mobile" },
          ],
          sidebarOrder: 0,
        },
      ],
      // A turn in flight on Pricing tiers, so its row leads with the agent's
      // activity spinner while its merged PR sits at the row's end (#963).
      chatSessions: [
        {
          id: "chat-pricing-tiers",
          branchId: branch.id,
          label: "Annual toggle",
          createdAt: minutesAgo(now, 2),
          model: "claude-sonnet-4-5",
          isStreaming: true,
        },
      ],
      // Low enough that the Pricing group's label clears the top chrome.
      savedViewport: { x: 60, y: 120, zoom: 0.5 },
    },
    thumbnailFrames: ["layer-pricing-desktop", "layer-pricing-mobile"],
  }
}

/** Document Layers only — the Canvas as a writing surface, no Project at all. */
function tokensRoom(now: number): FixtureRoom {
  return {
    id: FIXTURE_IDS.rooms.tokens,
    name: "Design tokens",
    createdAt: daysAgo(now, 30),
    lastOpenedAt: daysAgo(now, 3),
    folderId: FIXTURE_IDS.folders.designSystem,
    doc: {
      markdownLayers: [
        { id: "doc-tokens-color", width: 720, height: 900, title: "Color" },
        { id: "doc-tokens-space", width: 720, height: 900, title: "Spacing" },
      ],
      iframeLayerGroups: [
        {
          id: "grp-tokens",
          name: "Tokens",
          x: 0,
          y: 0,
          members: [
            { kind: "markdown-layer", id: "doc-tokens-color" },
            { kind: "markdown-layer", id: "doc-tokens-space" },
          ],
          sidebarOrder: 0,
        },
      ],
      savedViewport: { x: 40, y: 90, zoom: 0.6 },
      markdownBodies: {
        "doc-tokens-color": [
          "# Color",
          "",
          "Two ramps and nothing else. Anything that needs a third is a bug in",
          "the spec, not a missing token.",
          "",
          "## Neutral",
          "",
          "- `--background` / `--foreground` flip wholesale between themes.",
          "- `--muted-foreground` is the only secondary text color.",
          "",
          "## Accent",
          "",
          "- `--primary` for the one action a screen is about.",
          "- `--destructive` for anything that loses work.",
        ].join("\n"),
        "doc-tokens-space": [
          "# Spacing",
          "",
          "A 4px base with a 4-step scale. Gaps come from the scale; padding is",
          "set by the component, never by a one-off margin.",
          "",
          "## Scale",
          "",
          "- `1` — 4px, icon-to-label",
          "- `2` — 8px, inside a control",
          "- `4` — 16px, between controls",
          "- `6` — 24px, between sections",
          "",
          "### Exceptions",
          "",
          "Dense tables may drop to `1` between rows. Nothing else does.",
        ].join("\n"),
      },
    },
  }
}

/** A small Canvas at the "All files" root, so the root listing isn't only the empty one. */
function onboardingRoom(now: number, previewOrigin: string): FixtureRoom {
  const repo: RepoData = {
    id: "repo-onboarding",
    name: "web",
    repoFullName: "acme/web",
    repoOwner: "acme",
    repoName: "web",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/web.git",
    setupScript: "npm ci",
    devScript: "npm run dev -- --port $PORT",
    devServerPort: 5173,
    envVars: "",
    createdAt: daysAgo(now, 6),
    sidebarOrder: 0,
  }
  const branch: BranchData = {
    id: "branch-onboarding-steps",
    repoId: repo.id,
    sandboxName: "onboarding-steps",
    gitUrl: repo.cloneUrl,
    ref: "onboarding-steps",
    previewDomain: previewDomainFor(previewOrigin, "onboarding-steps"),
    port: 5173,
    status: "stopped",
    createdAt: daysAgo(now, 6),
    colorIndex: 5,
    sidebarOrder: 0,
    // A closed PR: with the pricing room's merged one and the checkout room's
    // open one, the sidebar's three PR state icons each have a screen.
    prNumber: 455,
    prUrl: "https://github.com/acme/web/pull/455",
    prState: "closed",
  }
  // `creating` with no ref yet: the row's "Creating…" placeholder.
  const creating: BranchData = {
    id: "branch-onboarding-creating",
    repoId: repo.id,
    sandboxName: "onboarding-creating",
    gitUrl: repo.cloneUrl,
    ref: "",
    previewDomain: previewDomainFor(previewOrigin, "onboarding-creating"),
    port: 5174,
    status: "creating",
    createdAt: minutesAgo(now, 1),
    colorIndex: 1,
    sidebarOrder: 1,
  }

  return {
    id: FIXTURE_IDS.rooms.onboarding,
    name: "Onboarding",
    createdAt: daysAgo(now, 6),
    lastOpenedAt: daysAgo(now, 2),
    doc: {
      repos: [repo],
      branches: [branch, creating],
      iframeLayers: [
        {
          id: "layer-onboarding-1",
          branchId: branch.id,
          width: 1280,
          height: 800,
          label: "Step 1 · Welcome",
          iframeState: {},
          route: "/welcome",
        },
        {
          id: "layer-onboarding-2",
          branchId: branch.id,
          width: 1280,
          height: 800,
          label: "Step 2 · Connect",
          iframeState: {},
          route: "/connect",
        },
      ],
      iframeLayerGroups: [
        {
          id: "grp-onboarding",
          name: "Onboarding",
          x: 0,
          y: 0,
          members: [
            { kind: "iframe-layer", id: "layer-onboarding-1" },
            { kind: "iframe-layer", id: "layer-onboarding-2" },
          ],
          sidebarOrder: 0,
        },
      ],
      savedViewport: { x: 80, y: 60, zoom: 0.45 },
    },
    thumbnailFrames: ["layer-onboarding-1", "layer-onboarding-2"],
  }
}

/**
 * One frame per stage a frame can show for its Workspace (issue #731): booting,
 * starting, failed, stopped, no Workspace, and a live page for comparison. The
 * non-running Workspaces sit behind cold previews (`COLD_WORKSPACE_PREFIX`), so
 * their frames get the proxy placeholder a real one would, never a page.
 */
function frameStatesRoom(now: number, previewOrigin: string): FixtureRoom {
  const b = FIXTURE_IDS.branches
  const repo: RepoData = {
    id: "repo-frame-states",
    name: "web",
    repoFullName: "acme/web",
    repoOwner: "acme",
    repoName: "web",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/web.git",
    setupScript: "pnpm install",
    devScript: "pnpm dev --port $PORT",
    devServerPort: 3000,
    envVars: "",
    createdAt: daysAgo(now, 4),
    sidebarOrder: 0,
  }
  const branch = (
    id: string,
    sandboxName: string,
    ref: string,
    order: number,
    rest: Pick<BranchData, "status"> & Partial<BranchData>
  ): BranchData => ({
    id,
    repoId: repo.id,
    sandboxName,
    gitUrl: repo.cloneUrl,
    ref,
    previewDomain: previewDomainFor(previewOrigin, sandboxName),
    port: 3000 + order,
    createdAt: minutesAgo(now, 30 - order),
    colorIndex: order,
    sidebarOrder: order,
    ...rest,
  })
  const cold = COLD_WORKSPACE_PREFIX
  const branches: BranchData[] = [
    branch(b.framesBooting, `${cold}booting`, "search-filters", 0, {
      status: "creating",
      statusMessage: "Cloning repository…",
    }),
    branch(b.framesStarting, `${cold}starting`, "saved-searches", 1, {
      status: "starting",
      statusMessage: "Running setup script…",
    }),
    branch(b.framesFailed, `${cold}failed`, "map-view", 2, {
      status: "error",
      error:
        'setup script exited with code 1: ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with package.json',
    }),
    branch(b.framesStopped, `${cold}stopped`, "listing-gallery", 3, {
      status: "stopped",
    }),
    branch(b.framesReady, "listing-page", "listing-page", 4, {
      status: "running",
      // An open PR whose merge is blocked (failing checks): the chat header's
      // PR button turns red with the merge-blocked icon.
      prNumber: 491,
      prUrl: "https://github.com/acme/listings/pull/491",
      prState: "open",
      prBlocked: true,
      diffAdditions: 62,
      diffDeletions: 9,
    }),
    branch(b.framesLive, `${cold}live`, "agent-profile", 5, {
      status: "creating",
      statusMessage: "Cloning repository…",
    }),
    // No frames: they're here for the Terminal Pane's dev server states.
    branch(b.framesServerStopped, `${cold}server-stopped`, "price-alerts", 6, {
      status: "running",
      title: "Price alerts",
      devServerStoppedAt: minutesAgo(now, 4),
    }),
    branch(b.framesServerCrashed, `${cold}server-crashed`, "open-houses", 7, {
      status: "running",
      title: "Open houses",
    }),
  ]
  const frame = (id: string, label: string, branchId?: string) => ({
    id,
    ...(branchId ? { branchId } : {}),
    width: 480,
    height: 320,
    label,
    iframeState: {},
    route: "/",
  })
  const iframeLayers: IframeLayerData[] = [
    frame("layer-frames-booting", "Booting", b.framesBooting),
    frame("layer-frames-starting", "Starting", b.framesStarting),
    frame("layer-frames-failed", "Failed", b.framesFailed),
    frame("layer-frames-stopped", "Stopped", b.framesStopped),
    frame("layer-frames-unassigned", "No Workspace"),
    frame("layer-frames-ready", "Ready", b.framesReady),
    frame("layer-frames-live", "Boot to ready", b.framesLive),
  ]
  const member = (id: string) => ({ kind: "iframe-layer" as const, id })
  return {
    id: FIXTURE_IDS.rooms.frameStates,
    name: "Frame states",
    createdAt: daysAgo(now, 4),
    lastOpenedAt: daysAgo(now, 4),
    doc: {
      repos: [repo],
      branches,
      iframeLayers,
      iframeLayerGroups: [
        {
          id: "grp-frames-progress",
          name: "Progress",
          x: 0,
          y: 0,
          members: [
            member("layer-frames-booting"),
            member("layer-frames-starting"),
            member("layer-frames-ready"),
          ],
          sidebarOrder: 0,
        },
        {
          id: "grp-frames-problems",
          name: "Problems",
          x: 0,
          y: 440,
          members: [
            member("layer-frames-failed"),
            member("layer-frames-stopped"),
            member("layer-frames-unassigned"),
          ],
          sidebarOrder: 1,
        },
        {
          id: "grp-frames-live",
          name: "Recording",
          x: 0,
          y: 880,
          members: [member("layer-frames-live")],
          sidebarOrder: 2,
        },
      ],
      // Clear of the top chrome, so the first row's labels show and take clicks.
      savedViewport: { x: 40, y: 110, zoom: 0.75 },
    },
  }
}

// ---------------------------------------------------------------------------
// Agent chat
// ---------------------------------------------------------------------------

/** The chat paused on a plan. Named once so the Y.Doc session, the durable log,
 *  and the pending tool call can't drift apart. */
const EMPTY_CART_CHAT_ID = "chat-empty-cart"
const EMPTY_CART_PLAN_TOOL_CALL_ID = "tool-plan-empty-cart"
const EMPTY_CART_PLAN = [
  "## Empty cart state",
  "",
  "1. Add an `EmptyCart` component with the illustration slot the design calls for.",
  "2. Render it from `CartPage` when `items.length === 0`.",
  "3. Keep the existing summary rail mounted so the layout doesn't jump.",
].join("\n")

/**
 * A run paused mid-turn on a plan, which is the whole point of this chat: the
 * approve/reject card is a distinct surface, and it is rebuilt on load from the
 * pending tool call rather than from the message log — so the log here is just
 * the narration that leads up to it.
 */
function emptyCartChat(now: number): FixtureChat {
  return {
    id: EMPTY_CART_CHAT_ID,
    roomId: FIXTURE_IDS.rooms.checkout,
    sandboxName: "empty-cart-state",
    model: "claude-sonnet-4-5",
    systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
    createdAt: minutesAgo(now, 18),
    messages: [
      {
        id: "msg-cart-1",
        createdAt: minutesAgo(now, 18),
        record: {
          role: "user",
          content: [
            {
              type: "text",
              text: "The cart page is blank when there's nothing in it. Give it a real empty state.",
            },
          ],
        },
      },
      {
        id: "msg-cart-2",
        createdAt: minutesAgo(now, 17),
        record: {
          role: "agent",
          content: [
            {
              type: "text",
              text: "Here's what I'd do — the summary rail stays mounted so the page doesn't jump when the last item is removed.",
            },
          ],
        },
      },
    ],
    pendingPlan: {
      runId: "run-empty-cart",
      toolCallId: EMPTY_CART_PLAN_TOOL_CALL_ID,
      plan: EMPTY_CART_PLAN,
      createdAt: minutesAgo(now, 16),
    },
  }
}

/**
 * A finished agent turn with the tool-call shapes that actually render
 * differently: a `read`, an `edit` carrying a `diff`, an `execute` carrying a
 * `terminal` handle, a failed call, and a `Task` subagent with a child call
 * linked by `parentToolCallId`. A chat log that only has text messages in it
 * tells a reviewer nothing about the chip, diff, or subagent chrome.
 */
function checkoutChat(now: number): FixtureChat {
  const at = (minutes: number) => minutesAgo(now, minutes)
  const messages: FixtureChat["messages"] = [
    {
      id: "msg-1",
      createdAt: at(42),
      record: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Collapse the checkout into one scroll on mobile — address and payment in a single form, summary pinned to the bottom.",
          },
        ],
      },
    },
    {
      id: "msg-2",
      createdAt: at(41),
      record: {
        role: "thought",
        content: [
          {
            type: "text",
            text: "The two steps are separate routes today, so this is a layout change plus a route merge. Read the checkout page first.",
          },
        ],
      },
    },
    {
      id: "msg-3",
      createdAt: at(41),
      record: {
        role: "tool_call",
        toolCallId: "tc-read-checkout",
        title: "Read app/checkout/page.tsx",
        kind: "read",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "export default function CheckoutPage() {\n  return (\n    <Steps>\n      <AddressStep />\n      <PaymentStep />\n    </Steps>\n  )\n}",
            },
          },
        ],
        rawInput: { file_path: "app/checkout/page.tsx" },
      },
    },
    {
      id: "msg-4",
      createdAt: at(39),
      record: {
        role: "tool_call",
        toolCallId: "tc-edit-checkout",
        title: "Edit app/checkout/page.tsx",
        kind: "edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "app/checkout/page.tsx",
            oldText:
              "    <Steps>\n      <AddressStep />\n      <PaymentStep />\n    </Steps>\n",
            newText:
              "    <SingleScrollCheckout>\n      <AddressFields />\n      <PaymentFields />\n      <StickySummary />\n    </SingleScrollCheckout>\n",
          },
        ],
      },
    },
    {
      id: "msg-5",
      createdAt: at(37),
      record: {
        role: "tool_call",
        toolCallId: "tc-task-audit",
        title: "Task: audit the mobile breakpoints",
        kind: "think",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Three components hard-code a 640px breakpoint; the rest read the Tailwind `md` token.",
            },
          },
        ],
      },
    },
    {
      id: "msg-6",
      createdAt: at(37),
      record: {
        // A child of the Task above — the subagent grouping the renderer collapses
        // once the run settles (#711).
        role: "tool_call",
        toolCallId: "tc-task-grep",
        parentToolCallId: "tc-task-audit",
        title: "Search for hard-coded breakpoints",
        kind: "search",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "3 files matched `max-width: 640px`",
            },
          },
        ],
      },
    },
    {
      id: "msg-7",
      createdAt: at(35),
      record: {
        role: "tool_call",
        toolCallId: "tc-run-tests",
        title: "pnpm test checkout",
        kind: "execute",
        status: "completed",
        content: [{ type: "terminal", terminalId: "term-checkout-claude" }],
      },
    },
    {
      id: "msg-7-guardian",
      createdAt: at(34.5),
      record: {
        // Codex's approval reviewer, which no chat shows unless it denies (#1300).
        role: "tool_call",
        toolCallId: "guardian_assessment:review-checkout",
        title: "Guardian Review",
        kind: "think",
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "Action: pnpm lint\nVerdict: approved",
            },
          },
        ],
      },
    },
    {
      id: "msg-8",
      createdAt: at(34),
      record: {
        // A failed call, so the error chip is on screen too.
        role: "tool_call",
        toolCallId: "tc-run-lint",
        title: "pnpm lint",
        kind: "execute",
        status: "failed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: "app/checkout/page.tsx:18:3  error  'StickySummary' is not defined  no-undef",
            },
          },
        ],
      },
    },
    {
      id: "msg-9",
      createdAt: at(33),
      record: {
        role: "agent",
        content: [
          {
            type: "text",
            text: "Checkout is one scroll now: `AddressFields` and `PaymentFields` render in a single form and `StickySummary` pins under 768px.\n\nLint is still red — `StickySummary` needs importing in `page.tsx`. Want me to fix that and re-run?",
          },
        ],
      },
    },
    {
      id: "msg-10",
      createdAt: at(1),
      record: {
        // Left `in_progress` on purpose: the live spinner state a reviewer needs
        // to see in the composer/chip chrome.
        role: "tool_call",
        toolCallId: "tc-inflight",
        title: "Edit app/checkout/page.tsx",
        kind: "edit",
        status: "in_progress",
        content: [],
      },
    },
  ]

  return {
    id: FIXTURE_IDS.chats.checkoutPolish,
    roomId: FIXTURE_IDS.rooms.checkout,
    sandboxName: "checkout-polish",
    model: "claude-sonnet-4-5",
    systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
    createdAt: minutesAgo(now, 42),
    messages,
  }
}

/**
 * A reply in the shape agents actually write: GFM tables, a task list,
 * strikethrough, inline code in every message kind, and fenced code blocks —
 * one of them wider than the chat panel, so overflow is on screen too.
 */
function markdownChat(now: number): FixtureChat {
  const at = (minutes: number) => minutesAgo(now, minutes)
  const text = (t: string) => [{ type: "text" as const, text: t }]
  const messages: FixtureChat["messages"] = [
    {
      id: "md-1",
      createdAt: at(6),
      record: {
        role: "user",
        content: text(
          "Audit the hard-coded breakpoints — which files still use `max-width: 640px`?"
        ),
      },
    },
    {
      id: "md-2",
      createdAt: at(6),
      record: {
        role: "thought",
        content: text(
          "Grep for `640px` across `app/` and `components/`, then compare each hit against the `md` token."
        ),
      },
    },
    {
      id: "md-3",
      createdAt: at(5),
      record: {
        role: "agent",
        content: text(
          [
            "Three files still hard-code the breakpoint instead of reading the `md` token:",
            "",
            "| File | Line | Rule | Fix |",
            "| --- | ---: | --- | --- |",
            "| `components/cart/summary-rail.tsx` | 42 | `max-width: 640px` | `md:` variant |",
            "| `app/checkout/address-form.tsx` | 17 | `@media (max-width: 640px)` | `md:` variant |",
            "| `components/ui/sticky-footer.tsx` | 8 | `max-w-[640px]` | ~~`sm:`~~ `md:` token |",
            "",
            "- [x] Search `app/` and `components/`",
            "- [x] Confirm `tailwind.config.ts` defines `md` as `768px`",
            "- [ ] Swap the three rules for the token",
            "",
            "The summary rail is the only one with logic around it:",
            "",
            "```tsx",
            "export function SummaryRail({ items }: { items: CartItem[] }) {",
            '  const isMobile = useMediaQuery("(max-width: 640px)") // hard-coded: should read the md token from the theme config instead',
            "  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0)",
            "  return isMobile ? <StickySummary total={total} /> : <Rail total={total} />",
            "}",
            "```",
            "",
            "Run this to confirm nothing else matches:",
            "",
            "```bash",
            "rg -n '640px' app components",
            "```",
          ].join("\n")
        ),
      },
    },
  ]

  return {
    id: FIXTURE_IDS.chats.markdown,
    roomId: FIXTURE_IDS.rooms.checkout,
    sandboxName: "checkout-polish",
    model: "claude-sonnet-4-5",
    systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
    createdAt: at(6),
    messages,
  }
}

/** A chat whose whole log is one user message — enough for a history row. */
function oneLineChat(
  now: number,
  { id, minutes, text }: { id: string; minutes: number; text: string }
): FixtureChat {
  return {
    id,
    roomId: FIXTURE_IDS.rooms.checkout,
    sandboxName: "checkout-polish",
    model: "claude-sonnet-4-5",
    systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
    createdAt: minutesAgo(now, minutes),
    messages: [
      {
        id: `${id}-1`,
        createdAt: minutesAgo(now, minutes),
        record: { role: "user", content: [{ type: "text", text }] },
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Project presets
// ---------------------------------------------------------------------------

/**
 * Saved Project presets — what Settings → Projects lists and what the
 * add-Project flow offers. Three shapes on purpose: a private repo, a public
 * one, and a local-folder preset (`localPath`, the desktop acquisition hint),
 * because each renders a different badge.
 */
function repoConfigs(now: number): RepoConfig[] {
  return [
    {
      id: "cfg-storefront",
      name: "storefront",
      repoFullName: "acme/storefront",
      repoOwner: "acme",
      repoName: "storefront",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/storefront.git",
      private: true,
      setupScript: "pnpm install",
      devScript: "pnpm dev --port $PORT",
      devServerPort: 3000,
      envVars: "NEXT_PUBLIC_API_URL=https://api.acme.test",
      defaultIframeLayerSizeId: DEFAULT_IFRAME_LAYER_SIZE_ID,
      systemPrompt: "Match the existing Tailwind tokens; never add new colors.",
      createdAt: daysAgo(now, 12),
      updatedAt: daysAgo(now, 2),
    },
    {
      id: "cfg-web",
      name: "web",
      repoFullName: "acme/web",
      repoOwner: "acme",
      repoName: "web",
      defaultBranch: "main",
      cloneUrl: "https://github.com/acme/web.git",
      private: false,
      setupScript: "npm ci",
      devScript: "npm run dev -- --port $PORT",
      devServerPort: 5173,
      envVars: "",
      createdAt: daysAgo(now, 6),
      updatedAt: daysAgo(now, 6),
    },
    {
      id: "cfg-design-system",
      name: "design-system",
      repoFullName: "acme/design-system",
      repoOwner: "acme",
      repoName: "design-system",
      defaultBranch: "main",
      cloneUrl: "",
      localPath: "/Users/designer/code/design-system",
      private: true,
      setupScript: "pnpm install",
      devScript: "pnpm storybook --port $PORT",
      devServerPort: 6006,
      envVars: "",
      copyPatterns: ".env*\n.npmrc",
      createdAt: daysAgo(now, 21),
      updatedAt: daysAgo(now, 4),
    },
  ]
}

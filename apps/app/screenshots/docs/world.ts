import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { LOCAL_USER_ID } from "@/lib/local-user"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MockupLayerData,
  RepoData,
} from "@/lib/types"

import {
  accountFileFixtures,
  canvasFileFixtures,
  type FixtureChat,
  type FixtureRoom,
  type FixtureWorld,
} from "../fixtures/world"
import { readSource, WORKSPACE_EDITS, type DemoPreview } from "./demo-site"
import { PRICING_SIDE_BY_SIDE_MOCKUP, PRICING_TOGGLE_MOCKUP } from "./mockups"

/**
 * The **docs world** — what the product docs' screenshots show (`apps/docs`).
 *
 * The design-review Fixture World (`../fixtures/world.ts`) is built to cover
 * every state a polish ticket might touch. This one tells a single story
 * instead, the one the docs walk through: a small team building the
 * "Northwind" marketing site, with a Workspace per change, an agent turn that
 * edited the hero, a plan that was approved, a launch checklist, and a few more
 * Canvases filed into Folders. Its frames load real builds of the demo site
 * (`./demo-site.ts`), and the same edits that build a Workspace's variant
 * appear as that Workspace's chat diffs.
 *
 * Same rules as the Fixture World: data only, stable literal ids, and every
 * timestamp relative to one instant, so a re-run reproduces the same images.
 */

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/**
 * The instant the docs world is anchored to — fixed, unlike the design-review
 * world's `worldNow()`, because the docs are regenerated continuously and a
 * re-run with no UI change must produce the same images. Captures freeze the
 * browser clock just after it ({@link DOCS_CLOCK}), so "Edited 2m ago" and
 * the table's dates read the same on every run.
 */
export const DOCS_NOW = Date.UTC(2026, 8, 14, 16, 0)

/** The browser clock every docs capture is frozen at. */
export const DOCS_CLOCK = DOCS_NOW + 2 * MINUTE

export const DOCS_IDS = {
  folders: { marketing: "fld-marketing", product: "fld-product" },
  rooms: {
    northwind: "room-northwind-site",
    onboarding: "room-onboarding-flow",
    pricingExperiments: "room-pricing-experiments",
    customerStories: "room-customer-stories",
  },
  branches: {
    hero: "branch-hero-gradient",
    faq: "branch-pricing-faq",
    stories: "branch-customer-stories",
  },
  layers: {
    home: "layer-home",
    homeMobile: "layer-home-mobile",
    pricing: "layer-pricing",
    pricingMobile: "layer-pricing-mobile",
    customers: "layer-customers",
    checklist: "doc-launch-checklist",
  },
  chats: {
    hero: "chat-hero-gradient",
    faq: "chat-pricing-faq",
    stories: "chat-customer-stories",
  },
} as const

/** Sandbox names of every Workspace in the world, in the order their previews get ports. */
export const DOCS_WORKSPACES = [
  "hero-gradient-trust-line",
  "pricing-faq",
  "customer-stories",
  "onboarding-flow",
  "annual-pricing-test",
  "customer-quotes",
] as const

/** Assign each Workspace its own preview port, counting up from `firstPort`. */
export function docsPreviews(firstPort: number): DemoPreview[] {
  return DOCS_WORKSPACES.map((sandboxName, i) => ({
    sandboxName,
    port: firstPort + i,
  }))
}

// Legacy Workspace `colorIndex` values (Workspaces have no colour in the UI;
// stored rooms may still carry one).
const COLOR = { orange: 1, lime: 4, emerald: 6, sky: 9, purple: 13, rose: 15 }

const ROUTES = [
  { route: "/", label: "Home" },
  { route: "/pricing", label: "Pricing" },
  { route: "/customers", label: "Customers" },
]

const PROMPTS = {
  hero: 'Make the hero headline use a gradient from the accent color to cyan, and add a small "Trusted by 4,000+ product teams" line under the buttons.',
  faq: "Add an FAQ section below the pricing cards with four common questions.",
}

const FAQ_PLAN = `## Add an FAQ to the pricing page

1. **Markup** — add a \`<section className="faq">\` below the plan cards in \`src/pages/Pricing.jsx\` with four questions:
   - Can I change plans later?
   - What counts as an event?
   - Do you offer discounts for startups?
   - Is there a free trial?
2. **Behavior** — render each item as a native \`<details>\` so it expands without extra JavaScript.
3. **Styles** — add \`.faq\` rules to \`src/styles.css\`: a centered 720px column, hairline dividers, and the accent color on the open item's marker.
4. Commit and push.`

const CHECKLIST = `# Pricing launch checklist

Target launch: **Tuesday, Oct 6**. Owner: Growth team.

## Before launch

- Final copy review for all three plans
- Annual toggle QA on mobile (iPhone 17 Pro, Pixel 9)
- FAQ answers signed off by Support
- Update Stripe prices for annual billing

## Launch day

- Merge the pricing and FAQ branches
- Announce in the changelog and newsletter
- Watch the Pricing → Signup funnel in Northwind

## After launch

- Compare conversion week over week
- Collect feedback from the sales team`

/**
 * The Project, as opening the checkout from disk creates it: named for its
 * folder, with no clone URL of its own.
 */
const REPO_BASE = {
  name: "",
  repoFullName: "northwind-web",
  repoOwner: "",
  repoName: "northwind-web",
  defaultBranch: "main",
  cloneUrl: "",
  localPath: "/Users/sam/code/northwind-web",
  setupScript: "npm install",
  devScript: "npm run dev -- --port $PORT",
  devServerPort: 5173,
  copyPatterns: ".env*",
  defaultIframeLayerSizeId: DEFAULT_IFRAME_LAYER_SIZE_ID,
}

export interface BuildDocsWorldOptions {
  now: number
  /** Where each Workspace's preview is served (`./demo-site.ts`). */
  previewOrigins: Record<string, string>
}

export async function buildDocsWorld(
  options: BuildDocsWorldOptions
): Promise<FixtureWorld> {
  const { now } = options
  const ids = DOCS_IDS
  const minutesAgo = (m: number) => now - m * MINUTE
  const daysAgo = (d: number) => now - d * DAY
  const origin = (sandboxName: string) => {
    const url = options.previewOrigins[sandboxName]
    if (!url) throw new Error(`docs world: no preview for ${sandboxName}`)
    return url
  }

  return {
    now,
    userId: LOCAL_USER_ID,
    folders: [
      {
        id: ids.folders.marketing,
        name: "Marketing",
        parentFolderId: null,
        createdAt: daysAgo(14),
      },
      {
        id: ids.folders.product,
        name: "Product",
        parentFolderId: null,
        createdAt: daysAgo(10),
      },
    ],
    rooms: [
      northwindRoom(now, origin),
      simpleRoom({
        id: ids.rooms.onboarding,
        name: "Onboarding flow",
        folderId: ids.folders.product,
        createdAt: daysAgo(6),
        lastOpenedAt: daysAgo(2),
        sandboxName: "onboarding-flow",
        colorIndex: COLOR.purple,
        origin,
        group: "Onboarding",
        frames: [
          ["Welcome", "/", 402, 874],
          ["Plans", "/pricing", 402, 874],
          ["Stories", "/customers", 402, 874],
        ],
      }),
      simpleRoom({
        id: ids.rooms.pricingExperiments,
        name: "Pricing experiments",
        folderId: ids.folders.marketing,
        createdAt: daysAgo(4),
        lastOpenedAt: daysAgo(1),
        sandboxName: "annual-pricing-test",
        colorIndex: COLOR.lime,
        origin,
        group: "Pricing",
        frames: [
          ["Pricing", "/pricing", 1280, 800],
          ["Pricing · mobile", "/pricing", 402, 874],
        ],
        mockups: [
          ["Option A · Toggle", PRICING_TOGGLE_MOCKUP, 1280, 800],
          ["Option B · Side by side", PRICING_SIDE_BY_SIDE_MOCKUP, 1280, 800],
        ],
      }),
      simpleRoom({
        id: ids.rooms.customerStories,
        name: "Customer stories page",
        folderId: ids.folders.marketing,
        createdAt: daysAgo(3),
        lastOpenedAt: minutesAgo(50),
        sandboxName: "customer-quotes",
        colorIndex: COLOR.rose,
        origin,
        group: "Customers",
        frames: [["Customers", "/customers", 1280, 800]],
      }),
    ],
    terminalTabs: [],
    chats: [await heroChat(now), await faqChat(now)],
    pins: [
      { id: "pin-northwind", roomId: ids.rooms.northwind, position: 0 },
      { id: "pin-marketing", folderId: ids.folders.marketing, position: 1 },
    ],
    repoConfigs: repoConfigs(now),
    accountFiles: accountFileFixtures(LOCAL_USER_ID, now - 2 * DAY, [
      { folder: "writing" },
      {
        path: "writing/voice-and-tone.md",
        mediaType: "text/markdown",
        body: VOICE_AND_TONE,
      },
      {
        path: "writing/release-notes-template.md",
        mediaType: "text/markdown",
        size: 3 * 1024,
      },
      {
        path: "reading-list.md",
        mediaType: "text/markdown",
        size: 2 * 1024,
      },
    ]),
    accountMemory: [
      {
        id: "mem-account-copy",
        text: "Write UI copy in plain sentences, and keep buttons to one or two words.",
        source: "member",
        createdAt: now - 9 * DAY,
        updatedAt: now - 9 * DAY,
      },
      {
        id: "mem-account-fixes",
        text: "Prefers small fixes inside the current design over redesigns.",
        source: "agent",
        createdAt: now - 4 * DAY,
        updatedAt: now - 4 * DAY,
      },
      {
        id: "mem-account-tests",
        text: "Run the tests before saying a change is done.",
        source: "agent",
        createdAt: now - DAY,
        updatedAt: now - DAY,
      },
    ],
    // The docs are shot from the local build, which has no people or
    // comment threads to seed.
    hosted: { userName: "Sam Rivera", collaborators: [], threads: [] },
  }
}

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

function northwindRoom(
  now: number,
  origin: (sandboxName: string) => string
): FixtureRoom {
  const ids = DOCS_IDS
  const minutesAgo = (m: number) => now - m * MINUTE
  const repo: RepoData = {
    id: "repo-northwind",
    ...REPO_BASE,
    createdAt: now - 9 * DAY,
    sidebarOrder: 0,
    // Switched on from the "web" Repository in Settings (#1422).
    repositoryId: "cfg-northwind-web",
    addedBy: LOCAL_USER_ID,
  }
  const branch = (
    id: string,
    sandboxName: string,
    colorIndex: number,
    sidebarOrder: number,
    extra: Partial<BranchData> = {}
  ): BranchData => ({
    id,
    repoId: repo.id,
    sandboxName,
    gitUrl: repo.cloneUrl,
    ref: sandboxName,
    previewDomain: origin(sandboxName),
    port: 5173 + sidebarOrder,
    status: "running",
    createdAt: minutesAgo(90 - sidebarOrder * 20),
    colorIndex,
    sidebarOrder,
    discoveredRoutes: ROUTES,
    ...extra,
  })

  const branches: BranchData[] = [
    branch(ids.branches.stories, "customer-stories", COLOR.sky, 0, {
      title: "Customer stories",
    }),
    branch(ids.branches.hero, "hero-gradient-trust-line", COLOR.orange, 1, {
      title: "Hero gradient & trust line",
      diffAdditions: 3,
      diffDeletions: 0,
    }),
    branch(ids.branches.faq, "pricing-faq", COLOR.emerald, 2, {
      title: "Pricing FAQ",
      diffAdditions: 11,
      diffDeletions: 0,
    }),
  ]

  const frame = (
    id: string,
    branchId: string,
    label: string,
    route: string,
    width: number,
    height: number
  ): IframeLayerData => ({
    id,
    branchId,
    label,
    route,
    width,
    height,
    iframeState: {},
  })

  const l = ids.layers
  const iframeLayers: IframeLayerData[] = [
    frame(l.home, ids.branches.hero, "Home", "/", 1280, 800),
    frame(l.homeMobile, ids.branches.hero, "Home · mobile", "/", 402, 874),
    frame(l.pricing, ids.branches.faq, "Pricing", "/pricing", 1280, 800),
    frame(
      l.pricingMobile,
      ids.branches.faq,
      "Pricing · mobile",
      "/pricing",
      402,
      874
    ),
    frame(
      l.customers,
      ids.branches.stories,
      "Customers",
      "/customers",
      1280,
      800
    ),
  ]

  const group = (
    id: string,
    name: string,
    x: number,
    y: number,
    members: IframeLayerGroupData["members"],
    sidebarOrder: number
  ): IframeLayerGroupData => ({
    id,
    name,
    x,
    y,
    gap: 48,
    members,
    sidebarOrder,
  })
  const iframe = (id: string) => ({ kind: "iframe-layer" as const, id })

  const chatSessions: ChatSessionData[] = [
    {
      id: ids.chats.stories,
      branchId: ids.branches.stories,
      label: "New chat",
      createdAt: minutesAgo(88),
    },
    {
      id: ids.chats.hero,
      branchId: ids.branches.hero,
      label: "Hero Gradient & Trust Line",
      createdAt: minutesAgo(70),
    },
    {
      id: ids.chats.faq,
      branchId: ids.branches.faq,
      label: "Pricing FAQ",
      createdAt: minutesAgo(50),
      planMode: true,
    },
  ]

  return {
    id: ids.rooms.northwind,
    name: "Northwind marketing site",
    createdAt: now - 9 * DAY,
    lastOpenedAt: minutesAgo(2),
    doc: {
      repos: [repo],
      branches,
      iframeLayers,
      markdownLayers: [
        {
          id: l.checklist,
          width: 520,
          height: 700,
          title: "Pricing launch checklist",
          // The Pricing FAQ chat wrote it (#1314), so it shows that chat.
          ownerChatId: ids.chats.faq,
        },
      ],
      iframeLayerGroups: [
        group(
          "grp-homepage",
          "Homepage",
          0,
          0,
          [iframe(l.home), iframe(l.homeMobile)],
          0
        ),
        group(
          "grp-pricing",
          "Pricing",
          0,
          1080,
          [iframe(l.pricing), iframe(l.pricingMobile)],
          1
        ),
        group(
          "grp-customers",
          "Customer stories",
          1860,
          0,
          [iframe(l.customers)],
          2
        ),
        group(
          "grp-notes",
          "Notes",
          1860,
          1080,
          [{ kind: "markdown-layer", id: l.checklist }],
          3
        ),
      ],
      chatSessions,
      plans: [
        {
          id: "plan-pricing-faq",
          chatId: ids.chats.faq,
          branchId: ids.branches.faq,
          content: FAQ_PLAN,
          status: "approved",
          toolEventId: "tool-plan-pricing-faq",
          createdAt: minutesAgo(48),
          resolvedAt: minutesAgo(46),
        },
      ],
      ...canvasFileFixtures(ids.rooms.northwind, now - DAY, [
        { folder: "research" },
        {
          path: "research/pricing-pages.md",
          mediaType: "text/markdown",
          size: 12 * 1024,
        },
        {
          path: "research/customer-quotes.md",
          mediaType: "text/markdown",
          size: 4 * 1024,
        },
        { folder: "uploads" },
        {
          path: "uploads/brand-guidelines.pdf",
          mediaType: "application/pdf",
          size: 2_200_000,
          addedById: LOCAL_USER_ID,
        },
        {
          path: "launch-plan.md",
          mediaType: "text/markdown",
          size: 3 * 1024,
        },
      ]),
      memories: [
        {
          id: "mem-northwind-tone",
          text: "Headlines are sentence case, and prices always show the monthly amount first.",
          source: "agent",
          createdAt: now - 5 * DAY,
          updatedAt: now - 5 * DAY,
        },
        {
          id: "mem-northwind-tokens",
          text: "Use the CSS variables in src/styles.css; never hard-code hex values.",
          source: "agent",
          createdAt: now - 2 * DAY,
          updatedAt: now - 2 * DAY,
        },
        {
          id: "mem-northwind-pnpm",
          text: "The site uses pnpm.",
          source: "member",
          createdAt: now - DAY,
          updatedAt: now - DAY,
        },
      ],
      savedViewport: { x: 48, y: 110, zoom: 0.262 },
      markdownBodies: { [l.checklist]: CHECKLIST },
    },
    thumbnailFrames: [
      l.home,
      l.homeMobile,
      l.pricing,
      l.pricingMobile,
      l.customers,
    ],
  }
}

/** A Canvas with one Project, one Workspace, and one Group of frames. */
function simpleRoom(spec: {
  id: string
  name: string
  folderId: string
  createdAt: number
  lastOpenedAt: number
  sandboxName: string
  colorIndex: number
  origin: (sandboxName: string) => string
  group: string
  frames: Array<[label: string, route: string, width: number, height: number]>
  /** Mockup Layers after the frames in the Group, drawn by its Workspace's chat. */
  mockups?: Array<[title: string, html: string, width: number, height: number]>
}): FixtureRoom {
  // Added from the saved "web" preset, whose name the sidebar shows.
  const repo: RepoData = {
    id: `repo-${spec.id}`,
    ...REPO_BASE,
    name: "web",
    createdAt: spec.createdAt,
    sidebarOrder: 0,
    repositoryId: "cfg-northwind-web",
    addedBy: LOCAL_USER_ID,
  }
  const branchId = `branch-${spec.sandboxName}`
  const layers: IframeLayerData[] = spec.frames.map(
    ([label, route, width, height], i) => ({
      id: `layer-${spec.sandboxName}-${i}`,
      branchId,
      label,
      route,
      width,
      height,
      iframeState: {},
    })
  )
  // The Workspace's chat, which drew the mockups (#1309).
  const chats: ChatSessionData[] = spec.mockups
    ? [
        {
          id: `chat-${spec.sandboxName}`,
          branchId,
          label: spec.group,
          createdAt: spec.createdAt,
        },
      ]
    : []
  const mockups: MockupLayerData[] = (spec.mockups ?? []).map(
    ([title, , width, height], i) => ({
      id: `mockup-${spec.sandboxName}-${i}`,
      ownerChatId: `chat-${spec.sandboxName}`,
      title,
      width,
      height,
    })
  )
  return {
    id: spec.id,
    name: spec.name,
    folderId: spec.folderId,
    createdAt: spec.createdAt,
    lastOpenedAt: spec.lastOpenedAt,
    doc: {
      repos: [repo],
      branches: [
        {
          id: branchId,
          repoId: repo.id,
          sandboxName: spec.sandboxName,
          gitUrl: repo.cloneUrl,
          ref: spec.sandboxName,
          previewDomain: spec.origin(spec.sandboxName),
          port: 5173,
          status: "running",
          createdAt: spec.createdAt,
          colorIndex: spec.colorIndex,
          sidebarOrder: 0,
          discoveredRoutes: ROUTES,
        },
      ],
      iframeLayers: layers,
      chatSessions: chats,
      mockupLayers: mockups,
      mockupHtml: Object.fromEntries(
        mockups.map((m, i) => [m.id, spec.mockups![i]![1]])
      ),
      iframeLayerGroups: [
        {
          id: `grp-${spec.sandboxName}`,
          name: spec.group,
          x: 0,
          y: 0,
          gap: 48,
          members: [
            ...layers.map((layer) => ({
              kind: "iframe-layer" as const,
              id: layer.id,
            })),
            ...mockups.map((m) => ({
              kind: "mockup-layer" as const,
              id: m.id,
            })),
          ],
          sidebarOrder: 0,
        },
      ],
      savedViewport: { x: 40, y: 80, zoom: 0.4 },
    },
    thumbnailFrames: layers.map((layer) => layer.id),
  }
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

type Message = FixtureChat["messages"][number]

/** A transcript builder: one message per call, a minute apart. */
function transcript(prefix: string, start: number) {
  const messages: Message[] = []
  let at = start
  const push = (record: AcpMessageRecord) => {
    messages.push({
      id: `${prefix}-${messages.length + 1}`,
      createdAt: at,
      record,
    })
    at += 20 * 1000
  }
  const text = (t: string) => [{ type: "text" as const, text: t }]
  let tool = 0
  const toolId = () => `${prefix}-tool-${++tool}`
  return {
    messages,
    user: (t: string) => push({ role: "user", content: text(t) }),
    agent: (t: string) => push({ role: "agent", content: text(t) }),
    read: (path: string, source: string) =>
      push({
        role: "tool_call",
        toolCallId: toolId(),
        title: "read_file",
        kind: "read",
        status: "completed",
        rawInput: { path },
        content: [
          {
            type: "content",
            content: { type: "text", text: numbered(source) },
          },
        ],
      }),
    edit: (edit: { path: string; find: string; replace: string }) =>
      push({
        role: "tool_call",
        toolCallId: toolId(),
        title: "edit_file",
        kind: "edit",
        status: "completed",
        rawInput: {
          path: edit.path,
          old_string: edit.find,
          new_string: edit.replace,
        },
        content: [
          {
            type: "diff",
            path: edit.path,
            oldText: edit.find,
            newText: edit.replace,
          },
        ],
      }),
    run: (command: string, args: string[], output: string) =>
      push({
        role: "tool_call",
        toolCallId: toolId(),
        title: "run_command",
        kind: "execute",
        status: "completed",
        rawInput: { command, args },
        content: [
          {
            type: "content",
            content: { type: "text", text: `${output}\n[exit 0]` },
          },
        ],
      }),
    documentTool: (title: string, rawInput: Record<string, unknown>) =>
      push({
        role: "tool_call",
        toolCallId: toolId(),
        title,
        kind: "edit",
        status: "completed",
        rawInput,
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      }),
    at: () => at,
  }
}

function numbered(source: string): string {
  return source
    .replace(/\n$/, "")
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
    .join("\n")
}

async function heroChat(now: number): Promise<FixtureChat> {
  const t = transcript("hero", now - 70 * MINUTE)
  const [markup, styles] = WORKSPACE_EDITS["hero-gradient-trust-line"]!
  t.user(PROMPTS.hero)
  t.agent("I'll start by looking at the hero markup and styles.")
  t.read("src/pages/Home.jsx", await readSource("src/pages/Home.jsx"))
  t.read("src/styles.css", await readSource("src/styles.css"))
  t.agent(
    "The headline is a plain `h1` inside `.hero`, and the accent comes from the `--accent` variable the Accent color knob sets. I'll add the trust line under the buttons and give the headline a gradient."
  )
  t.edit(markup!)
  t.edit(styles!)
  t.run("git", ["add", "-A"], "")
  t.run(
    "git",
    ["commit", "-m", "Gradient hero headline and trust line"],
    "[hero-gradient-trust-line 4f2c1a9] Gradient hero headline and trust line\n 2 files changed, 3 insertions(+)"
  )
  t.run(
    "git",
    ["push", "-u", "origin", "HEAD"],
    "To github.com:northwind/northwind-web.git\n * [new branch]      HEAD -> hero-gradient-trust-line\nbranch 'hero-gradient-trust-line' set up to track 'origin/hero-gradient-trust-line'."
  )
  t.agent(
    'Done — the preview has already reloaded:\n\n- **Headline** now uses a left-to-right gradient from the accent color to cyan. It follows the **Accent color** knob, so you can try other colors live.\n- **Trust line** — "Trusted by 4,000+ product teams" sits under the buttons in a muted 13px style.\n\nCommitted and pushed as `Gradient hero headline and trust line`.'
  )
  return {
    id: DOCS_IDS.chats.hero,
    roomId: DOCS_IDS.rooms.northwind,
    sandboxName: "hero-gradient-trust-line",
    model: "harness:claude-code:opus",
    systemPrompt: "",
    createdAt: now - 70 * MINUTE,
    messages: t.messages,
  }
}

async function faqChat(now: number): Promise<FixtureChat> {
  const start = now - 50 * MINUTE
  const t = transcript("faq", start)
  const [markup, styles] = WORKSPACE_EDITS["pricing-faq"]!
  t.user(PROMPTS.faq)
  t.agent("Let me look at the pricing page first.")
  t.read("src/pages/Pricing.jsx", await readSource("src/pages/Pricing.jsx"))
  // The plan card is placed in the timeline by its own timestamp: after the
  // read above, before the approval that resumed the run.
  const planAt = t.at()
  // Leave room for the plan card, then the approval that resumed the run.
  const resumed = transcript("faq-resume", planAt + 60 * 1000)
  resumed.user("Approved the plan. Proceed with the implementation.")
  resumed.agent("Great — implementing the plan now.")
  resumed.edit(markup!)
  resumed.edit(styles!)
  resumed.run("git", ["add", "-A"], "")
  resumed.run(
    "git",
    ["commit", "-m", "Add pricing FAQ"],
    "[pricing-faq 91d0e37] Add pricing FAQ\n 2 files changed, 11 insertions(+)"
  )
  resumed.run(
    "git",
    ["push", "-u", "origin", "HEAD"],
    "To github.com:northwind/northwind-web.git\n * [new branch]      HEAD -> pricing-faq\nbranch 'pricing-faq' set up to track 'origin/pricing-faq'."
  )
  resumed.agent(
    "The FAQ is live below the plan cards — four questions, each a native `<details>` element, styled to match the page. Committed and pushed as `Add pricing FAQ`."
  )
  return {
    id: DOCS_IDS.chats.faq,
    roomId: DOCS_IDS.rooms.northwind,
    sandboxName: "pricing-faq",
    model: "harness:claude-code:opus",
    systemPrompt: "",
    createdAt: start,
    messages: [...t.messages, ...resumed.messages],
    pendingPlan: {
      runId: "run-pricing-faq",
      toolCallId: "tool-plan-pricing-faq",
      plan: FAQ_PLAN,
      createdAt: planAt,
      status: "approved",
    },
  }
}

// ---------------------------------------------------------------------------
// Project presets
// ---------------------------------------------------------------------------

function repoConfigs(now: number): RepoConfig[] {
  return [
    {
      id: "cfg-northwind-web",
      ...REPO_BASE,
      envVars: "",
      name: "web",
      private: true,
      createdAt: now - 9 * DAY,
      updatedAt: now - 2 * DAY,
    },
  ]
}

const VOICE_AND_TONE = `# Voice and tone

- Plain sentences. Say what something does, not how clever it is.
- Buttons are one or two words: Save, Add repository.
- Lead with the answer; cut anything that doesn't change what the reader does next.
`

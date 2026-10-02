import type { Page } from "playwright-core"

import { roomChatId } from "@/lib/chat/room-chat"
import type { BranchData } from "@/lib/types"
import { queuedForWorkspaceResult } from "@/lib/agent/workspace-task"

import { COLD_WORKSPACE_PREFIX, previewDomainFor } from "../../lib/preview-url"
import { resolveCaptureProfile } from "../../profile"
import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  serveYjsDoc,
  gettingStartedRepo,
  openChatsMenu,
  type RunEvent,
  replayRun,
  text,
  newWorkspaceButton,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-getting-started",
    description:
      "The first Canvas after setup: the chat panel open on Add a repository, and the getting-started checklist on its first step (#1182).",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: (page) => markGettingStarted(page, ids.rooms.empty),
    settleMs: 400,
  },
  {
    name: "canvas-add-repository",
    description:
      "Add a repository on the empty canvas goes straight to Open folder / Open GitHub repository, not Canvas settings (#1182).",
    path: `/${ids.rooms.empty}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Add a repository" })
        .first()
        .click()
      await page.waitForTimeout(600)
    },
    settleMs: 300,
  },
  {
    name: "canvas-getting-started-ask",
    description:
      "Just after adding a repository: its fresh Workspace running in a frame, the Coordinator asking what should change, and the checklist on Ask the Coordinator (#1182).",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: async (page) => {
      await markGettingStarted(page, ids.rooms.empty)
      await serveFreshWorkspace(page, { status: "running" })
    },
    prepare: async (page) => {
      await page
        .getByText(/What should change|Ask about this canvas/)
        .first()
        .waitFor({ timeout: 30_000 })
    },
    settleMs: 800,
  },
  {
    name: "canvas-getting-started-open",
    description:
      "The first ask sent while the Workspace is still starting: the checklist on Open the Workspace (#1182).",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: async (page) => {
      await markGettingStarted(page, ids.rooms.empty)
      await serveFreshWorkspace(page, {
        status: "starting",
        statusMessage: "Installing dependencies…",
        pendingSeed: {
          chatId: "chat-first",
          message: "Make the header sticky",
          coordinatorChatId: roomChatId(ids.rooms.empty),
        },
      })
    },
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText(/What should change|Ask about this canvas/)
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.empty), firstAskRun())
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "canvas-getting-started-done",
    description:
      "The getting-started checklist with every step done, on a Canvas with a running frame.",
    path: `/${ids.rooms.frameStates}`,
    beforeNavigate: (page) => markGettingStarted(page, ids.rooms.frameStates),
    settleMs: 400,
  },
  {
    name: "workspaces-menu-no-projects",
    description:
      "The Chats menu on a Canvas with no repository: why, and Add repository (#884, #1152).",
    path: `/${ids.rooms.tokens}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      const menu = await openChatsMenu(page)
      await menu
        .getByRole("button", { name: "Add repository", exact: true })
        .waitFor({ timeout: 15_000 })
      await page.mouse.move(900, 900)
    },
    settleMs: 300,
  },
  {
    name: "canvas-chat-no-projects",
    description:
      "The chat panel's empty state on a Canvas with no Project attached.",
    path: `/${ids.rooms.tokens}`,
    cookies: canvasPanels({ chatPct: 30 }),
    settleMs: 400,
  },
  {
    name: "frame-workspace-picker",
    description:
      "An unbound frame's Workspace picker, opened from its label on the canvas.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      // Matches the copy on both sides of the #723 rename so a before/after
      // pair shoots the same state.
      await page
        .getByRole("button", { name: /^Choose a (branch|workspace)$/ })
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "dialog-new-workspace",
    description:
      "The prompt-first Create workspaces dialog, from the Chats menu's New chat (+).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.click())
    },
    settleMs: 400,
  },
  {
    name: "dialog-new-workspace-two-repos",
    description:
      "Create workspaces on a canvas with two repositories: a repository chip beside each row's base branch (#884).",
    path: `/${ids.rooms.pricing}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await newWorkspaceButton(page).then((b) => b.click())
      await page.getByRole("dialog").waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
]

export default screens

/**
 * Mark a Canvas as the first one after setup, as Finish does, so it shows the
 * getting-started checklist (#780).
 */
async function markGettingStarted(page: Page, roomId: string): Promise<void> {
  await page.addInitScript(
    ([key, id]) => localStorage.setItem(key!, id!),
    ["screenplay:getting-started-canvas", roomId]
  )
}

/**
 * A Canvas just after its first repository was added (#1182): the fresh
 * Workspace adding it started, untitled, with its frame in a Group.
 */
function serveFreshWorkspace(
  page: Page,
  branch: Partial<BranchData>
): Promise<void> {
  const running = branch.status === "running"
  const sandboxName = running
    ? "storefront"
    : `${COLD_WORKSPACE_PREFIX}storefront`
  return serveYjsDoc(page, (c) => {
    c.repos.set(gettingStartedRepo.id, gettingStartedRepo)
    c.branches.set("branch-first", {
      id: "branch-first",
      repoId: gettingStartedRepo.id,
      sandboxName,
      gitUrl: gettingStartedRepo.cloneUrl,
      ref: "quiet-harbor",
      previewDomain: running
        ? previewDomainFor(resolveCaptureProfile().previewOrigin, sandboxName)
        : "",
      port: 3000,
      status: "running",
      createdAt: Date.now() - 40_000,
      createFlow: "new",
      sidebarOrder: 0,
      ...branch,
    })
    c.chatSessions.set("chat-first", {
      id: "chat-first",
      branchId: "branch-first",
      label: "Untitled",
      createdAt: Date.now() - 40_000,
    })
    c.iframeLayers.set("layer-first", {
      id: "layer-first",
      branchId: "branch-first",
      width: 1280,
      height: 800,
      label: "storefront",
      iframeState: {},
      route: "/",
    })
    c.iframeLayerGroups.set("grp-first", {
      id: "grp-first",
      x: 0,
      y: 0,
      members: [{ kind: "iframe-layer", id: "layer-first" }],
      sidebarOrder: 0,
    })
    c.savedViewport.set({ x: 120, y: 140, zoom: 0.5 })
  })
}

/**
 * A finished Coordinator turn that messaged two Workspaces on the checkout
 * canvas: its reply, one `send_to_workspace` call per Workspace (task rows),
 * and a closing line.
 */
/**
 * The first ask on a fresh canvas (#1182): the Coordinator hands it to the
 * Workspace adding the repository started, which gets it once it runs.
 */
function firstAskRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Make the header sticky"),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-send-first",
        title: "send_to_workspace",
        status: "completed",
        rawInput: {
          workspace_id: "branch-first",
          message: "Make the header sticky",
        },
        content: [
          {
            type: "content",
            content: text(
              queuedForWorkspaceResult("New Workspace", "chat-first")
            ),
          },
        ],
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "Sent to the Workspace on the canvas. It starts as soon as the app is running."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

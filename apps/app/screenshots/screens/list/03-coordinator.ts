import { roomChatId } from "@/lib/chat/room-chat"
import {
  createdWorkspacesResult,
  sentToWorkspaceResult,
} from "@/lib/agent/workspace-task"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  openChatTab,
  type RunEvent,
  replayRun,
  text,
  DELEGATED_STICKY,
  coordinatorWakeRun,
  coordinatorWakeRunningRun,
  delegatedWorkspaceRun,
  expandTurnSummaries,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "chat-coordinator",
    description:
      "The chat panel's home with no Workspace selected: the canvas's Coordinator chat, empty (#893).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-answer",
    description:
      'The Coordinator answering "What\'s on this canvas?" from its read-canvas tool (#893).',
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), coordinatorRun())
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-harness",
    description:
      "A finished Coordinator turn on the Claude harness, steps open: its MCP tools labelled by their own names, Claude Code's ToolSearch left out.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        harnessCoordinatorRun({ finished: true })
      )
      await page.getByTestId("turn-summary-trigger").first().click()
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-harness-running",
    description:
      "The same Coordinator turn on the Claude harness while it runs.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        harnessCoordinatorRun({ finished: false })
      )
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-undo",
    description:
      "The Coordinator removing a frame and a document, then undoing it when asked, with both turns' steps open (#894).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        coordinatorUndoRun()
      )
      await expandTurnSummaries(page)
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-tasks",
    description:
      "The Coordinator's task rows after it messaged two Workspaces: one working, one waiting on a plan (#896).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), delegationRun())
      // Checkout polish's turn is under way; Empty cart state's plan waits.
      await replayRun(page, ids.chats.checkoutPolish, [
        { type: "chat-stream-start" },
      ])
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-tasks-done",
    description:
      "The same chat cards once Checkout polish's turn ended: Ready, with its changed lines (#896, #1318).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), delegationRun())
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-wake",
    description:
      "The Coordinator after Workspace turns ended: a result and a plan waiting on you, each linking its Workspace; a quiet wake in between shows nothing (#897).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), [
        ...delegationRun(),
        ...coordinatorWakeRun(),
      ])
      await page
        .getByTestId("workspace-link")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-wake-running",
    description:
      "The Coordinator catching up on a Workspace whose turn just ended: a quiet status line, no wake message or live steps (#897).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), [
        ...delegationRun(),
        ...coordinatorWakeRunningRun(),
      ])
      await page
        .getByTestId("run-in-progress")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-workspaces-created",
    description:
      "The Coordinator starting two Workspaces straight away: a task row per Workspace, one starting and one that failed to start (#898, #1217).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      const chatId = roomChatId(ids.rooms.checkout)
      await replayRun(page, chatId, workspacesCreatedRun())
      await page
        .getByTestId("workspace-task")
        .first()
        .waitFor({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-pr-and-remove",
    description:
      "The Coordinator opening a Workspace's pull request and removing another straight away, each shown as one line saying what it did (#901, #1217).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      const chatId = roomChatId(ids.rooms.checkout)
      await replayRun(page, chatId, pullRequestAndRemoveRun())
      await page.getByText('Removed "gift-cards"').first().waitFor()
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-refused-pr",
    description:
      "The Coordinator declining to open a pull request a Workspace already has: the refusal reads as the row's outcome, not a failed step (#1231).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.checkout), refusedPrRun())
      await expandTurnSummaries(page)
    },
    settleMs: 400,
  },
  {
    name: "chat-delegated-message",
    description:
      'A Workspace chat the Coordinator messaged: the collapsed "Received a message from the Coordinator" row, then the agent\'s reply (#896).',
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, delegatedWorkspaceRun())
    },
    settleMs: 400,
  },
  {
    name: "chat-delegated-message-open",
    description:
      "The Delegated Message row opened to the Coordinator's message (#896).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, delegatedWorkspaceRun())
      await page
        .getByRole("button", {
          name: "Received a message from the Coordinator",
        })
        .first()
        .click({ timeout: 15_000 })
    },
    settleMs: 400,
  },
  {
    name: "chat-coordinator-breadcrumb",
    description:
      "A Workspace's chat header: the Coordinator crumb before the Workspace pill, hovered (#893).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await page
        .getByRole("button", { name: "Coordinator", exact: true })
        .hover({ timeout: 15_000 })
    },
    settleMs: 400,
  },
]

export default screens

/**
 * A finished Coordinator turn on the checkout canvas: the question, a
 * `read_canvas` call, and an answer that matches the fixture world.
 */
function coordinatorRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("What's on this canvas?"),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-read-canvas",
        title: "read_canvas",
        kind: "read",
        status: "completed",
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          [
            "Four Workspaces on acme/storefront:",
            "",
            "- **Checkout polish**: +214 −37, PR #482 open",
            "- **Empty cart state**: +46 −4, no PR yet",
            "- **Apple Pay button**: still starting",
            "- **gift-cards**: setup failed",
            "",
            "There are four frames (checkout on desktop and iPhone, the empty cart, and one with no Workspace) and one document, Checkout brief.",
          ].join("\n")
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * A Coordinator turn on the Claude harness, which reaches our tools over MCP:
 * claude-agent-acp titles each call `mcp__screenplay__<tool>` (kind "other",
 * its input as a JSON block until the result lands), after Claude Code's own
 * `ToolSearch` loads them. `finished: false` stops before the reply.
 */
function harnessCoordinatorRun({
  finished,
}: {
  finished: boolean
}): RunEvent[] {
  const call = (
    toolCallId: string,
    title: string,
    rawInput: Record<string, unknown>,
    result: string
  ): RunEvent[] => [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        kind: "other",
        status: "pending",
        rawInput,
        content: [
          {
            type: "content",
            content: text(
              "```json\n" + JSON.stringify(rawInput, null, 2) + "```"
            ),
          },
        ],
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "completed",
        content: [{ type: "content", content: text(result) }],
      },
    },
  ]
  const steps: RunEvent[] = [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          "What's on this canvas, and which Workspaces are behind?"
        ),
      },
    },
    { type: "chat-stream-start" },
    ...call(
      "harness-tool-search",
      "ToolSearch",
      {
        query:
          "select:mcp__screenplay__read_canvas,mcp__screenplay__list_changes",
      },
      "Loaded 2 tools."
    ),
    ...call(
      "harness-read-canvas",
      "mcp__screenplay__read_canvas",
      {},
      'Canvas "Checkout flow": 4 Workspaces, 4 frames, 1 document.'
    ),
    ...call(
      "harness-list-changes",
      "mcp__screenplay__list_changes",
      {},
      "No changes yet."
    ),
  ]
  if (!finished) return steps
  return [
    ...steps,
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "Four Workspaces on acme/storefront. **Checkout polish** has PR #482 open, **Empty cart state** has no PR yet, **Apple Pay button** is still starting and **gift-cards** failed setup."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

function delegationRun(): RunEvent[] {
  const send = (
    toolCallId: string,
    branchId: string,
    title: string,
    chatId: string,
    message: string
  ): RunEvent => ({
    type: "chat-acp-update",
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "send_to_workspace",
      status: "completed",
      rawInput: { workspace_id: branchId, message },
      content: [
        {
          type: "content",
          content: text(sentToWorkspaceResult(title, chatId)),
        },
      ],
    },
  })
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          "Pin the order summary on mobile in Checkout polish, and add a Continue shopping link to the empty cart."
        ),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text("Those belong to two Workspaces, so I sent one to each."),
      },
    },
    send(
      "fixture-send-checkout",
      ids.branches.checkoutPolish,
      "Checkout polish",
      ids.chats.checkoutPolish,
      DELEGATED_STICKY
    ),
    send(
      "fixture-send-empty-cart",
      ids.branches.emptyCart,
      "Empty cart state",
      "chat-empty-cart",
      "Add a Continue shopping link under the empty cart message."
    ),
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "\n\nEmpty cart state is still waiting for you to approve its plan, so it will pick this up after that. I'll tell you when they're done or need you."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * A Coordinator turn that splits an ask into two new Workspaces and starts
 * them straight away (#898, #1217): a chat card per Workspace with the message
 * it started on (#1318), one starting and one that failed to start. The two stand in for the checkout canvas's Apple
 * Pay and Gift cards Workspaces.
 */
function workspacesCreatedRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          "Add Apple Pay to checkout, and let people pay with a gift card."
        ),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "No Workspace covers either yet, so I'll start one for each."
        ),
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-create-workspaces",
        title: "create_workspaces",
        status: "completed",
        rawInput: {
          workspaces: [
            {
              title: "Apple Pay button",
              repository: "acme/storefront",
              prompt:
                "Add an Apple Pay button above the card form at checkout.",
            },
            {
              title: "Gift cards",
              repository: "acme/storefront",
              prompt: "Let people pay with a gift card code at checkout.",
            },
          ],
        },
        content: [
          {
            type: "content",
            content: text(
              createdWorkspacesResult([
                {
                  title: "Apple Pay button",
                  repository: "acme/storefront",
                  branchId: ids.branches.applePay,
                },
                {
                  title: "Gift cards",
                  repository: "acme/storefront",
                  branchId: ids.branches.giftCards,
                  error: "the setup script failed",
                },
              ])
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
          "Apple Pay button is starting. Gift cards failed to start because its setup script failed; its row offers Retry."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * A Coordinator turn that opens Empty cart state's pull request and removes
 * gift-cards straight away (#901, #1217). Each call's row is the line saying
 * what it did.
 */
function pullRequestAndRemoveRun(): RunEvent[] {
  const call = (
    toolCallId: string,
    title: string,
    workspaceId: string,
    result: string
  ): RunEvent => ({
    type: "chat-acp-update",
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title,
      status: "completed",
      rawInput: { workspace_id: workspaceId },
      content: [{ type: "content", content: text(result) }],
    },
  })
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(
          "Empty cart state looks good, open a PR for it. And remove gift-cards, it never started."
        ),
      },
    },
    { type: "chat-stream-start" },
    call(
      "fixture-open-pull-request",
      "open_pull_request",
      ids.branches.emptyCart,
      'Opened PR #483 for "Empty cart state": https://github.com/acme/storefront/pull/483'
    ),
    call(
      "fixture-remove-workspace",
      "remove_workspace",
      ids.branches.giftCards,
      'Removed "gift-cards": its sandbox.'
    ),
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "Opened [PR #483](https://github.com/acme/storefront/pull/483) for Empty cart state, and removed gift-cards."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * A Coordinator turn whose open_pull_request refused, since the Workspace
 * already has a PR: the call completes with the reason (#1231).
 */
function refusedPrRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Open a PR for Empty cart state."),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_refused_pr",
        title: "open_pull_request",
        status: "completed",
        rawInput: { workspace_id: ids.branches.emptyCart },
        content: [
          {
            type: "content",
            content: text('"Empty cart state" already has PR #483 open.'),
          },
        ],
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "Empty cart state already has [PR #483](https://github.com/acme/storefront/pull/483) open, so there's nothing new to open."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * Two Coordinator turns on the checkout canvas: it removes a frame and a
 * document right away, then puts them back when asked to undo (#894).
 */
function coordinatorUndoRun(): RunEvent[] {
  const turn = (
    ask: string,
    tool: {
      id: string
      title: string
      kind: "delete" | "edit"
      result: string
    },
    answer: string
  ): RunEvent[] => [
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "user_message_chunk", content: text(ask) },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: tool.id,
        title: tool.title,
        kind: tool.kind,
        status: "completed",
        content: [{ type: "content", content: text(tool.result) }],
      },
    },
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "agent_message_chunk", content: text(answer) },
    },
    { type: "chat-stream-end" },
  ]
  return [
    ...turn(
      "Clear out the frame with no Workspace and the Checkout brief.",
      {
        id: "fixture-remove",
        title: "remove",
        kind: "delete",
        result: 'Removed frame "Untitled frame", document "Checkout brief".',
      },
      "Removed the blank frame and the Checkout brief."
    ),
    ...turn(
      "Actually, undo that.",
      {
        id: "fixture-undo",
        title: "undo_changes",
        kind: "edit",
        result:
          'Undid: removed frame "Untitled frame", document "Checkout brief".\nIds: fixture-turn',
      },
      "Put the blank frame and the Checkout brief back, exactly as they were."
    ),
  ]
}

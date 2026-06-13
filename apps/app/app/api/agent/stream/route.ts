import { after } from "next/server"
import { getUserId } from "@/lib/auth-helpers"
import { buildAgentSystemPrompt } from "@/lib/agent/config"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import { toolsetFor } from "@/lib/agent/toolset"
import type { ToolContext } from "@/lib/agent/tools"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"
import {
  agentChatTarget,
  loadLayerDirectory,
  markdownLayerChatTarget,
  prepareChatTarget,
} from "@/lib/agent/chat-target-kinds"
import { DEFAULT_MODEL } from "@/lib/agent/providers"
import {
  appendAcpMessage,
  findPendingPlanForChat,
  loadAcpHistory,
  upsertChat,
} from "@/lib/agent/persistence"
import { resolvePlan, startRun } from "@/lib/agent/run-state"
import { broadcastAcpUpdate, broadcastControl } from "@/lib/agent/broadcast"
import { broadcastSignal } from "@/lib/agent/broadcast"
import { resolveLiveEngine } from "@/lib/agent/acp/resolve-live-engine"
import { wireToContentBlocks } from "@/lib/agent/acp/markers"
import { userMessageChunk } from "@/lib/agent/acp/schema"
import { launchEngineTurn } from "@/lib/agent/launch-turn"
import { deduplicateBranchName, generateChatNames } from "@/lib/agent/naming"

export const runtime = "nodejs"
export const maxDuration = 300

interface RequestBody {
  roomId: string
  chatId: string
  /** Required when the chat targets an agent (sandbox-backed flow). */
  sandboxName?: string
  branch?: string
  /** Required when the chat targets a document layer (no sandbox). */
  markdownLayerId?: string
  message: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  model?: string
}

export async function POST(req: Request) {
  const userId = await getUserId()
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const body: RequestBody = await req.json()
  const {
    roomId,
    chatId,
    sandboxName,
    branch,
    markdownLayerId,
    message,
    isFirstChat,
    autoNamedBranch,
    planMode,
    model,
  } = body
  if (!roomId || !chatId || !message) {
    return new Response("Missing required fields", { status: 400 })
  }
  if (!markdownLayerId && !sandboxName) {
    return new Response("Missing target: markdownLayerId or sandboxName", {
      status: 400,
    })
  }

  // Resolve the engine once `sandboxName` is known: the external engine
  // (`AGENT_ENGINE=external`, desktop) spawns the harness adapter in that
  // Branch's worktree, so its cwd depends on the turn. Resolved before any
  // side effects so a misconfigured deployment still fails loud at the boundary
  // — a 500 here — rather than silently falling back (ADR 0006). In-process
  // (the hosted default) ignores `sandboxName` entirely. On the external engine
  // the chat's `model` id (a `harness:` id) picks which adapter to spawn (#479).
  const engine = await resolveLiveEngine({ sandboxName, chatId, model })

  // Persist the incoming user turn as an ACP-native `user` record — the
  // decorated wire text (plan/branch markers + `@`-mention `resource_link`s)
  // encoded to content blocks. The matching live echo is broadcast *after*
  // `chat-stream-start` (below), inside the replay window, so a client joining
  // mid-stream still sees the user message.
  const persistUserTurn = (chatId: string, userText: string) =>
    appendAcpMessage(chatId, {
      role: "user",
      content: wireToContentBlocks(userText),
    })

  // Layer-targeted chats defer all of their kind-specific bits — system
  // prompt, tools, message decoration — to a registered `ChatTargetSpec`.
  // Adding a new chat-targetable kind means shipping a spec and a route
  // branch; the surrounding seam is unchanged.
  const layerChat: {
    spec: typeof markdownLayerChatTarget
    target: { markdownLayerId: string }
  } | null = markdownLayerId
    ? { spec: markdownLayerChatTarget, target: { markdownLayerId } }
    : null
  if (layerChat) {
    const prepared = await prepareChatTarget(
      roomId,
      // The discriminating union above keeps spec/target paired; cast through
      // `never` so prepareChatTarget's generic doesn't try to unify them.
      layerChat.spec as unknown as Parameters<typeof prepareChatTarget>[1],
      layerChat.target as unknown as never
    )
    if (!prepared) return new Response("Layer not found", { status: 404 })

    const effectiveModel = model || DEFAULT_MODEL
    await upsertChat({
      chatId,
      roomId,
      // No sandbox — pass an empty string so the persistence layer's NOT NULL
      // constraint is satisfied; it's never read back for layer chats.
      sandboxName: "",
      model: effectiveModel,
      systemPrompt: prepared.systemPrompt,
    })

    const userText = prepared.decorateUserMessage(message, {
      planMode,
      isFirstMessage: false,
    })
    await persistUserTurn(chatId, userText)

    const runId = await startRun(chatId)
    await broadcastSignal(roomId, chatId, "chat-stream-start")
    await broadcastAcpUpdate(roomId, chatId, userMessageChunk(message))

    after(() =>
      launchEngineTurn({
        engine,
        roomId,
        chatId,
        runId,
        systemPrompt: prepared.systemPrompt,
        model: effectiveModel,
        tools: prepared.tools,
        planMode,
      })
    )

    return Response.json({ chatId, runId })
  }

  // Below this line: agent-targeted (sandbox) flow. `sandboxName` is
  // guaranteed by the early-return above.
  if (!sandboxName) {
    return new Response("Missing sandboxName for agent-targeted chat", {
      status: 400,
    })
  }

  // First-message check: a chat is "new" if it has no prior ACP-native records.
  // More reliable than the client-supplied `isFirstChat`.
  const isNewChat = (await loadAcpHistory(chatId)).length === 0

  const effectiveModel = model || DEFAULT_MODEL
  const toolCtx: ToolContext = { sandboxName, roomId, userId }

  // Repo-scoped optional system prompt + the merged App∪Repo Skill index. The
  // Skill index is enumerated once here, at chat init, from this Branch's
  // sandbox (`.claude/skills/`) and baked into the per-Agent prompt — one
  // sandbox round-trip per new chat.
  const [repoSystemPrompt, layerDirectory, skills] = await Promise.all([
    readRoomDoc(roomId, ({ branches, repos }) => {
      const branch = branches
        .toArray()
        .find((a) => a.sandboxName === sandboxName)
      if (!branch) return undefined
      return repos.get(branch.repoId)?.systemPrompt
    }).catch(() => undefined),
    loadLayerDirectory(roomId),
    getMergedSkillIndexForSandbox(sandboxName),
  ])

  const systemPrompt = buildAgentSystemPrompt({
    repoSystemPrompt: repoSystemPrompt ?? undefined,
    layerDirectory,
    skills,
  })

  await upsertChat({
    chatId,
    roomId,
    sandboxName,
    model: effectiveModel,
    systemPrompt,
  })

  // First-message branch + chat-label naming so chats get auto-named without
  // the user picking a branch. The rename broadcasts are deferred until after
  // `chat-stream-start` below: clients replay events back to the most recent
  // start marker, and the event array is trimmed on each start — so anything
  // emitted before the start is skipped and then deleted. We compute the names
  // here (the branch marker baked into the user message needs `effectiveBranch`)
  // but broadcast later.
  let effectiveBranch = branch
  let renamedBranch = ""
  let renamedLabel = ""
  // Every new chat earns an auto-generated label (gated only on `isNewChat`).
  // The *branch* rename is narrower: only the first chat on the branch, and
  // only while the branch is still auto-named — a later chat must not rename
  // the shared branch out from under its siblings.
  if (isNewChat) {
    const shouldNameBranch = autoNamedBranch !== false && isFirstChat !== false
    const { branch: rawBranch, chatLabel } = await generateChatNames({
      message,
      shouldNameBranch,
      model: effectiveModel,
    })
    if (shouldNameBranch && rawBranch) {
      effectiveBranch = await deduplicateBranchName(roomId, rawBranch, userId)
      renamedBranch = effectiveBranch
    }
    if (chatLabel) {
      renamedLabel = chatLabel
      // Persist the label directly so it survives a client re-render that
      // momentarily clears the broadcast callback.
      await mutateRoomDoc(roomId, ({ chatSessions }) => {
        chatSessions.update(chatId, { label: chatLabel })
      })
    }
  }

  // If the user sent a follow-up message while a submit_plan is still awaiting
  // approval, treat it as an implicit rejection: resolve the plan (marking it
  // rejected and superseding its paused run) and flip the plan card. The
  // follow-up message itself becomes the next user turn below — the revision
  // instruction — so no separate resolution record is appended here.
  const pendingPlan = await findPendingPlanForChat(chatId)
  if (pendingPlan) {
    await resolvePlan(pendingPlan.id, { approved: false, feedback: message })
    await broadcastControl(roomId, chatId, {
      kind: "plan_resolved",
      planId: pendingPlan.id,
      approved: false,
    })
  }

  // Append the user message with the plan/branch markers the agent's system
  // prompt looks for. The Chat Target spec owns the policy (branch only on the
  // first message) and delegates the format to the Message Markers codec —
  // there is exactly one encode path.
  const userText = agentChatTarget.decorateUserMessage!(message, {
    planMode,
    branch: effectiveBranch,
    isFirstMessage: isNewChat,
  })
  await persistUserTurn(chatId, userText)

  const runId = await startRun(chatId)
  await broadcastSignal(roomId, chatId, "chat-stream-start")
  await broadcastAcpUpdate(roomId, chatId, userMessageChunk(message))

  // Now that the start marker is in place, emit the first-message rename
  // controls — they land inside the replay window so live and late-joining
  // clients both pick them up.
  if (renamedBranch) {
    await broadcastControl(roomId, chatId, {
      kind: "branch_rename",
      branch: renamedBranch,
    })
  }
  if (renamedLabel) {
    await broadcastControl(roomId, chatId, {
      kind: "chat_rename",
      label: renamedLabel,
    })
  }

  // Drive the turn in the background and return immediately — the client
  // receives state via the Y.Doc broadcast channel.
  after(() =>
    launchEngineTurn({
      engine,
      roomId,
      chatId,
      runId,
      systemPrompt,
      model: effectiveModel,
      tools: toolsetFor({ kind: "sandbox", roomId, sandbox: toolCtx }),
      planMode,
    })
  )

  return Response.json({ chatId, runId })
}

import { useCallback, useMemo } from "react"
import { nanoid } from "nanoid"
import { toast } from "sonner"

import { dispatchPrompt, resolveTargetChat } from "@/lib/chat/agent-prompt"
import {
  routeBranchAction,
  type BranchActionKind,
  type RecoveryKind,
} from "@/lib/branch/actions"
import {
  type BranchRecoveryDeps,
  markDone as markDoneRecovery,
  recreate as recreateBranchRecovery,
  reopen as reopenRecovery,
  restartDevServer as restartDevServerRecovery,
  restartSandbox as restartSandboxRecovery,
  runDevServer as runDevServerRecovery,
  stopDevServer as stopDevServerRecovery,
  startWorkspace as startWorkspaceRecovery,
  type RecoveryOutcome,
} from "@/lib/branch/recovery"
import {
  countWorkspaceFrames,
  markedDoneMessage,
} from "@/lib/canvas/done-workspaces"
import { createPullRequestAction } from "@/lib/create-pr-action"
import type { BranchPrInfo } from "@/lib/github-actions"
import { isLocalBuild } from "@/lib/local-mode"
import { openExternal } from "@/lib/open-external"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  RepoData,
} from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import type { ChatTarget } from "@/components/canvas/use-chat-target"

/**
 * Branch Actions controller (PRD #577, Module A) — the apply-side of the Branch
 * menu's git / sandbox-lifecycle family, lifted out of
 * `components/canvas/canvas.tsx`. The component's branch-menu handlers shrink to
 * thin calls into the verbs this hook returns; the conflict-risk routing
 * (ADR 0005) lives in the pure core (`lib/branch/actions.ts`) and the apply
 * choreography lives here.
 *
 * Each verb routes through {@link routeBranchAction} and applies the result:
 *
 *  - `engine` (Rebase on the default branch) → **Module B's `dispatchPrompt`**:
 *    resolve the target chat (reuse-or-bump), then dispatch the rebase prompt so
 *    conflicts are walked through conversationally.
 *  - `action` (Create PR) → the deterministic `createPullRequestAction`, the
 *    success / error toast, and the immediate PR source-of-truth write so the
 *    sidebar icon, branch menu, and chat button reflect the open PR now.
 *  - `recovery` (restart dev server / restart sandbox / recreate) → the matching
 *    `lib/branch/recovery` runner over the injected seams.
 *
 * The "Recreate from scratch" confirm stays at the trigger (the sidebar
 * AlertDialog); this controller trusts that gate and does not re-prompt. The
 * canvas-navigation handlers (play, add-frame, show-routes) are a different
 * concern and are deliberately not part of this controller.
 */
export interface BranchActionsDeps {
  agents: BranchData[]
  repos: RepoData[]
  chatSessions: ChatSessionData[]
  /** Every frame and Group in the Room doc, Done ones included. */
  iframeLayers: IframeLayerData[]
  iframeLayerGroups: IframeLayerGroupData[]
  roomId: string
  /** The Chat-Target controller — remembered-chat lookup + dispatch selection. */
  chatTarget: ChatTarget
  /** Create a Chat Session through the canvas ops seam (ADR 0001). */
  addChatSession: (id: string, data: ChatSessionData) => void
  updateAgentInStorage: (id: string, patch: Partial<BranchData>) => void
  /** Optimistic PR source-of-truth write (the BranchPrs handle). */
  setBranchPr: (branchId: string, pr: BranchPrInfo) => void
}

export interface BranchActions {
  /** Rebase the branch onto the repo's default branch, conversationally. */
  rebaseOnDefault: (agentId: string) => void
  /** Open a GitHub PR for the branch — the deterministic server action. */
  createPullRequest: (agentId: string) => void
  /** Bounce the dev server in place (the only recovery usable mid-turn). */
  restartDevServer: (agentId: string) => void
  /** Stop the dev server, leaving the Sandbox running (#1342). */
  stopDevServer: (agentId: string) => Promise<void>
  /** Start a stopped dev server again (#1342). */
  runDevServer: (agentId: string) => Promise<void>
  /** Snapshot-restore onto a fresh VM, preserving the working tree. */
  restartSandbox: (agentId: string) => void
  /** A frame's Retry / Start on a failed or stopped Workspace (issue #731). */
  startWorkspace: (agentId: string) => void
  /**
   * Mark the Workspace Done: stop its sandbox, hide its frames (#976), and say
   * so in a toast whose Undo reopens it.
   */
  markDone: (agentId: string) => void
  /** Undo Mark as done: start it again and show its frames where they were. */
  reopen: (agentId: string) => void
  /**
   * Destructive reclone — runs only after the sidebar's confirm, which awaits
   * it. Rejects with the failure so the confirm can show it inline.
   */
  recreate: (agentId: string) => Promise<void>
  /**
   * Ask the Workspace's agent to address comment threads (#788), in its chat
   * without switching the chat panel to it. False when the Workspace has no
   * running agent to ask.
   */
  sendComments: (
    agentId: string,
    message: string,
    threadIds: string[]
  ) => boolean
}

export function useBranchActions(deps: BranchActionsDeps): BranchActions {
  const {
    agents,
    repos,
    chatSessions,
    iframeLayers,
    iframeLayerGroups,
    roomId,
    chatTarget,
    addChatSession,
    updateAgentInStorage,
    setBranchPr,
  } = deps

  // The seams the Branch recovery verbs run over: the agent + repo lookups, the
  // agent-store patch, and a sonner toast adapter. Rebuilt when the inputs
  // change so each verb sees the current Branch / Repo state.
  const recoveryDeps = useMemo<BranchRecoveryDeps>(
    () => ({
      findAgent: (id) => agents.find((a) => a.id === id),
      findRepo: (repoId) => repos.find((w) => w.id === repoId),
      patchAgent: updateAgentInStorage,
      toast: {
        success: (message) => toast.success(message),
        error: (message, description) =>
          toast.error(message, description ? { description } : undefined),
      },
    }),
    [agents, repos, updateAgentInStorage]
  )

  // engine route → Module B's dispatch: send the prompt in the Workspace's one
  // chat (#1315) with the rename callbacks wired.
  const applyEngine = useCallback(
    (
      prompt: string,
      agent: BranchData,
      options: { commentThreadIds?: string[] } = {}
    ): boolean => {
      const decision = resolveTargetChat({
        roomId,
        freshChatId: nanoid(),
        createdAt: Date.now(),
        message: prompt,
        agent,
        chatSessions,
      })
      if (decision.kind === "none") return false

      // A comment request stays out of the way: the comments panel shows its
      // progress, so the chat panel keeps whatever it was showing.
      const quiet = !!options.commentThreadIds
      dispatchPrompt(
        {
          session: decision.session,
          target: { kind: "agent", agentId: agent.id },
          select: quiet ? false : {},
          expandPanel: !quiet,
          send: {
            ...decision.send,
            commentThreadIds: options.commentThreadIds,
          },
        },
        {
          addChatSession,
          chatTarget,
        }
      )
      return true
    },
    [roomId, chatSessions, chatTarget, addChatSession]
  )

  // action route → the deterministic Create-PR server action (#355), no model
  // turn. Writes the PR source of truth immediately so the sidebar icon, branch
  // menu, and chat button reflect the open PR now — not on the next poll.
  const applyCreatePr = useCallback(
    async (agent: BranchData) => {
      const result = await createPullRequestAction(roomId, agent.sandboxName)
      if (result.success) {
        const { url, number } = result.value
        setBranchPr(agent.id, { number, url, state: "open" })
        toast.success("Pull request created", {
          description: `#${number}`,
          action: {
            label: "View on GitHub",
            onClick: () => openExternal(url),
          },
        })
      } else {
        toast.error("Couldn't create pull request", {
          description: result.error,
        })
      }
    },
    [roomId, setBranchPr]
  )

  // recovery route → the matching lib/branch/recovery runner.
  const applyRecovery = useCallback(
    (recovery: RecoveryKind, id: string) => {
      switch (recovery) {
        case "dev-server":
          return restartDevServerRecovery(id, recoveryDeps)
        case "sandbox":
          return restartSandboxRecovery(id, recoveryDeps)
        case "recreate":
          return recreateBranchRecovery(id, recoveryDeps)
      }
    },
    [recoveryDeps]
  )

  // Route a Branch action by conflict risk (the single pure decision) and apply
  // the result. A `none` route — or an agent that vanished out from under the
  // menu — is a silent no-op.
  const run = useCallback(
    (kind: BranchActionKind, agentId: string) => {
      const agent = agents.find((a) => a.id === agentId)
      const repo = agent ? repos.find((w) => w.id === agent.repoId) : undefined
      const route = routeBranchAction(kind, { agent, repo })
      if (route.kind === "none" || !agent) return
      switch (route.kind) {
        case "engine":
          return void applyEngine(route.prompt, agent)
        case "action":
          return applyCreatePr(agent)
        case "recovery":
          return applyRecovery(route.recovery, agent.id)
      }
    },
    [agents, repos, applyEngine, applyCreatePr, applyRecovery]
  )

  return useMemo<BranchActions>(
    () => ({
      rebaseOnDefault: (agentId) => run("rebase", agentId),
      createPullRequest: (agentId) => run("create-pr", agentId),
      restartDevServer: (agentId) => run("restart-dev-server", agentId),
      restartSandbox: (agentId) => run("restart-sandbox", agentId),
      stopDevServer: (agentId) => stopDevServerRecovery(agentId, recoveryDeps),
      runDevServer: (agentId) => runDevServerRecovery(agentId, recoveryDeps),
      startWorkspace: (agentId) =>
        void startWorkspaceRecovery(agentId, recoveryDeps, {
          local: isLocalBuild,
        }),
      markDone: (agentId) => {
        const agent = agents.find((a) => a.id === agentId)
        if (!agent) return
        const frames = countWorkspaceFrames(
          agentId,
          iframeLayerGroups,
          iframeLayers
        )
        void markDoneRecovery(agentId, recoveryDeps)
        toast(markedDoneMessage(workspaceLabel(agent), frames), {
          action: {
            label: "Undo",
            onClick: () => void reopenRecovery(agentId, recoveryDeps),
          },
        })
      },
      reopen: (agentId) => void reopenRecovery(agentId, recoveryDeps),
      recreate: async (agentId) => {
        const outcome = (await run("recreate", agentId)) as
          RecoveryOutcome | undefined
        if (outcome && !outcome.ok) throw new Error(outcome.error)
      },
      sendComments: (agentId, message, threadIds) => {
        const agent = agents.find((a) => a.id === agentId)
        if (!agent) return false
        return applyEngine(message, agent, { commentThreadIds: threadIds })
      },
    }),
    [run, recoveryDeps, agents, applyEngine, iframeLayers, iframeLayerGroups]
  )
}

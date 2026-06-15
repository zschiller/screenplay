import { useEffect, useRef } from "react"

import { withBasePath } from "@/lib/base-path"
import { chatStore } from "@/lib/chat-store"
import {
  keepAliveSandbox,
  reconnectSandbox,
  recreateSandbox,
} from "@/lib/sandbox/lifecycle"
import { resolveReconnect } from "@/lib/sandbox/reconnect"
import type { BranchData, ChatSessionData, RepoData } from "@/lib/types"

/**
 * Sandbox Reconnect controller (PRD #579, cut 2/4) — the single home for all of
 * the Canvas's mount-time Sandbox-lifecycle orchestration, lifted out of the
 * composition root the way the rest of the canvas triad already is: a
 * React-free, Yjs-free **decision** (`resolveReconnect`) plus this thin
 * controller that **applies** it.
 *
 * Three mount-tied effects share this one home because they're all
 * Sandbox-lifecycle recovery:
 *
 *  1. **Reconnect** — once `agents` has synced, recover each Branch per
 *     `resolveReconnect`: resume an interrupted create, error an unrecoverable
 *     one, reconnect a live sandbox (recreating on an expired-snapshot resume
 *     failure per ADR 0005 — never a silent reclone), or land a repo-less
 *     sandbox at stopped with a retry hint.
 *  2. **Keep-alive heartbeat** — extend running sandboxes' timeouts every ~20
 *     minutes while the tab is visible, so they survive active use but still
 *     expire once the user leaves.
 *  3. **Streaming-heal hydration** — the first time `chatSessions` has entries,
 *     mirror each storage-`streaming` chat into the client store and ask the
 *     heal endpoint to verify the underlying run is still live (unsticking a
 *     spinner whose `chat-stream-end` was missed on a slow connection).
 *
 * The async apply (the resume POST, `reconnectSandbox` / `recreateSandbox`, the
 * heal POST, the `updateAgentInStorage` writes) lives here; only the per-Branch
 * branch selection is pure, in `resolveReconnect`.
 */
export interface SandboxReconnectInputs {
  /** Live Branches from the synced Y.Doc — the reconnect + heartbeat read these. */
  agents: BranchData[]
  /** Live Repos — a Branch's source, looked up by `repoId` for reconnect. */
  repos: RepoData[]
  /** Live Chat Sessions — the heal hydration reads their `isStreaming` flag. */
  chatSessions: ChatSessionData[]
  /** Room id, threaded into the resume and heal POST bodies. */
  roomId: string
  /** Canvas Operation wrapper that patches a Branch record (ADR 0001). */
  updateAgentInStorage: (id: string, data: Partial<BranchData>) => void
}

export function useSandboxReconnect({
  agents,
  repos,
  chatSessions,
  roomId,
  updateAgentInStorage,
}: SandboxReconnectInputs): void {
  // Reconnect agents on mount — check if they're still alive, and recover any
  // that were mid-creation when the page was reloaded. The mount-once guard
  // waits for the first non-empty `agents` (post Yjs initial sync), then never
  // fires again.
  const reconnectedRef = useRef(false)
  useEffect(() => {
    if (reconnectedRef.current || agents.length === 0) return
    reconnectedRef.current = true

    for (const agent of agents) {
      const repo = repos.find((w) => w.id === agent.repoId)
      const action = resolveReconnect(agent, repo)

      switch (action.kind) {
        case "none":
          break

        case "unrecoverable":
          // VM was never created — unrecoverable.
          updateAgentInStorage(agent.id, {
            status: "error",
            statusMessage: undefined,
            error: "Sandbox creation was interrupted — delete and try again",
          })
          break

        case "resume-create":
          // Stuck mid-creation — ask the server to resume the pipeline. The
          // server uses a Redis lock so only one instance handles it.
          fetch(withBasePath("/api/branch/create"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flow: "from-branch",
              roomId,
              branchId: action.branchId,
              sandboxName: action.sandboxName,
              branch: action.branch,
              repoId: action.repoId,
            }),
          })
          break

        case "repo-missing":
          // The restart fallback needs a source to provision from, so a sandbox
          // whose workspace is gone lands at stopped with a retry hint.
          updateAgentInStorage(agent.id, {
            status: "stopped",
            statusMessage: "",
            error: "Workspace not found — click refresh to retry",
          })
          break

        case "reconnect":
          // Covers normal reloads and restarts (status === "starting") that were
          // interrupted by a page reload. reconnectSandbox probes the existing
          // sandbox first, so it won't recreate one that's already running.
          reconnectSandbox(action.sandboxName, action.repo).then((result) => {
            if (result.success) {
              updateAgentInStorage(agent.id, {
                previewDomain: result.value.previewDomain,
                status: "running",
                statusMessage: "",
                error: "",
              })
              return
            }
            // Resume failed — likely the snapshot has fully expired (>24h) and
            // been deleted, so there's nothing left to restore from. Reclone
            // fresh from git (recreateSandbox) instead of stranding the user at
            // "stopped": a plain restart would just fail loud on the snapshot
            // miss now that the silent reclone fallback is gone (ADR 0005).
            updateAgentInStorage(agent.id, {
              status: "starting",
              statusMessage: "Recreating expired sandbox…",
              error: "",
            })
            recreateSandbox(action.sandboxName, action.repo, action.ref).then(
              (restartResult) => {
                if (restartResult.success) {
                  updateAgentInStorage(agent.id, {
                    sandboxName: restartResult.value.sandboxName,
                    previewDomain:
                      restartResult.value.previewDomain || agent.previewDomain,
                    status: "running",
                    statusMessage: "",
                    error: "",
                  })
                } else {
                  updateAgentInStorage(agent.id, {
                    status: "stopped",
                    statusMessage: "",
                    error:
                      restartResult.error ||
                      "Sandbox could not be restarted — click refresh to retry",
                  })
                }
              }
            )
          })
          break
      }
    }
  }, [agents, repos, updateAgentInStorage, roomId])

  // Heartbeat: extend sandbox timeouts while the tab is visible so they stay
  // alive as long as the user is actively using the page. Fires every 20
  // minutes (well within the 30-minute timeout) and pauses when the tab is
  // hidden so sandboxes can expire when the user leaves.
  useEffect(() => {
    const HEARTBEAT_MS = 20 * 60 * 1000

    const pingAll = () => {
      if (document.hidden) return
      for (const agent of agents) {
        if (agent.sandboxName && agent.status === "running") {
          keepAliveSandbox(agent.sandboxName).catch(() => {})
        }
      }
    }

    const interval = setInterval(pingAll, HEARTBEAT_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) pingAll()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [agents])

  // Hydrate chatStore streaming state from Yjs storage on mount/reconnect. For
  // each chat that's marked streaming in storage, ask the server to verify the
  // underlying agent run is still actually active. If it's ended, the heal
  // endpoint broadcasts chat-stream-end to unstick the spinner. The previous
  // empty-deps form ran before Yjs initial sync completed, so for slow
  // connections the streaming flag from storage was missed; now we hydrate the
  // first time `chatSessions` actually has entries, then never again.
  const hydratedStreamingRef = useRef(false)
  useEffect(() => {
    if (hydratedStreamingRef.current || chatSessions.length === 0) return
    hydratedStreamingRef.current = true
    for (const cs of chatSessions) {
      if (!cs.isStreaming) continue
      chatStore.setStreaming(cs.id, true)
      fetch(withBasePath("/api/branch/heal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId: cs.id }),
      }).catch((e) => console.error("Heal request failed:", e))
    }
  }, [chatSessions, roomId])
}

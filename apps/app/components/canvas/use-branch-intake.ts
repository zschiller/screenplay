import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react"
import { nanoid } from "nanoid"
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator"

import { withBasePath } from "@/lib/base-path"
import { chatStore } from "@/lib/chat-store"
import { dispatchPrompt } from "@/lib/chat/agent-prompt"
import { deleteBranch } from "@/lib/github-actions"
import { renameAgentBranch } from "@/lib/sandbox/git"
import { deleteSandboxes } from "@/lib/sandbox/lifecycle"
import {
  planBranchCreations,
  type ComposerSpec,
} from "@/lib/branch-create-planner"
import {
  planBranchSeed,
  planBranchTeardown,
  planRepoTeardown,
} from "@/lib/branch/intake"
import { readLastTabKind } from "@/lib/canvas/tab-kind"
import type { CanvasOps } from "@/lib/canvas/ops"
import type { ChatTarget } from "@/components/canvas/use-chat-target"
import type { RepoPickerSelection } from "@/components/repo-picker"
import type {
  BranchData,
  ChatSessionData,
  IframeLayerData,
  RepoData,
  TabKind,
} from "@/lib/types"

/**
 * Branch Intake controller (PRD #562) — the Repo → Branch → Sandbox lifecycle
 * lifted out of `components/canvas/canvas.tsx`. The component calls the verbs
 * this hook returns (`createRepo`, `createBranch`, `createBranchFromGitBranch`,
 * `removeRepo`, `removeBranch`, `renameBranch`); the orchestration — the
 * multi-collection Y.Doc writes through the Canvas Operation seam (ADR 0001),
 * the Sandbox Provider calls (ADR 0003), and above all the *ordering* — lives
 * here in one place rather than smeared across the canvas surface.
 *
 * The genuinely order-independent decisions are pure (`lib/branch/intake.ts`):
 * the teardown plan and the seed plan. The controller owns the async sequencing
 * the create flow can't be pure about — the provisioned Sandbox name only exists
 * after the Sandbox Provider returns — and applies those plans inside it.
 *
 * Modelled on the Branch recovery runner (#540): plain injected seams, no
 * inline JSX handlers.
 */
export interface BranchIntakeDeps {
  /** The Canvas Operation seam — all Repo/Branch collection writes go here. */
  ops: CanvasOps
  repos: RepoData[]
  agents: BranchData[]
  /** Live Iframe Layers — the frame-seed-on-provision effect reads these to
   *  skip a Branch that already has a frame. */
  iframeLayers: IframeLayerData[]
  roomId: string
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
  /**
   * The Tab Pool's seed entry: seed a Branch's default tab (chat or terminal)
   * without re-implementing tab creation. This is the handoff to the Tab Pool
   * controller (separate PRD); the seed plan decides *whether* and *which kind*.
   */
  createDefaultTabForBranch: (
    branchId: string,
    kind: TabKind,
    options?: { select?: boolean }
  ) => string
  getViewportCenter: () => { cx: number; cy: number }
  setSelectedGroupIds: Dispatch<SetStateAction<Set<string>>>
  setSelectedIframeLayerIds: Dispatch<SetStateAction<Set<string>>>
  handleSelectIframeLayer: (id: string) => void
  /**
   * The Chat-Target controller (#569). Branch Intake hands off to it for the
   * selection effects of create + teardown: registering a just-created Branch as
   * pending (`addPending`) and clearing + collapsing the panel when the deleted
   * Branch was the selected one (`clearIfSelected`).
   */
  chatTarget: ChatTarget
}

export interface BranchIntake {
  createRepo: (pick: RepoPickerSelection) => void
  createBranch: (repoId: string, specs: ComposerSpec[]) => Promise<void>
  createBranchFromGitBranch: (repoId: string, branch: string) => void
  removeRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => Promise<void>
  removeBranch: (
    id: string,
    options: { deleteOnRemote: boolean }
  ) => Promise<void>
  renameBranch: (agentId: string, rawBranch: string) => Promise<void>
  /**
   * Repo/Branch storage writes that are *also* consumed outside intake, exposed
   * off the controller rather than redefined in the Canvas root: the sidebar's
   * "update repo" (`updateRepoInStorage`) and the heartbeat / Sandbox-reconnect
   * "update branch" (`updateAgentInStorage`).
   */
  updateRepoInStorage: (id: string, patch: Partial<RepoData>) => void
  updateAgentInStorage: (id: string, patch: Partial<BranchData>) => void
}

/** Mint a deduped random `adjective-color-animal` branch name. */
function randomBranchName(taken?: Set<string>): string {
  let name = uniqueNamesGenerator({
    dictionaries: [adjectives, colors, animals],
    separator: "-",
    length: 3,
  })
  if (!taken) return name
  while (taken.has(name)) {
    name = uniqueNamesGenerator({
      dictionaries: [adjectives, colors, animals],
      separator: "-",
      length: 3,
    })
  }
  taken.add(name)
  return name
}

export function useBranchIntake(deps: BranchIntakeDeps): BranchIntake {
  const {
    ops,
    repos,
    agents,
    iframeLayers,
    roomId,
    updateChatSession,
    createDefaultTabForBranch,
    getViewportCenter,
    setSelectedGroupIds,
    setSelectedIframeLayerIds,
    handleSelectIframeLayer,
    chatTarget,
  } = deps

  // --- Repo / Branch storage writes ---
  // The thin wrappers over the Canvas Operation verbs (ADR 0001: collection
  // writes go through `ops`, never the Y.Doc directly). These used to live in
  // the Canvas root, which only defined them to pass straight back into this
  // controller; the create/teardown verbs below apply them directly now, and
  // the two consumed outside intake (`updateRepoInStorage`,
  // `updateAgentInStorage`) are exposed off the returned interface.

  const addRepoToStorage = useCallback(
    (id: string, data: RepoData) => {
      ops.createRepo(id, data)
    },
    [ops]
  )

  const updateRepoInStorage = useCallback(
    (id: string, data: Partial<RepoData>) => {
      ops.patch("repos", id, data)
    },
    [ops]
  )

  const removeRepoFromStorage = useCallback(
    (id: string) => {
      const { removedChatIds } = ops.removeRepo(id)
      // Clear the client chat-store mirror for the Chat Sessions the verb
      // deleted from the Y.Doc (their identity is gone; the conversation lives
      // client-side).
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
    },
    [ops]
  )

  const updateAgentInStorage = useCallback(
    (id: string, data: Partial<BranchData>) => {
      ops.patch("branches", id, data)
    },
    [ops]
  )

  const removeAgentFromStorage = useCallback(
    (id: string) => {
      const { removedChatIds } = ops.removeBranch(id)
      for (const chatId of removedChatIds) chatStore.cleanup(chatId)
    },
    [ops]
  )

  // Eagerly seed a single new Branch's canvas frame at creation time, rather
  // than waiting on the deferred `running`-gated seeder: a single-member Group
  // at the viewport center, selected and zoomed once its frame mounts. The op
  // clears `pendingIframeLayerSeed`, so the reactive seeder skips this Branch.
  // Bulk creates seed their own shared Group inline (see createBranch).
  const seedEagerFrameForBranch = useCallback(
    (branchId: string) => {
      const frame = planBranchSeed({
        branchId,
        hasSeededChat: false,
        defaultTabKind: readLastTabKind(),
      }).frame
      const { cx, cy } = getViewportCenter()
      const frameGroup = ops.createFramesForAgents([frame], { x: cx, y: cy })
      if (!frameGroup) return
      setSelectedGroupIds(new Set([frameGroup.groupId]))
      setSelectedIframeLayerIds(new Set())
      const firstLayerId = frameGroup.layerIds[0]
      if (firstLayerId)
        requestAnimationFrame(() => handleSelectIframeLayer(firstLayerId))
    },
    [
      ops,
      getViewportCenter,
      handleSelectIframeLayer,
      setSelectedGroupIds,
      setSelectedIframeLayerIds,
    ]
  )

  /**
   * Seed a freshly-created single Branch's default tab to the user's pref via
   * the Tab Pool seed entry (selection deferred until the sandbox is ready), so
   * the tab shows up immediately rather than only after provisioning finishes.
   * Since the client always pre-seeds, the server is told to skip its auto chat;
   * the returned `seedChat` flag is forwarded to the create API.
   */
  const seedDefaultTabForNewBranch = useCallback(
    (branchId: string): boolean => {
      const { tab } = planBranchSeed({
        branchId,
        hasSeededChat: false,
        defaultTabKind: readLastTabKind(),
      })
      if (tab)
        createDefaultTabForBranch(tab.branchId, tab.kind, { select: false })
      return false
    },
    [createDefaultTabForBranch]
  )

  const createRepo = useCallback(
    (pick: RepoPickerSelection) => {
      const id = nanoid()
      const data: RepoData =
        pick.kind === "config"
          ? {
              id,
              name: pick.config.name,
              repoFullName: pick.config.repoFullName,
              repoOwner: pick.config.repoOwner,
              repoName: pick.config.repoName,
              defaultBranch: pick.config.defaultBranch,
              cloneUrl: pick.config.cloneUrl,
              setupScript: pick.config.setupScript,
              devScript: pick.config.devScript,
              devServerPort: pick.config.devServerPort,
              envVars: pick.config.envVars,
              copyPatterns: pick.config.copyPatterns,
              defaultIframeLayerSizeId: pick.config.defaultIframeLayerSizeId,
              systemPrompt: pick.config.systemPrompt,
              createdAt: Date.now(),
            }
          : pick.kind === "source"
            ? {
                // A Repo from the local build's URL / local-folder entry
                // points (PRD #428). `localPath` is the acquisition source the
                // provision path routes on; the GitHub identity fields may be
                // empty (non-GitHub repo), which just leaves API features dark.
                id,
                name: "",
                repoFullName: pick.source.repoFullName,
                repoOwner: pick.source.repoOwner,
                repoName: pick.source.repoName,
                defaultBranch: pick.source.defaultBranch,
                cloneUrl: pick.source.cloneUrl,
                localPath: pick.source.localPath,
                setupScript: "",
                devScript: "",
                devServerPort: 3000,
                envVars: "",
                // A local-folder Repo's worktrees get the checkout's env
                // files carried over by default — the common gitignored
                // config a dev server can't run without.
                copyPatterns: pick.source.localPath ? ".env*" : undefined,
                createdAt: Date.now(),
              }
            : {
                id,
                name: "",
                repoFullName: pick.repo.fullName,
                repoOwner: pick.repo.owner,
                repoName: pick.repo.name,
                defaultBranch: pick.repo.defaultBranch,
                cloneUrl: pick.repo.cloneUrl,
                setupScript: "",
                devScript: "",
                devServerPort: 3000,
                envVars: "",
                createdAt: Date.now(),
              }
      const sandboxName = `sp-${nanoid(10)}`
      const branch = randomBranchName()

      // One transaction so the repo and its first agent land as a single
      // undo step. `createBranch` owns the agent record + deferred-seed flag.
      let agentId = ""
      ops.batch(() => {
        addRepoToStorage(id, data)
        agentId = ops.createBranch({
          branch: {
            repoId: id,
            sandboxName,
            gitUrl: data.cloneUrl,
            ref: branch,
            previewDomain: "",
            port: data.devServerPort ?? 3000,
            status: "creating",
            statusMessage: "Creating branch…",
            createdAt: Date.now(),
          },
        }).branchId
      })
      chatTarget.addPending([agentId])
      const seedChat = seedDefaultTabForNewBranch(agentId)
      seedEagerFrameForBranch(agentId)

      fetch(withBasePath("/api/branch/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "new",
          roomId,
          branchId: agentId,
          sandboxName,
          branch,
          repoId: id,
          seedChat,
        }),
      })
    },
    [
      addRepoToStorage,
      ops,
      roomId,
      seedDefaultTabForNewBranch,
      seedEagerFrameForBranch,
      chatTarget,
    ]
  )

  // Prompts queued by the prompt-first create handler (createBranch) that should
  // fire as soon as the agent's sandbox transitions to `running`. Held in a ref
  // because the dispatch effect already re-runs on every `agents` change.
  const pendingPromptsRef = useRef<
    Map<
      string,
      { chatId: string; prompt: string; model: string; planMode?: boolean }
    >
  >(new Map())

  // Prompt-first "New Workspace" create (PRD #314). The pure planner owns the
  // decision; this handler is thin orchestration over the existing
  // `/api/branch/create` contract. It takes one {@link ComposerSpec} per dialog
  // row — a single row is the common case; parallel mode (#327) hands several,
  // each resolved independently and created as its own Branch.
  //
  // Empty prompt (#323) -> a bare scratch Branch (random name, no Chat Session,
  // nothing queued). Non-empty prompt (#324) -> the full seeded path: a Branch
  // name derived from the prompt, a Chat Session pre-seeded with the chosen
  // model, and the prompt queued to fire as the first message exactly once the
  // Sandbox reaches `running`. The fired body is the Composer's Message-Markers
  // wire text, so model, plan-mode, `@`-Layer mentions, and `/`-Skills all ride
  // through unchanged. A non-default base derives `flow:"duplicate-branch"`
  // (#325); the chosen base rides along as the source the server forks from.
  const createBranch = useCallback(
    async (repoId: string, specs: ComposerSpec[]) => {
      const repo = repos.find((w) => w.id === repoId)
      if (!repo || specs.length === 0) return

      const plans = planBranchCreations(
        { defaultBranch: repo.defaultBranch },
        specs
      )

      // Mint deduped random names, never colliding with a name already assigned
      // in this batch.
      const taken = new Set<string>()

      // Generate prompt-derived names for every seeded row up front in one
      // request, so identical prompts can't independently land on the same
      // branch and clobber each other. Bare rows (and any seeded row the
      // endpoint didn't name) fall back to a deduped random name.
      const names = new Array<{ branch: string; label: string }>(specs.length)
      const seededIdx = plans
        .map((plan, i) => (plan.nameSource === "from-prompt" ? i : -1))
        .filter((i) => i >= 0)

      if (seededIdx.length > 0) {
        let results: Array<{ branch: string; label: string }> = []
        try {
          const res = await fetch(withBasePath("/api/agent/generate-names"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roomId,
              prompts: seededIdx.map((i) => specs[i]!.prompt.trim()),
            }),
          })
          if (res.ok) {
            const data = (await res.json()) as {
              results: Array<{ branch: string; label: string }>
            }
            results = data.results ?? []
          }
        } catch {
          // Fall through to the per-row random fallback below.
        }
        seededIdx.forEach((specIndex, k) => {
          const result = results[k]
          const label = result?.label || "Untitled"
          let branch: string
          if (result?.branch && !taken.has(result.branch)) {
            taken.add(result.branch)
            branch = result.branch
          } else {
            branch = randomBranchName(taken)
          }
          names[specIndex] = { branch, label }
        })
      }

      plans.forEach((_, i) => {
        if (!names[i])
          names[i] = { branch: randomBranchName(taken), label: "Untitled" }
      })

      const dispatched: Array<{
        id: string
        sandboxName: string
        branch: string
        flow: "new" | "duplicate-branch"
        sourceBranch: string | undefined
        seedChat: boolean
      }> = []

      // Every created Branch gets its frame eagerly (#338's waiting preview):
      // one Branch lands a single-member Group, a bulk create lands one Group
      // holding every Branch's frame. The seed plan decides per-Branch (tab +
      // frame); frames are collected here and created in the same Yjs
      // transaction below so branch + frame land as one undo step.
      const frameSpecs: Array<{ agentId: string; label?: string }> = []
      const tabSpecs: Array<{ branchId: string; kind: TabKind }> = []
      const { cx, cy } = getViewportCenter()
      let frameGroup: { groupId: string; layerIds: string[] } | undefined
      const defaultTabKind = readLastTabKind()

      // Create all Branch records (and pre-seed each prompted row's Chat Session
      // so its queued prompt has a stable chatId) in one Yjs transaction.
      ops.batch(() => {
        plans.forEach((plan, i) => {
          const spec = specs[i]!
          const { branch, label } = names[i]!
          const sandboxName = `sp-${nanoid(10)}`
          const model = plan.model ?? spec.model

          const { branchId: id, chatId } = ops.createBranch({
            branch: {
              repoId,
              sandboxName,
              gitUrl: repo.cloneUrl,
              ref: branch,
              previewDomain: "",
              port: repo.devServerPort ?? 3000,
              status: "creating",
              statusMessage: "Creating branch…",
              createdAt: Date.now(),
              autoNamedBranch: plan.autoNamedBranch,
            },
            // Seed a Chat Session only for prompted rows; bare rows get none.
            ...(plan.seedChat ? { chat: { label, model } } : {}),
          })

          // Queue the seed prompt; the dispatch effect below fires it exactly
          // once, when the Sandbox reaches `running` (and drops it on error).
          if (plan.firePromptOnRunning && chatId) {
            pendingPromptsRef.current.set(id, {
              chatId,
              prompt: spec.prompt.trim(),
              model,
              planMode: spec.planMode,
            })
          }

          // The seed plan: a prompted row already has its Chat Session, so its
          // default tab is skipped; every row seeds an eager frame.
          const seed = planBranchSeed({
            branchId: id,
            label,
            hasSeededChat: plan.seedChat,
            defaultTabKind,
          })
          frameSpecs.push(seed.frame)
          if (seed.tab) tabSpecs.push(seed.tab)

          dispatched.push({
            id,
            sandboxName,
            branch,
            flow: plan.flow,
            sourceBranch:
              plan.flow === "duplicate-branch" ? spec.baseBranch : undefined,
            seedChat: plan.seedChat,
          })
        })

        // Seed the frames inside the same transaction (clears each Branch's
        // `pendingIframeLayerSeed`, so the deferred reactive seeder skips them).
        frameGroup = ops.createFramesForAgents(frameSpecs, { x: cx, y: cy })
      })

      chatTarget.addPending(dispatched.map((d) => d.id))

      // Surface the just-created frames: select the new Group and bring it into
      // view once its frames have mounted. Zooming to the first member's DOM
      // node (rather than `handleZoomToGroup`, which reads not-yet-updated React
      // state) mirrors the routes-group and deferred-seed flows.
      if (frameGroup) {
        const { groupId, layerIds } = frameGroup
        setSelectedGroupIds(new Set([groupId]))
        setSelectedIframeLayerIds(new Set())
        if (layerIds[0]) {
          const firstLayerId = layerIds[0]
          requestAnimationFrame(() => handleSelectIframeLayer(firstLayerId))
        }
      }

      // Every Branch needs a tab waiting on the dev server from the moment it's
      // created. Prompted rows already got their seeded Chat Session above;
      // bare rows (no Chat Session) get the operator's preferred default tab —
      // chat or terminal — so a scratch Branch is never tab-less while it
      // provisions. Selection is deferred until the Sandbox is running, like
      // the other branch-create flows. The server still skips its auto chat for
      // these rows (seedChat: false), since the client owns tab seeding here.
      for (const tab of tabSpecs) {
        createDefaultTabForBranch(tab.branchId, tab.kind, { select: false })
      }

      for (const d of dispatched) {
        fetch(withBasePath("/api/branch/create"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow: d.flow,
            roomId,
            branchId: d.id,
            sandboxName: d.sandboxName,
            branch: d.branch,
            repoId,
            sourceBranch: d.sourceBranch,
            seedChat: d.seedChat,
          }),
        })
      }
    },
    [
      repos,
      ops,
      roomId,
      createDefaultTabForBranch,
      getViewportCenter,
      handleSelectIframeLayer,
      chatTarget,
      setSelectedGroupIds,
      setSelectedIframeLayerIds,
    ]
  )

  const createBranchFromGitBranch = useCallback(
    (repoId: string, branch: string) => {
      const repo = repos.find((w) => w.id === repoId)
      if (!repo) return

      const sandboxName = `sp-${nanoid(10)}`

      const { branchId: id } = ops.createBranch({
        branch: {
          repoId,
          sandboxName,
          gitUrl: repo.cloneUrl,
          ref: branch,
          previewDomain: "",
          port: repo.devServerPort ?? 3000,
          status: "creating",
          statusMessage: "Cloning repository…",
          createdAt: Date.now(),
          autoNamedBranch: false,
        },
      })
      chatTarget.addPending([id])
      const seedChat = seedDefaultTabForNewBranch(id)
      seedEagerFrameForBranch(id)

      fetch(withBasePath("/api/branch/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: "from-branch",
          roomId,
          branchId: id,
          sandboxName,
          branch,
          repoId,
          seedChat,
        }),
      })
    },
    [
      repos,
      ops,
      roomId,
      seedDefaultTabForNewBranch,
      seedEagerFrameForBranch,
      chatTarget,
    ]
  )

  // Dispatch prompts queued by the prompt-first create handler (createBranch)
  // once their agent's sandbox reaches `running`. Deleting the entry before
  // sending means the prompt fires exactly once — never before `running`, and
  // never re-sent on a later reconnect. Drop the queue entry if the agent
  // errored out so failed builds don't leak forever.
  useEffect(() => {
    if (pendingPromptsRef.current.size === 0) return
    for (const agent of agents) {
      const queued = pendingPromptsRef.current.get(agent.id)
      if (!queued) continue
      if (agent.status === "error") {
        pendingPromptsRef.current.delete(agent.id)
        continue
      }
      if (agent.status !== "running" || !agent.sandboxName || !agent.ref)
        continue
      pendingPromptsRef.current.delete(agent.id)
      // The seed fires through the shared Agent-prompt dispatch. Its Chat
      // Session already exists (created in the same transaction as the Branch),
      // so nothing is created; selection stays deferred to the pending-ready
      // flow, so the dispatch must not select. Always the agent's first chat.
      dispatchPrompt(
        {
          session: null,
          target: { kind: "agent", agentId: agent.id },
          select: false,
          expandPanel: false,
          send: {
            roomId,
            chatId: queued.chatId,
            sandboxName: agent.sandboxName,
            branch: agent.ref,
            message: queued.prompt,
            isFirstChat: true,
            autoNamedBranch: agent.autoNamedBranch,
            model: queued.model,
            planMode: queued.planMode,
          },
        },
        {
          addChatSession: ops.addChatSession,
          chatTarget,
          onChatRename: (chatId, label) => updateChatSession(chatId, { label }),
          onBranchRename: (agentId, branch) =>
            updateAgentInStorage(agentId, {
              ref: branch,
              autoNamedBranch: false,
            }),
        }
      )
    }
  }, [agents, ops, roomId, chatTarget, updateAgentInStorage, updateChatSession])

  // Seed iframeLayers for agents whose sandbox has finished provisioning. The
  // flag is set at create time and cleared here after the first seed, so
  // deleting the last frame for a branch later does not re-spawn one. This is
  // the deferred sibling of `seedEagerFrameForBranch` (which seeds at create
  // time): a Branch whose eager seed didn't land — e.g. a create that resumed
  // after a reload — still gets its frame once it reaches `running`.
  useEffect(() => {
    const pending = agents.filter(
      (a) =>
        a.pendingIframeLayerSeed === true &&
        a.status === "running" &&
        a.previewDomain &&
        !iframeLayers.some((ab) => ab.branchId === a.id)
    )
    if (pending.length === 0) return
    const { cx, cy } = getViewportCenter()
    const target = pending[0]!
    // Seed one per tick — `seedFrameForAgent` reads the Yjs snapshot for
    // layout, and the snapshot only refreshes after the previous mutation
    // settles. Letting React re-render between seeds avoids stacking groups.
    // The verb creates the frame and clears `pendingIframeLayerSeed` in one
    // transaction, so this reactive trigger is the only seed logic left here.
    const { layerId } = ops.seedFrameForAgent(target.id, { x: cx, y: cy })
    // Selecting the just-seeded frame is the intended reaction to a Yjs
    // mutation triggered by externally-driven agent state, not an avoidable
    // render cascade. Goes through the Canvas Selection setters.
    setSelectedIframeLayerIds(new Set([layerId]))
    setSelectedGroupIds(new Set())
    // Wait for the new iframeLayer DOM node to mount before zooming.
    requestAnimationFrame(() => {
      handleSelectIframeLayer(layerId)
    })
  }, [
    agents,
    iframeLayers,
    ops,
    getViewportCenter,
    handleSelectIframeLayer,
    setSelectedIframeLayerIds,
    setSelectedGroupIds,
  ])

  const renameBranch = useCallback(
    async (agentId: string, rawBranch: string) => {
      const newBranch = rawBranch
        .toLowerCase()
        .replace(/[^a-z0-9/_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      const agent = agents.find((a) => a.id === agentId)
      if (
        !newBranch ||
        !agent?.sandboxName ||
        !agent.ref ||
        agent.ref === newBranch
      )
        return

      const repo = repos.find((w) => w.id === agent.repoId)
      if (!repo) return

      // Apply the rename locally before the sandbox roundtrip — the sandbox
      // resume + `git branch -m` + GitHub call can take several seconds and
      // the badge sitting on the old name in the meantime feels broken.
      // Roll back if the sandbox rejects (e.g. branch already exists).
      const previousBranch = agent.ref
      const previousAutoNamed = agent.autoNamedBranch
      updateAgentInStorage(agentId, { ref: newBranch, autoNamedBranch: false })

      const result = await renameAgentBranch(
        repo,
        agent.sandboxName,
        previousBranch,
        newBranch
      )
      if (!result.success) {
        updateAgentInStorage(agentId, {
          ref: previousBranch,
          autoNamedBranch: previousAutoNamed,
        })
      }
    },
    [agents, repos, updateAgentInStorage]
  )

  const removeRepo = useCallback(
    async (
      id: string,
      { deleteBranchesOnRemote }: { deleteBranchesOnRemote: boolean }
    ) => {
      // The pure teardown plan: which Sandboxes to tear down, which remote refs
      // to delete. Captured against the current collections *before* the Y.Doc
      // records go, so a Sandbox never outlives its Branch.
      const plan = planRepoTeardown(id, agents, {
        deleteOnRemote: deleteBranchesOnRemote,
      })

      if (plan.remoteRefs.length > 0) {
        const repo = repos.find((w) => w.id === id)
        if (repo) {
          const results = await Promise.all(
            plan.remoteRefs.map((branch) =>
              deleteBranch(repo.repoOwner, repo.repoName, branch)
            )
          )
          const failed = results.filter((r) => !r.success)
          if (failed.length > 0) {
            throw new Error(
              failed[0]?.error ??
                `Failed to delete ${failed.length} branch${failed.length === 1 ? "" : "es"} on remote`
            )
          }
        }
      }
      removeRepoFromStorage(id)
      if (plan.sandboxNames.length > 0) {
        void deleteSandboxes(plan.sandboxNames).catch(() => {})
      }
    },
    [agents, repos, removeRepoFromStorage]
  )

  const removeBranch = useCallback(
    async (id: string, { deleteOnRemote }: { deleteOnRemote: boolean }) => {
      const agent = agents.find((a) => a.id === id)
      const plan = planBranchTeardown(id, agents, { deleteOnRemote })

      if (plan.remoteRefs.length > 0 && agent) {
        const repo = repos.find((w) => w.id === agent.repoId)
        if (repo) {
          for (const ref of plan.remoteRefs) {
            const result = await deleteBranch(
              repo.repoOwner,
              repo.repoName,
              ref
            )
            if (!result.success) {
              throw new Error(
                result.error ?? "Failed to delete branch on remote"
              )
            }
          }
        }
      }
      // Clear selection + collapse the panel if this was the selected Branch.
      chatTarget.clearIfSelected(id)
      // removeAgentFromStorage clears the chat-store mirror for the Chat
      // Sessions the verb deletes.
      removeAgentFromStorage(id)
      // A Sandbox never outlives its Branch: tear down the deleted Branch's
      // worktree/VM (dev server included) so the leak doesn't keep its git ref
      // checked out. Fire-and-forget — the Branch is already gone from the doc,
      // so cleanup must not block the UI.
      if (plan.sandboxNames.length > 0) {
        void deleteSandboxes(plan.sandboxNames).catch(() => {})
      }
    },
    [agents, repos, chatTarget, removeAgentFromStorage]
  )

  return {
    createRepo,
    createBranch,
    createBranchFromGitBranch,
    removeRepo,
    removeBranch,
    renameBranch,
    updateRepoInStorage,
    updateAgentInStorage,
  }
}

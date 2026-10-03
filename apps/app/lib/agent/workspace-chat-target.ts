import "server-only"

import { buildAgentSystemPrompt, type LayerDirectory } from "./config"
import {
  accountMemoryStore,
  loadAccountMemory,
  loadCanvasMemory,
  loadLayerDirectory,
  turnSender,
  type ChatTargetSpec,
} from "./chat-target-kinds"
import { prependTurnMarkers } from "./message-markers"
import { buildPrTools, buildSandboxTools } from "./tools"
import { buildDevServerTools } from "./dev-server-tools"
import { liveDevServerPorts } from "./dev-server-ports"
import { chatFrameReadTools } from "./frame-read-ports"
import { buildDocumentTools } from "./document-tools"
import { buildMockupTools } from "./mockup-tools"
import { otherWorkspacesCodeReadTools } from "./code-read-tools"
import { buildLayerReadTools } from "./layer-read-tools"
import { buildQuestionTools } from "./question-tools"
import { buildFileTools } from "./file-tools"
import { buildMemoryTools } from "./memory-tools"
import { chatFrameDriveTools } from "@/lib/frame-drive/live"
import { canvasFiles } from "@/lib/files"
import { loadCanvasFiles } from "@/lib/files/canvas-files"
import { sandboxProvider } from "@/lib/sandbox"
import { buildSkillTools } from "./skill-tools"
import { appSkillSource, getSkillIndex } from "@/lib/skills"
import { canvasSkills, loadCanvasSkills } from "@/lib/skills/canvas"
import {
  enumerateRepoSkillsForSandbox,
  repoSkillFsForSandbox,
} from "@/lib/skills/sandbox-index"
import { mergeSkillIndexes, type OriginTaggedSkill } from "@/lib/skills/merged"
import type { FileEntryData, MemoryData } from "@/lib/types"

/** A chat on a Branch's sandbox: the Workspace's one chat (#1315). */
export interface WorkspaceTarget {
  sandboxName: string
  /** The chat, which owns the Documents (#1314) and Mockups (#1309) it makes. */
  chatId: string
  /** The member the turn acts for, whose GitHub account git and PRs use. */
  userId: string
  /** No person sent this turn (a Coordinator wake delegated it), so it reads
   *  no account memory (#1513). Otherwise `userId` sent it. */
  senderless?: boolean
}

export interface WorkspaceContext {
  chatId: string
  /** The Branch, read fresh; missing when the sandbox has none. */
  branch?: { ref: string; autoNamed: boolean }
  repoSystemPrompt: string | undefined
  layerDirectory: LayerDirectory
  /**
   * The merged Skill index (Repo, then Canvas, then App), read fresh every
   * turn so a Skill saved mid-chat is known on the next one.
   */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
  files: FileEntryData[]
  /** The sender's account memory (#1513); `null` on a turn nobody sent. */
  accountMemory: MemoryData[] | null
}

export const workspaceChatTarget: ChatTargetSpec<
  WorkspaceTarget,
  WorkspaceContext
> = {
  kind: "agent",
  // Repo-scoped optional system prompt + the merged Skill index: this
  // Branch's Repo Skills (`.claude/skills/` in its sandbox), the canvas's and
  // the App Skills, baked into the prompt.
  async loadContext(room, target) {
    const { sandboxName, chatId } = target
    const [branch, layerDirectory, repo, canvas, memory, files, accountMemory] =
      await Promise.all([
        room
          .readDoc(({ branches, repos }) => {
            // `toArray` is a cached snapshot; read the Branch itself fresh.
            const id = branches
              .toArray()
              .find((a) => a.sandboxName === sandboxName)?.id
            const branch = id ? branches.get(id) : undefined
            if (!branch) return undefined
            return {
              ref: branch.ref,
              autoNamed: branch.autoNamedBranch !== false,
              systemPrompt: repos.get(branch.repoId)?.systemPrompt,
            }
          })
          .catch(() => undefined),
        loadLayerDirectory(room),
        enumerateRepoSkillsForSandbox(sandboxName),
        loadCanvasSkills(room),
        loadCanvasMemory(room),
        loadCanvasFiles(room),
        loadAccountMemory(turnSender(target)),
      ])
    return {
      chatId,
      branch: branch && { ref: branch.ref, autoNamed: branch.autoNamed },
      repoSystemPrompt: branch?.systemPrompt ?? undefined,
      layerDirectory,
      skills: mergeSkillIndexes({ repo, canvas, app: getSkillIndex() }),
      memory,
      files,
      accountMemory,
    }
  },
  skillIndex: (ctx) => ctx.skills,
  buildSystemPrompt(ctx, naming) {
    return buildAgentSystemPrompt({
      repoSystemPrompt: ctx.repoSystemPrompt,
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: ctx.skills,
      memory: ctx.memory,
      files: ctx.files,
      accountMemory: ctx.accountMemory,
      toolNaming: naming,
    })
  },
  tools(room, target) {
    const { sandboxName, chatId, userId } = target
    const sandbox = { sandboxName, room, userId }
    return {
      // Reading, writing and editing files, running commands and plan mode's
      // `submit_plan`: a harness does all of these with its own tools.
      native: buildSandboxTools(sandbox),
      shared: {
        // The Workspace's own dev server: its log and Dev Server Restart.
        ...buildDevServerTools(liveDevServerPorts({ sandboxName, room })),
        // Any frame on the canvas, its own by default: a screenshot and the
        // page's HTML (#1311).
        ...chatFrameReadTools(sandbox),
        // Driving a frame: your own on the Mac (#1389), the shared one on
        // hosted (#1396).
        ...chatFrameDriveTools(sandbox),
        ...buildDocumentTools({ room, chatId }),
        ...buildMockupTools({ room, chatId }),
        // Read-only access to the other Workspaces' code (#1315).
        ...otherWorkspacesCodeReadTools({ room, sandboxName }),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
        // Account and canvas memory (#1515).
        ...buildMemoryTools({
          canvas: room,
          account: accountMemoryStore(target),
        }),
        // The canvas's saved files (#1514); a binary file is saved from the
        // sandbox.
        ...buildFileTools({
          canvas: canvasFiles(room),
          chatId,
          readSource: async (path) =>
            (await sandboxProvider.get({ name: sandboxName })).readFileToBuffer(
              { path }
            ),
        }),
        // Opening the branch's PR (#1480).
        ...buildPrTools(sandbox),
        // Loading Skills, and saving them to the canvas (#1555).
        ...buildSkillTools({
          canvas: canvasSkills(room),
          chatId,
          app: appSkillSource(),
          repo: () => repoSkillFsForSandbox(sandboxName),
        }),
      },
    }
  },
  decorateUserMessage(
    message,
    { planMode, branch, isFirstMessage, delegatedFrom }
  ) {
    // Policy lives here (branch only on the first message); the codec owns
    // the format.
    return prependTurnMarkers(message, {
      planMode,
      branch: isFirstMessage ? branch : undefined,
      delegatedFrom,
    })
  },
}

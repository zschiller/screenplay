import "server-only"

import { buildAgentSystemPrompt, type LayerDirectory } from "./config"
import {
  loadCanvasMemory,
  loadLayerDirectory,
  type ChatTargetSpec,
} from "./chat-target-kinds"
import { prependTurnMarkers } from "./message-markers"
import { buildPrAndSkillTools, buildSandboxTools } from "./tools"
import { buildDevServerTools } from "./dev-server-tools"
import { liveDevServerPorts } from "./dev-server-ports"
import { chatFrameReadTools } from "./frame-read-ports"
import { buildDocumentTools } from "./document-tools"
import { buildMockupTools } from "./mockup-tools"
import { otherWorkspacesCodeReadTools } from "./code-read-tools"
import { buildLayerReadTools } from "./layer-read-tools"
import { buildQuestionTools } from "./question-tools"
import { buildFileTools } from "./file-tools"
import { chatFrameDriveTools } from "@/lib/frame-drive/live"
import { canvasFiles } from "@/lib/files"
import { loadCanvasFiles } from "@/lib/files/canvas-files"
import { sandboxProvider } from "@/lib/sandbox"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import type { OriginTaggedSkill } from "@/lib/skills/merged"
import type { FileEntryData, MemoryData } from "@/lib/types"

/** A chat on a Branch's sandbox: the Workspace's one chat (#1315). */
export interface WorkspaceTarget {
  sandboxName: string
  /** The chat, which owns the Documents (#1314) and Mockups (#1309) it makes. */
  chatId: string
  /** The member the turn acts for, whose GitHub account git and PRs use. */
  userId: string
}

export interface WorkspaceContext {
  chatId: string
  /** The Branch, read fresh; missing when the sandbox has none. */
  branch?: { ref: string; autoNamed: boolean }
  repoSystemPrompt: string | undefined
  layerDirectory: LayerDirectory
  /** Merged App ∪ Repo Skill index, enumerated once from this Branch's sandbox. */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
  files: FileEntryData[]
}

export const workspaceChatTarget: ChatTargetSpec<
  WorkspaceTarget,
  WorkspaceContext
> = {
  kind: "agent",
  // Repo-scoped optional system prompt + the merged App∪Repo Skill index,
  // enumerated from this Branch's sandbox (`.claude/skills/`) and baked into
  // the per-Agent prompt.
  async loadContext(room, { sandboxName, chatId }) {
    const [branch, layerDirectory, skills, memory, files] = await Promise.all([
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
      getMergedSkillIndexForSandbox(sandboxName),
      loadCanvasMemory(room),
      loadCanvasFiles(room),
    ])
    return {
      chatId,
      branch: branch && { ref: branch.ref, autoNamed: branch.autoNamed },
      repoSystemPrompt: branch?.systemPrompt ?? undefined,
      layerDirectory,
      skills,
      memory,
      files,
    }
  },
  buildSystemPrompt(ctx, naming) {
    return buildAgentSystemPrompt({
      repoSystemPrompt: ctx.repoSystemPrompt,
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: ctx.skills,
      memory: ctx.memory,
      files: ctx.files,
      toolNaming: naming,
    })
  },
  tools(room, { sandboxName, chatId, userId }) {
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
        // Opening the branch's PR and loading Skills (#1480).
        ...buildPrAndSkillTools(sandbox),
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

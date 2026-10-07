import "server-only"

import { buildAgentSystemPrompt, type LayerDirectory } from "./config"
import {
  accountFilesFor,
  accountSkillsFor,
  contextFolderFor,
  accountMemoryStore,
  loadAccountFiles,
  loadAccountMemory,
  loadCanvasMemory,
  loadLayerDirectory,
  turnSender,
  type ChatTargetSpec,
} from "./chat-target-kinds"
import { prependTurnMarkers } from "./message-markers"
import { buildGitHubTools } from "./github-tools"
import { buildPrTools, buildSandboxTools } from "./tools"
import { buildDevServerTools } from "./dev-server-tools"
import { liveDevServerPorts } from "./dev-server-ports"
import { buildDoneTools } from "./done-tools"
import { liveDonePorts } from "./done-ports"
import { chatFrameReadTools } from "./frame-read-ports"
import { chatPageScreenshotTools } from "./page-screenshot-ports"
import { buildDocumentTools } from "./document-tools"
import { buildMockupTools } from "./mockup-tools"
import { senderPageOf } from "./sender-page"
import { buildLayerHoldTools } from "./layer-hold"
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
import { appSkillSource } from "@/lib/skills"
import { canvasSkills } from "@/lib/skills/canvas"
import { agentSkillsFor } from "@/lib/skills/agent-skills"
import { repoSkillFsForSandbox } from "@/lib/skills/sandbox-index"
import { skillSources, type OriginTaggedSkill } from "@/lib/skills/sources"
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
  /** The desktop Harness running the turn, whose own Skills the chat lists
   *  (#1560); unset off the desktop or on the in-process engine. */
  harnessKey?: string | null
}

export interface WorkspaceContext {
  chatId: string
  /** The Branch, read fresh; missing when the sandbox has none. */
  branch?: { ref: string; autoNamed: boolean }
  repoSystemPrompt: string | undefined
  /** The Workspace is still installing and starting its dev server. */
  settingUp: boolean
  layerDirectory: LayerDirectory
  /**
   * The merged Skill index (Repo, Canvas, Account, the agent's own, App),
   * read fresh every turn so a Skill saved mid-chat is known on the next one.
   */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
  files: FileEntryData[]
  /** The sender's account memory (#1513); `null` on a turn nobody sent. */
  accountMemory: MemoryData[] | null
  /** The sender's Account Files (#1521); `null` on a turn nobody sent. */
  accountFiles: FileEntryData[] | null
  /** Where the turn's harness reads those files on disk (#1524). */
  contextFolder: string | null
}

export const workspaceChatTarget: ChatTargetSpec<
  WorkspaceTarget,
  WorkspaceContext
> = {
  kind: "agent",
  // This Branch's Repo Skills (`.claude/skills/` in its sandbox), the
  // canvas's, the sender's, the agent's own and every Workspace App Skill. A
  // target with no sandbox yet (the `/` menu of a chat still starting) has no
  // Repo Skills.
  skills(room, target) {
    const { sandboxName } = target
    return skillSources({
      repo: sandboxName ? () => repoSkillFsForSandbox(sandboxName) : undefined,
      canvas: room && canvasSkills(room),
      account: accountSkillsFor(target),
      agent: agentSkillsFor(target.harnessKey),
      app: appSkillSource(),
    })
  },
  // Repo-scoped optional system prompt + the merged Skill index, baked into
  // the prompt.
  async loadContext(
    room,
    target,
    skills = workspaceChatTarget.skills(room, target)
  ) {
    const { chatId } = target
    const { sandboxName } = target
    const [
      branch,
      layerDirectory,
      skillIndex,
      memory,
      files,
      accountMemory,
      accountFiles,
    ] = await Promise.all([
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
            settingUp: branch.codeReady === true,
          }
        })
        .catch(() => undefined),
      loadLayerDirectory(room),
      skills.index(),
      loadCanvasMemory(room),
      loadCanvasFiles(room),
      loadAccountMemory(turnSender(target)),
      loadAccountFiles(turnSender(target)),
    ])
    return {
      chatId,
      branch: branch && { ref: branch.ref, autoNamed: branch.autoNamed },
      repoSystemPrompt: branch?.systemPrompt ?? undefined,
      settingUp: branch?.settingUp ?? false,
      layerDirectory,
      skills: skillIndex,
      memory,
      files,
      accountMemory,
      accountFiles,
      contextFolder: contextFolderFor(target.harnessKey, chatId),
    }
  },
  skillIndex: (ctx) => ctx.skills,
  buildSystemPrompt(ctx, naming) {
    return buildAgentSystemPrompt({
      repoSystemPrompt: ctx.repoSystemPrompt,
      settingUp: ctx.settingUp,
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: ctx.skills,
      memory: ctx.memory,
      files: ctx.files,
      accountMemory: ctx.accountMemory,
      accountFiles: ctx.accountFiles,
      contextFolder: ctx.contextFolder,
      toolNaming: naming,
    })
  },
  tools(room, target, skills = workspaceChatTarget.skills(room, target)) {
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
        // Any page, in the background: a route at any size, or a public URL.
        ...chatPageScreenshotTools({
          room,
          files: {
            canvas: canvasFiles(room),
            account: accountFilesFor(target),
            chatId,
          },
          scope: { sandboxName },
        }),
        // Driving a frame: your own on the Mac (#1389), the shared one on
        // hosted (#1396).
        ...chatFrameDriveTools(sandbox),
        // New ones land on the sender's page, or a page the agent names
        // (#1842).
        ...buildDocumentTools({
          room,
          chatId,
          senderPage: senderPageOf(chatId),
        }),
        ...buildMockupTools({ room, chatId, senderPage: senderPageOf(chatId) }),
        ...buildLayerHoldTools({ room, chatId }),
        // Read-only access to the other Workspaces' code (#1315).
        ...otherWorkspacesCodeReadTools({ room, sandboxName }),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
        // Account and canvas memory (#1515).
        ...buildMemoryTools({
          canvas: room,
          account: accountMemoryStore(target),
        }),
        // The canvas's and the sender's saved files (#1514, #1521); a binary file is saved from the
        // sandbox.
        ...buildFileTools({
          canvas: canvasFiles(room),
          account: accountFilesFor(target),
          chatId,
          readSource: async (path) =>
            (await sandboxProvider.get({ name: sandboxName })).readFileToBuffer(
              { path }
            ),
        }),
        // Opening the branch's PR (#1480).
        ...buildPrTools(sandbox),
        // The canvas's GitHub issues, pull requests and their comments.
        ...buildGitHubTools({
          ...sandbox,
          senderless: turnSender(target) === null,
        }),
        // Marking this chat done once its PR merged or closed (#1705).
        ...buildDoneTools(liveDonePorts({ sandboxName, chatId, room })),
        // Loading Skills, and saving them to the canvas (#1555).
        ...buildSkillTools({
          skills,
          canvas: canvasSkills(room),
          account: accountSkillsFor(target),
          chatId,
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

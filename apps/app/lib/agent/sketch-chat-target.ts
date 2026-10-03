import "server-only"

import { buildSketchSystemPrompt, type LayerDirectory } from "./config"
import {
  accountFilesFor,
  accountMemoryStore,
  loadAccountFiles,
  loadAccountMemory,
  loadCanvasMemory,
  loadLayerDirectory,
  turnSender,
  type ChatTargetSpec,
} from "./chat-target-kinds"
import { prependTurnMarkers } from "./message-markers"
import { buildDocumentTools } from "./document-tools"
import { buildMockupTools } from "./mockup-tools"
import { buildLayerReadTools } from "./layer-read-tools"
import { buildQuestionTools } from "./question-tools"
import { sketchAppSkills, sketchSkillIndex } from "./sketch-tools"
import { buildSkillTools } from "./skill-tools"
import { canvasSkills, loadCanvasSkills } from "@/lib/skills/canvas"
import { agentSkillsFor, loadAgentSkills } from "@/lib/skills/agent-skills"
import { mergeSkillIndexes, type OriginTaggedSkill } from "@/lib/skills/merged"
import { buildFileTools } from "./file-tools"
import { buildMemoryTools } from "./memory-tools"
import { chatFrameDriveTools } from "@/lib/frame-drive/live"
import { canvasFiles } from "@/lib/files"
import { loadCanvasFiles } from "@/lib/files/canvas-files"
import type { FileEntryData, MemoryData } from "@/lib/types"

/** A Sketch Chat (`lib/chat/sketch-chat.ts`): a chat with no repository. */
export interface SketchTarget {
  /** The Sketch Chat, which owns the Documents and Mockups it makes. */
  chatId: string
  /** The member the turn acts for, in whose view it drives a Mockup. */
  userId: string
  /** No person sent this turn (a Coordinator wake delegated it), so it reads
   *  no account memory (#1513). Otherwise `userId` sent it. */
  senderless?: boolean
  /** The desktop Harness running the turn, whose own Skills the chat lists
   *  (#1560); unset off the desktop or on the in-process engine. */
  harnessKey?: string | null
}

export interface SketchContext {
  chatId: string
  layerDirectory: LayerDirectory
  /** The canvas's Skills, the agent's own, then its Mockup App Skills; no
   *  repository. */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
  files: FileEntryData[]
  /** The sender's account memory (#1513); `null` on a turn nobody sent. */
  accountMemory: MemoryData[] | null
  /** The sender's Account Files (#1521); `null` on a turn nobody sent. */
  accountFiles: FileEntryData[] | null
}

/** No sandbox: Documents and Mockups only, and nothing that touches code. */
export const sketchChatTarget: ChatTargetSpec<SketchTarget, SketchContext> = {
  kind: "sketch",
  async loadContext(room, target) {
    const [
      layerDirectory,
      canvas,
      agent,
      memory,
      files,
      accountMemory,
      accountFiles,
    ] = await Promise.all([
      loadLayerDirectory(room),
      loadCanvasSkills(room),
      loadAgentSkills(agentSkillsFor(target.harnessKey)),
      loadCanvasMemory(room),
      loadCanvasFiles(room),
      loadAccountMemory(turnSender(target)),
      loadAccountFiles(turnSender(target)),
      loadAccountFiles(turnSender(target)),
    ])
    return {
      chatId: target.chatId,
      layerDirectory,
      skills: mergeSkillIndexes({ canvas, agent, app: sketchSkillIndex() }),
      memory,
      files,
      accountMemory,
      accountFiles,
    }
  },
  skillIndex: (ctx) => ctx.skills,
  buildSystemPrompt(ctx, naming) {
    return buildSketchSystemPrompt({
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: ctx.skills,
      memory: ctx.memory,
      files: ctx.files,
      accountMemory: ctx.accountMemory,
      accountFiles: ctx.accountFiles,
      toolNaming: naming,
    })
  },
  tools(room, target) {
    const { chatId, userId, harnessKey } = target
    return {
      shared: {
        ...buildDocumentTools({ room, chatId }),
        ...buildMockupTools({ room, chatId }),
        // Driving a Mockup in the asker's view (#1391).
        ...chatFrameDriveTools({ room, userId }),
        // The canvas's Skills and the Mockup App Skills (#1555).
        ...buildSkillTools({
          canvas: canvasSkills(room),
          chatId,
          app: sketchAppSkills,
          agent: agentSkillsFor(harnessKey),
        }),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
        // Account and canvas memory (#1515).
        ...buildMemoryTools({
          canvas: room,
          account: accountMemoryStore(target),
        }),
        // The canvas's and the sender's saved files (#1514, #1521): text only, with no sandbox.
        ...buildFileTools({
          canvas: canvasFiles(room),
          account: accountFilesFor(target),
          chatId,
        }),
      },
    }
  },
  // No branch and no plan mode; a Delegated Message still says who sent it.
  decorateUserMessage(message, { delegatedFrom }) {
    return prependTurnMarkers(message, { delegatedFrom })
  },
}

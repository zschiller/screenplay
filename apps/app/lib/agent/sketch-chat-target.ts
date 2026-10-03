import "server-only"

import { buildSketchSystemPrompt, type LayerDirectory } from "./config"
import {
  accountMemoryStore,
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
}

export interface SketchContext {
  chatId: string
  layerDirectory: LayerDirectory
  /** The canvas's Skills, then its Mockup App Skills; no repository. */
  skills: OriginTaggedSkill[]
  memory: MemoryData[]
  files: FileEntryData[]
  /** The sender's account memory (#1513); `null` on a turn nobody sent. */
  accountMemory: MemoryData[] | null
}

/** No sandbox: Documents and Mockups only, and nothing that touches code. */
export const sketchChatTarget: ChatTargetSpec<SketchTarget, SketchContext> = {
  kind: "sketch",
  async loadContext(room, target) {
    const [layerDirectory, canvas, memory, files, accountMemory] =
      await Promise.all([
        loadLayerDirectory(room),
        loadCanvasSkills(room),
        loadCanvasMemory(room),
        loadCanvasFiles(room),
        loadAccountMemory(turnSender(target)),
      ])
    return {
      chatId: target.chatId,
      layerDirectory,
      skills: mergeSkillIndexes({ canvas, app: sketchSkillIndex() }),
      memory,
      files,
      accountMemory,
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
      toolNaming: naming,
    })
  },
  tools(room, target) {
    const { chatId, userId } = target
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
        }),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
        // Account and canvas memory (#1515).
        ...buildMemoryTools({
          canvas: room,
          account: accountMemoryStore(target),
        }),
        // The canvas's saved files (#1514): text only, with no sandbox.
        ...buildFileTools({ canvas: canvasFiles(room), chatId }),
      },
    }
  },
  // No branch and no plan mode; a Delegated Message still says who sent it.
  decorateUserMessage(message, { delegatedFrom }) {
    return prependTurnMarkers(message, { delegatedFrom })
  },
}

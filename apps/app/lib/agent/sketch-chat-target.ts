import "server-only"

import { buildSketchSystemPrompt, type LayerDirectory } from "./config"
import {
  loadCanvasMemory,
  loadLayerDirectory,
  type ChatTargetSpec,
} from "./chat-target-kinds"
import { prependTurnMarkers } from "./message-markers"
import { buildDocumentTools } from "./document-tools"
import { buildMockupTools } from "./mockup-tools"
import { buildLayerReadTools } from "./layer-read-tools"
import { buildQuestionTools } from "./question-tools"
import { buildSketchSkillTools, sketchSkillIndex } from "./sketch-tools"
import { chatFrameDriveTools } from "@/lib/frame-drive/live"
import type { MemoryData } from "@/lib/types"

/** A Sketch Chat (`lib/chat/sketch-chat.ts`): a chat with no repository. */
export interface SketchTarget {
  /** The Sketch Chat, which owns the Documents and Mockups it makes. */
  chatId: string
  /** The member the turn acts for, in whose view it drives a Mockup. */
  userId: string
}

export interface SketchContext {
  chatId: string
  layerDirectory: LayerDirectory
  memory: MemoryData[]
}

/** No sandbox: Documents and Mockups only, and nothing that touches code. */
export const sketchChatTarget: ChatTargetSpec<SketchTarget, SketchContext> = {
  kind: "sketch",
  async loadContext(room, target) {
    const [layerDirectory, memory] = await Promise.all([
      loadLayerDirectory(room),
      loadCanvasMemory(room),
    ])
    return { chatId: target.chatId, layerDirectory, memory }
  },
  buildSystemPrompt(ctx, naming) {
    return buildSketchSystemPrompt({
      layerDirectory: ctx.layerDirectory,
      chatId: ctx.chatId,
      skills: sketchSkillIndex(),
      memory: ctx.memory,
      toolNaming: naming,
    })
  },
  tools(room, { chatId, userId }) {
    return {
      shared: {
        ...buildDocumentTools({ room, chatId }),
        ...buildMockupTools({ room, chatId }),
        // Driving a Mockup in the asker's view (#1391).
        ...chatFrameDriveTools({ room, userId }),
        // The Mockup App Skills.
        ...buildSketchSkillTools(),
        ...buildLayerReadTools({ room }),
        ...buildQuestionTools(),
      },
    }
  },
  // No branch and no plan mode; a Delegated Message still says who sent it.
  decorateUserMessage(message, { delegatedFrom }) {
    return prependTurnMarkers(message, { delegatedFrom })
  },
}

import "server-only"

import type { Tool } from "ai"
import { AcpUpdateConsumer } from "./acp/consumer"
import { liveAcpConsumerPorts } from "./acp/consumer-live"
import { driveEngineTurn } from "./acp/live-turn"
import type { Engine } from "./acp/engine-seam"
import { loadAcpHistoryForModel } from "./persistence"
import { withPromptLast } from "./user-turn"
import { isRunActive, transition } from "./run-state"
import { steerInbox } from "./steer-inbox"
import { wireToContentBlocks } from "./acp/markers"
import { broadcastControl, broadcastSignal } from "./broadcast"
import { redactSensitiveInfo } from "./redact"
import { withRedactedOutput } from "./toolset"
import type { ContentBlock } from "./acp/schema"
import type { AcpMessageRecord } from "./acp/record"

/**
 * Drive one live engine turn to completion (ADR 0006). The live routes call this
 * from `after()`: it loads the crash-repaired ACP-native history, builds the
 * {@link AcpUpdateConsumer} over the live ports, and runs the selected engine
 * through {@link driveEngineTurn} (which owns the abort watchdog). The engine
 * reports its own terminal outcomes — completion, stop, error — through the
 * consumer; this wrapper's catch is the safety net for a failure *around* the
 * engine (history load, a throw that never reached the sink) so a dropped turn
 * never strands the UI with an indefinite spinner.
 */
export async function launchEngineTurn(params: {
  engine: Engine
  roomId: string
  chatId: string
  runId: string
  systemPrompt: string
  /** The turn's Skill index, for a resumed harness session (#1555). */
  skillsNote?: string
  model: string
  tools: Record<string, Tool>
  /** Whether the turn was sent in plan mode (the external engine maps it to ACP). */
  planMode?: boolean
  /** The turn answers a Coordinator wake; its no-reply line never shows. */
  wake?: boolean
  /** Where the Engine says whether this run takes Steers (#1250). */
  reportSteering(steers: boolean): Promise<void>
  /** The Workspace's env var values to scrub from tool output and the chat
   *  (`secretPatterns`, #1416). */
  secrets?: readonly string[]
  /**
   * Adds the images a user message attached to its content (#1525), so the
   * model sees them on the turn they were sent. The stored turn keeps only
   * its text; this runs on the new message and each Steer as the Engine
   * takes it.
   */
  withAttachedImages?: (blocks: ContentBlock[]) => Promise<ContentBlock[]>
}): Promise<void> {
  const {
    engine,
    roomId,
    chatId,
    runId,
    systemPrompt,
    skillsNote,
    model,
    planMode,
    wake,
    reportSteering,
    secrets = [],
    withAttachedImages = async (blocks: ContentBlock[]) => blocks,
  } = params
  const consumer = new AcpUpdateConsumer(
    liveAcpConsumerPorts(roomId, chatId, runId),
    { wake, secrets }
  )
  // The built-in agent's tool output is scrubbed before the model sees it.
  const tools =
    secrets.length > 0
      ? withRedactedOutput(params.tools, secrets)
      : params.tools
  try {
    const history = await withImagesOnLastUserTurn(
      withPromptLast(await loadAcpHistoryForModel(chatId)),
      withAttachedImages
    )
    await driveEngineTurn(
      engine,
      {
        chatId,
        runId,
        roomId,
        systemPrompt,
        skillsNote,
        model,
        history,
        tools,
        planMode,
      },
      consumer,
      {
        isRunActive,
        takeSteers: async (id) =>
          Promise.all(
            (await steerInbox.take(id)).map(async (steer) => ({
              id: steer.id,
              content: await withAttachedImages(
                wireToContentBlocks(steer.message)
              ),
              ...(steer.userId ? { sentBy: steer.userId } : {}),
            }))
          ),
        releaseSteers: (ids) => steerInbox.release(ids),
        reportSteering,
      }
    )
  } catch (e) {
    console.error("engine turn failed:", e)
    const message = e instanceof Error ? e.message : String(e)
    try {
      await broadcastControl(roomId, chatId, {
        kind: "error",
        message: redactSensitiveInfo(message, secrets),
      })
    } finally {
      await transition(runId, "failed").catch(() => {})
      await broadcastSignal(roomId, chatId, "chat-stream-end")
    }
  }
}

/** The history with the newest user message's attached images added. */
async function withImagesOnLastUserTurn(
  history: AcpMessageRecord[],
  withAttachedImages: (blocks: ContentBlock[]) => Promise<ContentBlock[]>
): Promise<AcpMessageRecord[]> {
  let index = history.length - 1
  while (index >= 0 && history[index]!.role !== "user") index--
  const record = history[index]
  if (!record || record.role !== "user") return history
  const content = await withAttachedImages(record.content)
  if (content === record.content) return history
  return history.map((r, i) => (i === index ? { ...record, content } : r))
}

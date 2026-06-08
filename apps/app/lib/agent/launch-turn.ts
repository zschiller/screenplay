import "server-only"

import type { Tool } from "ai"
import { AcpUpdateConsumer } from "./acp/consumer"
import { liveAcpConsumerPorts } from "./acp/consumer-live"
import { driveEngineTurn } from "./acp/live-turn"
import type { Engine } from "./acp/engine-seam"
import { loadAcpHistoryForModel } from "./persistence"
import { isRunActive, transition } from "./run-state"
import { broadcastControl, broadcastSignal } from "./broadcast"

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
  model: string
  tools: Record<string, Tool>
}): Promise<void> {
  const { engine, roomId, chatId, runId, systemPrompt, model, tools } = params
  const consumer = new AcpUpdateConsumer(
    liveAcpConsumerPorts(roomId, chatId, runId)
  )
  try {
    const history = await loadAcpHistoryForModel(chatId)
    await driveEngineTurn(
      engine,
      { chatId, runId, roomId, systemPrompt, model, history, tools },
      consumer,
      { isRunActive }
    )
  } catch (e) {
    console.error("engine turn failed:", e)
    const message = e instanceof Error ? e.message : String(e)
    try {
      await broadcastControl(roomId, chatId, { kind: "error", message })
    } finally {
      await transition(runId, "failed").catch(() => {})
      await broadcastSignal(roomId, chatId, "chat-stream-end")
    }
  }
}

import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { blockText } from "@/lib/agent/acp/schema"
import { parseUserMessage } from "@/lib/agent/message-markers"
import { prEventMessage, prEventWakes } from "./events"
import type { PrEvent } from "./watch"

/**
 * **PR wakes** (#1703): which PR events start a turn in the Branch's Workspace
 * Chat, and the order they go in. Checks failing, a conflict, the merge and
 * the close each wake the chat's agent, acting for the Branch's owner, so it
 * fixes and pushes or says why not. A wake never joins a turn in flight: it
 * waits, held, until the chat's run is over, and goes on the next look. After
 * {@link PR_WAKE_CAP} wakes in a row on one PR with no message from a person,
 * the next event only shows as its line and the chat turns needs-you, so a
 * fix loop can't run forever.
 *
 * Free of the database and Turn Launch: the live wiring hands in its ports
 * (`run.ts`), and the tests a fake engine's.
 */

/** Wake turns in a row on one PR before PR events stop waking the agent. */
export const PR_WAKE_CAP = 3

/** A PR event bound for its Branch's Workspace Chat. */
export interface ChatPrEvent extends PrEvent {
  chatId: string
}

/** How a wake launch went. `unavailable`: the Workspace can't take a turn
 *  (Done, stopped or setting up), so the event only shows as its line. */
export type PrWakeOutcome = "started" | "busy" | "unavailable"

export interface PrWakePorts {
  /** The chat's saved transcript. */
  history(chatId: string): Promise<AcpMessageRecord[]>
  /** Add the event to the chat as its line, starting no turn. */
  addLine(event: ChatPrEvent, wire: string): Promise<void>
  /** Start the wake turn, its message the event's line; `busy` while the
   *  chat has a run that isn't over. */
  launch(event: ChatPrEvent, wire: string): Promise<PrWakeOutcome>
  /** Past the cap: the Branch's PR waits on a person (needs-you). */
  pauseWakes(event: ChatPrEvent): Promise<void>
}

/**
 * Wake turns on PR `number` since the last message a person sent: PR events
 * of a waking kind for that PR, back to the newest user message with a
 * sender. Delegated messages and Coordinator wakes have none, so they don't
 * reset it.
 */
export function consecutivePrWakes(
  history: readonly AcpMessageRecord[],
  number: number
): number {
  let wakes = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i]!
    if (record.role !== "user") continue
    const { prEvent } = parseUserMessage(record.content.map(blockText).join(""))
    if (prEvent) {
      if (prEvent.number === number && prEventWakes(prEvent.kind)) wakes++
      continue
    }
    if (record.sentBy) break
  }
  return wakes
}

/**
 * Deliver PR events to their Workspace Chats: `held` (from an earlier look)
 * first, then `events`, in order. Returns the events still held, for the next
 * look. Once a chat starts a wake turn, or is busy, its later events wait
 * behind it, so they reach the chat in the order they happened.
 */
export async function deliverPrWakes(
  ports: PrWakePorts,
  held: readonly ChatPrEvent[],
  events: readonly ChatPrEvent[]
): Promise<ChatPrEvent[]> {
  const stillHeld: ChatPrEvent[] = []
  const waiting = new Set<string>()
  for (const event of [...held, ...events]) {
    if (waiting.has(event.chatId)) {
      stillHeld.push(event)
      continue
    }
    const wire = prEventMessage(event)
    if (!prEventWakes(event.kind)) {
      await ports.addLine(event, wire)
      continue
    }
    const wakes = consecutivePrWakes(
      await ports.history(event.chatId),
      event.number
    )
    if (wakes >= PR_WAKE_CAP) {
      await ports.addLine(event, wire)
      await ports.pauseWakes(event)
      continue
    }
    const outcome = await ports.launch(event, wire).catch((e) => {
      console.error("PR wake failed:", e)
      return "unavailable" as const
    })
    if (outcome === "unavailable") {
      await ports.addLine(event, wire)
      continue
    }
    waiting.add(event.chatId)
    if (outcome === "busy") stillHeld.push(event)
  }
  return stillHeld
}

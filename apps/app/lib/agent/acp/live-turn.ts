import type { AcpUpdateConsumer } from "./consumer"
import type {
  DeliverSteer,
  Engine,
  EngineTurn,
  TakenSteer,
} from "./engine-seam"

/** How often the abort watchdog polls the run's liveness. */
const ABORT_POLL_INTERVAL_MS = 250

/**
 * What {@link driveEngineTurn} needs from the run lifecycle: a liveness poll for
 * the abort watchdog. Injected (like the consumer's ports) so the keystone test
 * drives the same boundary over an in-memory run-state.
 */
export interface DriveTurnDeps {
  /** Whether the run is still the live one (`running`); false once stopped/superseded. */
  isRunActive(runId: string): Promise<boolean>
  /** Overridable poll interval — tests pass a small value; production uses the default. */
  pollIntervalMs?: number
  /**
   * Take the run's pending Steers (#1190), oldest first. Present where the
   * route keeps a Steer inbox; the Engine calls it at each step boundary of a
   * run that steers.
   */
  takeSteers?(runId: string): Promise<TakenSteer[]>
  /**
   * Put taken Steers back in the inbox, pending again (#1192): the agent
   * didn't take them, so a later step boundary or Turn Launch hands them on.
   */
  releaseSteers?(ids: string[]): Promise<void>
  /**
   * Where the run's answer to "does it take Steers?" goes (#1250). The Engine
   * reports once its session is open.
   */
  reportSteering?(steers: boolean): Promise<void>
}

/**
 * Drive one engine turn at the live-route boundary (ADR 0006): run the selected
 * {@link Engine} against the {@link EngineTurn}, forwarding every `EngineUpdate`
 * to the {@link AcpUpdateConsumer}, with the **abort watchdog at this boundary**.
 *
 * The watchdog polls {@link DriveTurnDeps.isRunActive} and aborts the turn the
 * moment the run stops being live — a user `/stop` (recorded `aborted`) or a
 * newer message that superseded it. It also pre-checks once before starting, so
 * a stop that landed before the background task ran aborts deterministically
 * rather than waiting a poll interval. The engine reports the resulting
 * cancellation through the sink as a stop, and the consumer surfaces it without
 * a `failed` transition (the run lifecycle already recorded the terminal stop).
 * The same abort stops the consumer, so nothing an Engine emits after it
 * reaches the chat or the log (#1263).
 *
 * This is the move ADR 0006 sequenced last: the live routes drive
 * `selectEngine → Engine.run → AcpUpdateConsumer` through here instead of the
 * legacy `runAgentLoop`. The watchdog used to live inside that loop; it now sits
 * at the seam so every engine inherits it for free.
 */
export async function driveEngineTurn(
  engine: Engine,
  turn: EngineTurn,
  consumer: AcpUpdateConsumer,
  deps: DriveTurnDeps
): Promise<void> {
  const controller = new AbortController()
  // Once the run is no longer live, the consumer passes nothing more on to the
  // chat or the log, whatever the Engine emits while it winds down.
  controller.signal.addEventListener("abort", () => consumer.stop(), {
    once: true,
  })

  // Pre-check: a /stop (or supersession) may have already moved the run off
  // `running` before this background task started. Abort up front so the engine
  // reports a stop without streaming a turn the user already ended.
  if (!(await deps.isRunActive(turn.runId))) controller.abort()

  const watchdog = setInterval(() => {
    void deps.isRunActive(turn.runId).then(
      (active) => {
        // Halt the moment the run stops being live — covers a user /stop
        // (aborted) and a newer message that superseded us.
        if (!active) controller.abort()
      },
      () => {
        // Transient DB blip — keep going; the next tick retries.
      }
    )
  }, deps.pollIntervalMs ?? ABORT_POLL_INTERVAL_MS)

  // A run that steers pulls its pending Steers at each step boundary; they
  // are settled into the transcript before the Engine hands them to the
  // model, so the log and every client put them where the agent took them.
  // With `deliver` (#1192), a Steer settles only once the agent took it.
  const { takeSteers, releaseSteers, reportSteering } = deps
  const steerable = takeSteers
    ? {
        ...turn,
        takeSteers: async (deliver?: DeliverSteer) => {
          if (controller.signal.aborted) return []
          const steers = await takeSteers(turn.runId)
          if (!deliver) {
            await consumer.acceptSteers(steers)
            return steers
          }
          const delivered: TakenSteer[] = []
          for (const [index, steer] of steers.entries()) {
            // A stop while the agent was answering ends the turn anyway; the
            // Steer goes back so the sender gets it back.
            if (!(await deliver(steer)) || controller.signal.aborted) {
              await releaseSteers?.(steers.slice(index).map((s) => s.id))
              break
            }
            await consumer.acceptSteers([steer])
            delivered.push(steer)
          }
          return delivered
        },
        reportSteering: async (steers: boolean) => {
          await reportSteering?.(steers)
        },
      }
    : turn

  try {
    await engine.run(
      steerable,
      (update) => consumer.handle(update),
      controller.signal
    )
  } finally {
    clearInterval(watchdog)
  }
}

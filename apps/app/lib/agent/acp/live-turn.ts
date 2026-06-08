import type { AcpUpdateConsumer } from "./consumer"
import type { Engine, EngineTurn } from "./engine-seam"

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

  try {
    await engine.run(
      turn,
      (update) => consumer.handle(update),
      controller.signal
    )
  } finally {
    clearInterval(watchdog)
  }
}

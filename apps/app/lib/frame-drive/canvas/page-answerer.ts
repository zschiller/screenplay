import type { PageAsk } from "@/lib/frame-drive/canvas/protocol"

/** The asks the page's bridge answers: everything but take and release. */
export type BridgePageAsk = Exclude<PageAsk, { kind: "take" | "release" }>

/** The bridge message that answers a locate, cursor or state ask. */
export function pageAskMessage(ask: BridgePageAsk) {
  return ask.kind === "locate"
    ? {
        type: "screenplay:drive-locate" as const,
        target: ask.target,
        focus: ask.focus,
        replace: ask.replace,
        show: ask.show,
      }
    : ask.kind === "cursor"
      ? { type: "screenplay:drive-cursor" as const, ...ask.what }
      : { type: "screenplay:drive-state" as const, selector: ask.selector }
}

/** Input a gesture took, as `takeFrameInput` hands it over. */
export type TakenInput = {
  window: { x: number; y: number } | null
  release(rest?: boolean): void | Promise<void>
}

/**
 * The canvas's answer to each step of a gesture the Mac plays with real input
 * (#1385), for one frame. Locate, cursor and state asks go to the page's
 * bridge (as {@link pageAskMessage}); take and release hand the frame the
 * input and back.
 *
 * Only one gesture holds the input: a take releases the one before, including
 * a hover's pointer resting in the frame (kept until the next take, the
 * person's pointer or `dispose`). A gesture that never hands the input back
 * (the server went away) does after `maxTakenMs`.
 *
 * No React and no module state, so the drive hook and the Mac's browser test
 * answer asks with this same code.
 */
export function createPageAnswerer({
  bridge,
  take,
  maxTakenMs,
}: {
  /** Ask the page's bridge, with {@link pageAskMessage}; null when it fails
   *  or doesn't answer. */
  bridge: (ask: BridgePageAsk) => Promise<unknown>
  /** Take the frame's input, aiming the pointer at `at`. Null when the frame
   *  isn't there. */
  take: (at: { x: number; y: number } | undefined) => Promise<TakenInput | null>
  maxTakenMs: number
}) {
  let taken: {
    input: TakenInput
    timer: ReturnType<typeof setTimeout>
  } | null = null

  const release = async (rest = false) => {
    if (!taken) return
    const held = taken
    clearTimeout(held.timer)
    // A resting hover stays held, so the next take or dispose ends it.
    if (!rest) taken = null
    await held.input.release(rest)
  }

  return {
    async answer(ask: PageAsk): Promise<unknown> {
      if (ask.kind === "release") return release(ask.rest).then(() => null)
      if (ask.kind !== "take") return bridge(ask)
      await release()
      const input = await take(ask.at)
      if (!input) return null
      const held = {
        input,
        timer: setTimeout(() => {
          if (taken === held) release().catch(() => {})
        }, maxTakenMs),
      }
      taken = held
      return { window: input.window }
    },
    /** Hand back any input still held, for a frame going away. */
    dispose() {
      release().catch(() => {})
    },
  }
}

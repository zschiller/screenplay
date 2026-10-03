import type { AskerCanvas } from "@/lib/frame-drive/canvas/channel"
import type { FrameDriver } from "@/lib/frame-drive/tools"

/**
 * A hosted chat's driver (#1396): each page goes to the driver for its kind.
 * A frame goes to its one shared browser, a Mockup to the asker's own view
 * (#1391), unless it's live: then it too has one shared browser (#1523). Showing a shared frame brings it into the asker's view (#1390)
 * through their canvas; the Mockups' driver does that itself.
 */
export function routeChatDriver(deps: {
  /** The Room's driver for shared frames. */
  shared: FrameDriver
  /** The asker's driver for Mockups. */
  mockups: FrameDriver
  isMockup(id: string): Promise<boolean>
  /** The Mockup is live, its page in a shared browser. */
  isLiveMockup(id: string): Promise<boolean>
  /** The asker's canvas. */
  canvas: Pick<AskerCanvas, "reveal">
}): FrameDriver {
  const { shared, mockups, canvas } = deps
  const pick = async (id: string) =>
    (await deps.isMockup(id)) && !(await deps.isLiveMockup(id))
      ? mockups
      : shared
  return {
    run: async (id, op) => (await pick(id)).run(id, op),
    async start(id, opts) {
      const driver = await pick(id)
      const outcome = await driver.start(id, opts)
      if (
        driver === shared &&
        outcome.status === "driving" &&
        opts.pace === "show"
      ) {
        // Best effort, as on the Mac: the demo runs if their canvas can't move.
        await canvas.reveal(id).catch(() => null)
      }
      return outcome
    },
    screenshot: async (id) => (await pick(id)).screenshot(id),
    frameUnavailable: async (id) => (await pick(id)).frameUnavailable(id),
    letGo: async (id) => (await pick(id)).letGo(id),
    // A shared frame runs whether or not anyone has the canvas open; a
    // Mockup says so itself when the asker's canvas is closed.
    canvasUnavailable: async () => null,
  }
}

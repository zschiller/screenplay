import { stubLogs } from "../../fixtures/streams"
import type { Screen } from "../screen"
import { holdYjsConnection, ids } from "../helpers"

const screens: Screen[] = [
  ...(
    [
      ["booting", "framesBooting", "Booting"],
      ["starting", "framesStarting", "Starting"],
      ["failed", "framesFailed", "Failed"],
      ["stopped", "framesStopped", "Stopped"],
    ] as const
  ).map(([stage, branch, label]): Screen => ({
    name: `play-${stage}`,
    description: `The prototype player on a Workspace that is ${label.toLowerCase()}.`,
    path: playPath(ids.branches[branch], `layer-frames-${stage}`),
    settleMs: 2500,
  })),
  {
    name: "canvas-frame-open-logs",
    description:
      "A failed frame's Open logs: the chat panel opens on that Workspace's sandbox logs.",
    path: `/${ids.rooms.frameStates}`,
    beforeNavigate: (page) => stubLogs(page, "reconnecting"),
    prepare: async (page) => {
      await page
        .locator('[data-frame-stage="workspace-failed"]')
        .getByRole("button", { name: "Open logs" })
        .click({ timeout: 15_000 })
    },
    settleMs: 1200,
  },
  {
    name: "play-connecting",
    description:
      "The prototype player before the room syncs, held by a silent Yjs socket.",
    path: playPath(ids.branches.framesReady, "layer-frames-ready"),
    beforeNavigate: holdYjsConnection,
  },
]

export default screens

/** The prototype player's URL for one Workspace, opened from one of its frames. */
function playPath(branchId: string, iframeLayerId: string): string {
  return `/play/${ids.rooms.frameStates}/${branchId}?iframe-layer=${iframeLayerId}`
}

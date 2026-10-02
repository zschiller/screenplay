import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import { ids, serveYjsDoc } from "../helpers"

const screens: Screen[] = [
  {
    name: "player",
    description: "The prototype player for a running Workspace.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
  },
  {
    name: "player-agent",
    description:
      "The prototype player with the agent open beside it, composer in view.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    prepare: openPlayerAgent,
    settleMs: 600,
  },
  {
    name: "player-chat-warming-up",
    description:
      "The player's agent panel while the Workspace's sandbox is still warming up.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    beforeNavigate: (page) =>
      serveYjsDoc(page, (c) =>
        c.branches.set(ids.branches.checkoutPolish, {
          id: ids.branches.checkoutPolish,
          repoId: "repo-warming-up",
          sandboxName: "",
          gitUrl: "",
          ref: "checkout-polish",
          previewDomain: "",
          port: 3000,
          status: "creating",
          createdAt: 0,
        })
      ),
    prepare: openPlayerAgent,
    settleMs: 400,
  },
  {
    name: "player-chat-not-found",
    description:
      "The player's agent panel once its Workspace has been deleted from the Canvas.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    beforeNavigate: (page) => serveYjsDoc(page, () => {}),
    prepare: openPlayerAgent,
    settleMs: 400,
  },
]

export default screens

/** Open the player's agent panel from the HUD. */
async function openPlayerAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open agent" }).click()
}

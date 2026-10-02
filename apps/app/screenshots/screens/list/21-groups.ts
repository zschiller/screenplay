import type { Page } from "playwright-core"

import { COLD_WORKSPACE_PREFIX } from "../../lib/preview-url"
import type { Screen } from "../screen"
import { ids, serveYjsDoc, gettingStartedRepo } from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-frame-states",
    description:
      "A frame in every Workspace stage: booting, starting, ready, failed, stopped, and no Workspace. Each Group's frames differ, so every frame names its own Workspace (#1276).",
    path: `/${ids.rooms.frameStates}`,
    // Long enough for the ready frame's page to paint and the probe of the
    // cold ones to settle on "not ready".
    settleMs: 2500,
  },
  {
    name: "canvas-group-set-workspace-hover",
    description:
      "Hovering the label of a Group whose frames show different Workspaces: Set workspace appears, to put every frame on one (#1276).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await page
        .locator(".group\\/group-label")
        .filter({ hasText: "Progress" })
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "canvas-group-set-workspace-open",
    description:
      "Set workspace opened from a hovered Group whose frames differ: Show <Group> from…, and a footer saying how many frames move (#1276).",
    path: `/${ids.rooms.frameStates}`,
    prepare: async (page) => {
      await page
        .locator(".group\\/group-label")
        .filter({ hasText: "Progress" })
        .first()
        .hover({ timeout: 15_000 })
      await page
        .getByRole("button", { name: "Set workspace" })
        .first()
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Show Progress from…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
  {
    name: "canvas-group-workspace-hover",
    description:
      "Hovering a Group's Workspace pill on its group label: the up-down chevron shows that it switches the whole Group (#869).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      // Both Pricing frames show one Workspace, so only the group label
      // names it (#1276).
      await page
        .locator('[data-slot="group-workspace"]')
        .first()
        .hover({ timeout: 15_000 })
    },
    settleMs: 600,
  },
  {
    name: "canvas-group-workspace-switcher",
    description:
      "A Group's Workspace list, opened from the pill on its group label: Show <Group> from…, and a footer saying how many frames move (#869).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Show Pricing from another workspace/ })
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Show Pricing from…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
  {
    name: "canvas-group-workspace-agent-working",
    description:
      "A Group whose Workspace has an agent working: its label shows the 9-dot, the plain name and the merged PR, and so does the Canvas list's Group row (#975).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await page
        .getByText("Pricing · laptop", { exact: true })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
      await page.mouse.move(5, 5)
    },
    settleMs: 800,
  },
  {
    name: "canvas-frame-workspace-host-agent-working",
    description:
      "A selected frame whose Workspace has an agent working: the address bar's host shows the 9-dot, the plain name and the PR (#975).",
    path: `/${ids.rooms.pricing}`,
    prepare: async (page) => {
      await page
        .getByText("Pricing · laptop", { exact: true })
        .first()
        .click({ timeout: 15_000 })
      await page
        .locator("#frame-toolbar-portal button")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
      await page.mouse.move(5, 5)
    },
    settleMs: 800,
  },
  {
    name: "canvas-group-choose-workspace",
    description:
      "A Group whose frames have no Workspace yet: Choose a workspace sits on its group label, not on each frame (#871).",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: (page) => serveUnassignedGroup(page),
    settleMs: 600,
  },
  {
    name: "canvas-group-choose-workspace-open",
    description:
      "An unassigned Group's Workspace list, opened from Choose a workspace on its label: picking sets the Group and every frame (#871).",
    path: `/${ids.rooms.empty}`,
    beforeNavigate: (page) => serveUnassignedGroup(page),
    prepare: async (page) => {
      await page
        .locator(".canvas-frame-label")
        .getByRole("button", { name: "Choose a workspace" })
        .first()
        .click({ timeout: 15_000 })
      await page
        .getByPlaceholder("Search workspaces…")
        .waitFor({ state: "visible", timeout: 15_000 })
    },
    settleMs: 800,
  },
]

export default screens

/**
 * A Canvas with two ready Workspaces and one Group ("Checkout") of two frames,
 * neither on a Workspace yet (#871).
 */
function serveUnassignedGroup(page: Page): Promise<void> {
  return serveYjsDoc(page, (c) => {
    c.repos.set(gettingStartedRepo.id, gettingStartedRepo)
    const branch = (id: string, ref: string, title: string, order: number) =>
      c.branches.set(id, {
        id,
        repoId: gettingStartedRepo.id,
        sandboxName: `${COLD_WORKSPACE_PREFIX}${ref}`,
        gitUrl: gettingStartedRepo.cloneUrl,
        ref,
        title,
        previewDomain: "",
        port: 3000 + order,
        status: "running",
        createdAt: Date.now() - (order + 1) * 60_000,
        colorIndex: order,
        sidebarOrder: order,
      })
    branch("branch-empty-cart", "empty-cart-state", "Empty cart state", 0)
    branch("branch-promo", "promo-codes", "Promo codes", 1)
    const frame = (id: string, label: string, route: string) =>
      c.iframeLayers.set(id, {
        id,
        width: 480,
        height: 320,
        label,
        iframeState: {},
        route,
      })
    frame("layer-cart", "Cart", "/cart")
    frame("layer-payment", "Payment", "/checkout/payment")
    c.iframeLayerGroups.set("grp-checkout", {
      id: "grp-checkout",
      name: "Checkout",
      x: 0,
      y: 0,
      members: [
        { kind: "iframe-layer", id: "layer-cart" },
        { kind: "iframe-layer", id: "layer-payment" },
      ],
      sidebarOrder: 0,
    })
    c.savedViewport.set({ x: 60, y: 140, zoom: 0.8 })
  })
}

import type { Page } from "playwright-core"

import { fixtureModelCookieName } from "@/lib/fixture-model"

import type { Screen } from "../screen"
import {
  ids,
  holdServerActions,
  fixtureGitHub,
  openAddProject,
  fixtureCheckouts,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "add-project-github",
    description:
      "Add repository → Open GitHub repository: presets named once over the signed-in account's repos.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page.getByText("acme/docs").first().waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-loading",
    description: "Open GitHub repository while the repo list is still loading.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await holdServerActions(page, "hang")
      await openAddProject(page, "github")
      await page.waitForTimeout(500)
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-error",
    description: "Open GitHub repository after the repo list fails to load.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await holdServerActions(page, "fail")
      await openAddProject(page, "github")
      await page.getByText(/Couldn.t load your GitHub/).waitFor({
        timeout: 15_000,
      })
    },
    settleMs: 300,
  },
  {
    name: "add-project-github-disconnected",
    description:
      "Open GitHub repository with no GitHub connection on this device.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page
        .getByText("Connect GitHub to see your repositories here.")
        .waitFor({
          timeout: 15_000,
        })
    },
    settleMs: 300,
  },
  {
    name: "add-project-folder-error",
    description:
      "Add repository → Open folder on a folder that isn't a git checkout: the path stays, with why.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      const { plain } = fixtureCheckouts()
      await openAddProject(page, "folder")
      await page.getByPlaceholder("/path/to/your/clone").fill(plain)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await page.getByText("Not a git repository").waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings",
    description:
      "Configure repository for a folder, with Back to the folder it came from.",
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await addFixtureFolder(page)
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-model",
    description:
      "Configure repository after a model read the folder's files: the README's one-time codegen step joins the install.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureModel("connected"),
    prepare: async (page) => {
      await addFixtureFolder(page)
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-model-detecting",
    description:
      "Configure repository while the model reads the folder, the rule-based guess already filled in.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureModel("slow"),
    prepare: async (page) => {
      const { checkout } = fixtureCheckouts()
      await openAddProject(page, "folder")
      await page.getByPlaceholder("/path/to/your/clone").fill(checkout)
      await page.getByRole("button", { name: "Add", exact: true }).click()
      await page.getByText("Configure repository").waitFor({ timeout: 15_000 })
      // The rule-based pass has filled the form; the model is still reading.
      await page.waitForFunction(
        () =>
          (document.getElementById("repo-add-setup") as HTMLInputElement | null)
            ?.value === "pnpm install",
        undefined,
        { timeout: 15_000 }
      )
    },
    settleMs: 300,
  },
  {
    name: "add-project-settings-github",
    description:
      "Configure repository for a GitHub repo, with Back to the list it came from.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    prepare: async (page) => {
      await openAddProject(page, "github")
      await page.getByText("acme/docs").first().click({ timeout: 15_000 })
      await page.getByText(/Couldn.t auto-detect/).waitFor({ timeout: 15_000 })
    },
    settleMs: 300,
  },
]

export default screens

/**
 * The cookie that signs the Fixture World in to GitHub (`@/lib/fixture-github`),
 * so GitHub-backed lists answer with the fixture account's repositories.
 */
/** Make a model reachable for settings detection (`slow` answers after 20s). */
function fixtureModel(
  mode: "connected" | "slow"
): Array<{ name: string; value: string }> {
  return [{ name: fixtureModelCookieName(), value: mode }]
}

/** Add the fixture checkout through the folder form, landing on its settings. */
async function addFixtureFolder(page: Page): Promise<void> {
  const { checkout } = fixtureCheckouts()
  await openAddProject(page, "folder")
  await page.getByPlaceholder("/path/to/your/clone").fill(checkout)
  await page.getByRole("button", { name: "Add", exact: true }).click()
  await page.getByText("Configure repository").waitFor({ timeout: 15_000 })
  // Let detection land so the form shows what it found.
  await page
    .getByText("Detecting settings…")
    .waitFor({ state: "detached", timeout: 15_000 })
}

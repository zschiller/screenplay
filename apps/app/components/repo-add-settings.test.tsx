// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { RepoAddSettings } from "@/components/repo-add-settings"
import type { DetectRepoSettingsResult } from "@/lib/add-repo/actions"
import type { DetectedApp } from "@/lib/add-repo/resolver"

afterEach(cleanup)

// cmdk and Radix's Popover use a ResizeObserver and scrollIntoView, which
// jsdom doesn't implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

const app = (path: string, framework: string, port: number): DetectedApp => ({
  name: path.split("/").pop()!,
  path,
  framework,
  devScript: `turbo run dev --filter ${path.split("/").pop()}`,
  devServerPort: port,
})

const APPS = [
  app("apps/app", "Next.js", 3000),
  app("apps/docs", "Next.js", 3001),
  app("packages/skill-templates", "Vite", 5173),
]

const monorepo = (): Promise<DetectRepoSettingsResult> =>
  Promise.resolve({
    ok: true,
    settings: {
      setupScript: "pnpm install",
      devScript: APPS[0]!.devScript,
      devServerPort: 3000,
    },
    apps: APPS,
  })

function renderSettings(
  props: Partial<Parameters<typeof RepoAddSettings>[0]> = {}
) {
  const onConfirm = vi.fn()
  const refine = vi.fn().mockResolvedValue({ ok: false })
  render(
    <RepoAddSettings
      detect={monorepo}
      refine={refine}
      showEnvField={false}
      onConfirm={onConfirm}
      onCancel={() => {}}
      {...props}
    />
  )
  return { onConfirm, refine }
}

describe("RepoAddSettings — monorepo App field", () => {
  it("waits behind placeholders, then suggests the first app", async () => {
    const onAppChange = vi.fn()
    const { refine } = renderSettings({ onAppChange })
    // The rule-based pass is in flight: no form yet, and nothing to add.
    expect(screen.queryByLabelText("Run script")).toBeNull()
    expect(
      screen.getByRole("button", { name: "Add repository" })
    ).toHaveProperty("disabled", true)

    const trigger = await screen.findByRole("button", { name: /^App/ })
    expect(trigger.textContent).toContain("apps/app · Next.js")
    expect(
      screen.getByText(
        "3 apps in this repository. Each one you add becomes its own repository."
      )
    ).not.toBeNull()
    expect(screen.getByLabelText<HTMLInputElement>("Run script").value).toBe(
      "turbo run dev --filter app"
    )
    expect(onAppChange).toHaveBeenLastCalledWith(APPS[0])
    // The model pass looks at the chosen app.
    await waitFor(() => expect(refine).toHaveBeenCalled())
    expect(refine.mock.calls[0]![1]).toBe("apps/app")
  })

  it("names the Repository and its agent instructions after the app", async () => {
    const { onConfirm } = renderSettings()
    await screen.findByRole("button", { name: /^App/ })
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }))
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({
      presetName: "app",
      systemPrompt: "Work in the app under apps/app.",
      devScript: "turbo run dev --filter app",
      devServerPort: 3000,
      setupScript: "pnpm install",
    })
  })

  it("suggests the first app not already added", async () => {
    renderSettings({ existingNames: ["app"] })
    const trigger = await screen.findByRole("button", { name: /^App/ })
    expect(trigger.textContent).toContain("apps/docs")
  })

  it("keeps a Run script you typed when you switch apps", async () => {
    const { onConfirm, refine } = renderSettings()
    await screen.findByRole("button", { name: /^App/ })
    fireEvent.change(screen.getByLabelText("Run script"), {
      target: { value: "make dev" },
    })
    // Switching apps refills the untouched port and name, not the script.
    fireEvent.click(screen.getByRole("button", { name: /^App/ }))
    fireEvent.click(await screen.findByRole("option", { name: /docs/ }))
    await waitFor(() => expect(refine).toHaveBeenCalledTimes(2))
    expect(refine.mock.calls[1]![1]).toBe("apps/docs")
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }))
    expect(onConfirm.mock.calls[0]![0]).toMatchObject({
      presetName: "docs",
      devScript: "make dev",
      devServerPort: 3001,
    })
  })

  it("shows no App field for a single-app repository", async () => {
    renderSettings({
      detect: () =>
        Promise.resolve({
          ok: true,
          settings: {
            setupScript: "npm install",
            devScript: "npm run dev",
            devServerPort: 3000,
          },
          apps: [],
        }),
    })
    await screen.findByLabelText("Run script")
    expect(screen.queryByRole("button", { name: /^App/ })).toBeNull()
  })
})

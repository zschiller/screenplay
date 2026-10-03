// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"

vi.mock("@/lib/agent/harnesses/setup-actions", () => ({
  listHarnessModelChoices: vi.fn(),
}))

import { listHarnessModelChoices } from "@/lib/agent/harnesses/setup-actions"
import { readHarnessModelChoices } from "@/lib/harness-model-choices"
import { HarnessModelsDialog } from "./harness-models-dialog"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.mocked(listHarnessModelChoices).mockReset()
})

const MODELS = [
  { id: "opencode/big-pickle", label: "Big Pickle", group: "OpenCode Zen" },
  { id: "github-copilot/gpt-6", label: "GPT-6", group: "GitHub Copilot" },
  { id: "github-copilot/kimi-k3", label: "Kimi K3", group: "GitHub Copilot" },
]

function open() {
  render(
    <HarnessModelsDialog
      harnessKey="opencode-gateway"
      label="OpenCode"
      open
      onOpenChange={() => {}}
    />
  )
}

describe("HarnessModelsDialog (#1589)", () => {
  it("lists the CLI's models by provider and puts a checked one in the menu", async () => {
    vi.mocked(listHarnessModelChoices).mockResolvedValue(MODELS)
    open()
    expect(screen.getByText("OpenCode models")).toBeTruthy()
    await screen.findByText("Kimi K3")
    expect(screen.getByText("GitHub Copilot")).toBeTruthy()
    expect(screen.getByText("0 of 3 in the model menu")).toBeTruthy()

    fireEvent.click(screen.getByText("Kimi K3"))
    fireEvent.click(screen.getByText("Big Pickle"))
    // In the list's order, whatever the order they were checked in.
    expect(readHarnessModelChoices()["opencode-gateway"]).toEqual([
      MODELS[0],
      MODELS[2],
    ])
    expect(screen.getByText("2 of 3 in the model menu")).toBeTruthy()

    fireEvent.click(screen.getByText("Big Pickle"))
    expect(readHarnessModelChoices()["opencode-gateway"]).toEqual([MODELS[2]])
    expect(listHarnessModelChoices).toHaveBeenCalledWith("opencode-gateway")
  })

  it("says so when the models can't be listed, and tries again", async () => {
    vi.mocked(listHarnessModelChoices)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MODELS)
    open()
    await screen.findByText("Couldn't list OpenCode's models.")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => screen.getByText("Big Pickle"))
  })
})

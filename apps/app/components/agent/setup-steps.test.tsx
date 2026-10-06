// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { setupProgress } from "@/lib/branch/setup-steps"

import { SetupSteps } from "./setup-steps"

afterEach(cleanup)

const steps = () =>
  screen
    .getAllByRole("listitem")
    .map((li) => `${li.dataset.state} ${li.textContent}`)

describe("SetupSteps", () => {
  it("ticks off a new chat’s steps, timing the current one", () => {
    render(
      <SetupSteps
        progress={setupProgress({
          status: "creating",
          statusMessage: "Cloning repository…",
        })!}
      />
    )
    expect(steps()).toEqual([
      "done Branch created",
      "now Cloning repository0s",
      "todo Configuring git",
    ])
    expect(
      screen.getByText(/The agent starts once the code is ready/)
    ).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("shows a failed step’s error with Retry and Open logs", () => {
    const onRetry = vi.fn()
    const onOpenLogs = vi.fn()
    render(
      <SetupSteps
        progress={setupProgress({
          status: "error",
          statusMessage: "Cloning repository…",
          error: "repository not found",
        })!}
        onRetry={onRetry}
        onOpenLogs={onOpenLogs}
      />
    )
    expect(steps()[1]).toBe("failed Cloning repository failed")
    expect(screen.getByText("repository not found")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    fireEvent.click(screen.getByRole("button", { name: "Open logs" }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onOpenLogs).toHaveBeenCalledOnce()
  })
})

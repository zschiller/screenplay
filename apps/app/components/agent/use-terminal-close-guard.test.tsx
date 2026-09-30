// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { BranchData, TerminalTabData } from "@/lib/types"
import { useTerminalCloseGuard } from "./use-terminal-close-guard"

// What the session check answers; each test sets it.
let activity: () => Promise<string | null>
const checked = vi.fn()
vi.mock("@/lib/terminal-tabs-actions", () => ({
  terminalSessionActivityAction: () => {
    checked()
    return activity()
  },
}))

const tab: TerminalTabData = {
  id: "t1",
  branchId: "b1",
  terminalSessionId: "t1",
  harnessKey: "claude-code",
  label: "claude",
  createdAt: 1,
}

const agent = (status: BranchData["status"]) =>
  ({ id: "b1", sandboxName: "sbx", status }) as BranchData

function Harness({
  status,
  onClose,
}: {
  status: BranchData["status"]
  onClose: (id: string, next?: string) => void
}) {
  const guard = useTerminalCloseGuard({
    roomId: "r1",
    agent: agent(status),
    onClose,
  })
  return (
    <>
      <button onClick={() => void guard.requestClose(tab, "t2")}>Close</button>
      {guard.dialog}
    </>
  )
}

async function clickClose() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
  })
}

beforeEach(() => checked.mockReset())
afterEach(cleanup)

describe("useTerminalCloseGuard", () => {
  it("closes an idle shell at once", async () => {
    activity = () => Promise.resolve(null)
    const onClose = vi.fn()
    render(<Harness status="running" onClose={onClose} />)
    await clickClose()
    expect(onClose).toHaveBeenCalledWith("t1", "t2")
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("closes without checking when the sandbox isn't running", async () => {
    const onClose = vi.fn()
    render(<Harness status="stopped" onClose={onClose} />)
    await clickClose()
    expect(checked).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledWith("t1", "t2")
  })

  it("asks first when something is running, naming it", async () => {
    activity = () => Promise.resolve("claude")
    const onClose = vi.fn()
    render(<Harness status="running" onClose={onClose} />)
    await clickClose()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("Close “claude”?")
    expect(dialog.textContent).toContain(
      "Closing the terminal stops claude, which is still running."
    )
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!)
    })
    expect(onClose).toHaveBeenCalledWith("t1", "t2")
  })

  it("asks when the check fails rather than guess", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    activity = () => Promise.reject(new Error("sandbox unreachable"))
    const onClose = vi.fn()
    render(<Harness status="running" onClose={onClose} />)
    await clickClose()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain(
      "Closing the terminal stops anything running in it."
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

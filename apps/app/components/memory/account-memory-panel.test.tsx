// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import type { MemoryData } from "@/lib/types"

const ENTRIES: MemoryData[] = [
  {
    id: "mem-1",
    text: "Prefers small fixes over redesigns.",
    source: "agent",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "mem-2",
    text: "Write UI copy in plain sentences.",
    source: "member",
    createdAt: 2,
    updatedAt: 2,
  },
]

vi.mock("@/lib/memory/actions", () => ({
  listAccountMemory: vi.fn(),
  addAccountMemoryEntry: vi.fn(),
  editAccountMemoryEntry: vi.fn(),
  removeAccountMemoryEntry: vi.fn(),
}))

import {
  addAccountMemoryEntry,
  editAccountMemoryEntry,
  listAccountMemory,
  removeAccountMemoryEntry,
} from "@/lib/memory/actions"
import { AccountMemoryPanel } from "./account-memory-panel"

// Radix's Dialog and menus use pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver. Polyfill the bare minimum.
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
  vi.clearAllMocks()
})

/** The panel under a stand-in title row that shows the action it's given. */
function renderPanel(entries: MemoryData[]) {
  vi.mocked(listAccountMemory).mockResolvedValue(entries)
  return render(
    <AccountMemoryPanel
      header={(action) => (
        <div data-testid="title-row">
          <h2>Memory</h2>
          {action}
        </div>
      )}
    />
  )
}

describe("Settings › Memory (#1513)", () => {
  it("lists each entry with who saved it, and Add memory on the title row", async () => {
    renderPanel(ENTRIES)

    expect(
      await screen.findByText("Prefers small fixes over redesigns.")
    ).not.toBeNull()
    expect(screen.getByText("Saved by agent")).not.toBeNull()
    expect(screen.getByText("Added by you")).not.toBeNull()
    const titleRow = screen.getByTestId("title-row")
    expect(
      within(titleRow).getByRole("button", { name: "Add memory" })
    ).not.toBeNull()
    expect(screen.getAllByRole("button", { name: "Add memory" })).toHaveLength(
      1
    )
  })

  it("offers Add memory once, in the empty state, with no entries", async () => {
    renderPanel([])

    expect(await screen.findByText("No memories yet")).not.toBeNull()
    expect(
      within(screen.getByTestId("title-row")).queryByRole("button")
    ).toBeNull()
    expect(screen.getAllByRole("button", { name: "Add memory" })).toHaveLength(
      1
    )
  })

  it("adds an entry and shows the saved list", async () => {
    vi.mocked(addAccountMemoryEntry).mockResolvedValue([
      {
        id: "mem-3",
        text: "Use pnpm.",
        source: "member",
        createdAt: 3,
        updatedAt: 3,
      },
    ])
    renderPanel([])

    fireEvent.click(await screen.findByRole("button", { name: "Add memory" }))
    const form = await screen.findByRole("dialog", { name: "Add memory" })
    fireEvent.change(within(form).getByLabelText("Memory"), {
      target: { value: "Use pnpm." },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    expect(addAccountMemoryEntry).toHaveBeenCalledWith("Use pnpm.")
    expect(await screen.findByText("Use pnpm.")).not.toBeNull()
  })

  it("edits an entry", async () => {
    vi.mocked(editAccountMemoryEntry).mockResolvedValue(ENTRIES)
    renderPanel(ENTRIES)

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit memory: Write UI copy in plain sentences.",
      })
    )
    const form = await screen.findByRole("dialog", { name: "Edit memory" })
    fireEvent.change(within(form).getByLabelText("Memory"), {
      target: { value: "Write UI copy plainly." },
    })
    fireEvent.click(within(form).getByRole("button", { name: "Save" }))

    expect(editAccountMemoryEntry).toHaveBeenCalledWith(
      "mem-2",
      "Write UI copy plainly."
    )
  })

  it("deletes an entry from its menu", async () => {
    vi.mocked(removeAccountMemoryEntry).mockResolvedValue([ENTRIES[1]!])
    renderPanel(ENTRIES)

    const more = await screen.findByRole("button", {
      name: "More actions for memory: Prefers small fixes over redesigns.",
    })
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))

    expect(removeAccountMemoryEntry).toHaveBeenCalledWith("mem-1")
    await waitFor(() =>
      expect(
        screen.queryByText("Prefers small fixes over redesigns.")
      ).toBeNull()
    )
  })

  it("says so when memory can't be loaded", async () => {
    vi.mocked(listAccountMemory).mockRejectedValue(new Error("kv down"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<AccountMemoryPanel header={() => null} />)

    expect(await screen.findByText("Couldn't load memory")).not.toBeNull()
  })
})

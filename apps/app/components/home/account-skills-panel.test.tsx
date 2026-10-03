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
import type { SavedSkill } from "@/lib/skills/saved"

vi.mock("@/lib/skills/actions", () => ({
  listAccountSkills: vi.fn(),
  readAccountSkill: vi.fn(),
  deleteAccountSkill: vi.fn(),
}))

import { AccountSkillsPanel } from "./account-skills-panel"

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

afterEach(cleanup)

const skill = (name: string, over: Partial<SavedSkill> = {}): SavedSkill => ({
  name,
  description: `How I like ${name}.`,
  addedBy: "agent",
  addedById: "chat-1",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
})

function renderPanel(opts: { skills?: SavedSkill[]; fail?: boolean } = {}) {
  const list = opts.fail
    ? vi.fn().mockRejectedValue(new Error("kv down"))
    : vi.fn().mockResolvedValue(opts.skills ?? [skill("release-notes")])
  const readSkill = vi.fn().mockResolvedValue({
    content: "---\nname: release-notes\ndescription: x\n---\nGroup by feature.",
    files: [],
  })
  const deleteSkill = vi.fn().mockResolvedValue(undefined)
  render(
    <AccountSkillsPanel
      header={() => <h2>Skills</h2>}
      list={list}
      readSkill={readSkill}
      deleteSkill={deleteSkill}
    />
  )
  return { list, readSkill, deleteSkill }
}

describe("Settings › Skills (#1558)", () => {
  it("lists your skills with who saved them", async () => {
    renderPanel({
      skills: [
        skill("release-notes"),
        skill("voice", { addedBy: "member", addedById: "ana" }),
      ],
    })

    expect(await screen.findByText("release-notes")).toBeTruthy()
    expect(screen.getByText(/^Saved by agent · /)).toBeTruthy()
    expect(screen.getByText(/^Added by you · /)).toBeTruthy()
  })

  it("opens a skill in a dialog read from your own skills", async () => {
    const { readSkill } = renderPanel()

    fireEvent.click(
      await screen.findByRole("button", { name: "Open skill: release-notes" })
    )

    const dialog = await screen.findByRole("dialog", { name: "release-notes" })
    expect(await within(dialog).findByText("Group by feature.")).toBeTruthy()
    expect(readSkill).toHaveBeenCalledWith("release-notes")
  })

  it("deletes a skill after a confirm and drops its row", async () => {
    const { deleteSkill } = renderPanel()

    fireEvent.pointerDown(
      await screen.findByRole("button", {
        name: "More actions for skill: release-notes",
      }),
      { button: 0, ctrlKey: false }
    )
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(
      within(confirm).getByText("Chats you message stop following it.")
    ).toBeTruthy()
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))

    await waitFor(() =>
      expect(deleteSkill).toHaveBeenCalledWith("release-notes")
    )
    await waitFor(() => expect(screen.queryByText("release-notes")).toBeNull())
  })

  it("says so when there are none", async () => {
    renderPanel({ skills: [] })

    expect(await screen.findByText("No skills yet")).toBeTruthy()
    expect(
      screen.getByText(
        "Ask a chat to save a skill to your account, and every chat you message can follow it."
      )
    ).toBeTruthy()
  })

  it("offers a retry when your skills can't be read", async () => {
    renderPanel({ fail: true })

    expect(await screen.findByText("Couldn't load skills")).toBeTruthy()
  })
})

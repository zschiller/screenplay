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
import { SavedSkillList } from "./saved-skill-list"

// Radix's Dialog and menus use pointer-capture / scroll APIs jsdom doesn't
// implement, plus a ResizeObserver and matchMedia (the sidebar). Polyfill the
// bare minimum.
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
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

afterEach(() => {
  cleanup()
})

const SKILLS: SavedSkill[] = [
  {
    name: "checkout-copy",
    description: "House style for checkout copy.",
    addedBy: "agent",
    addedById: "chat-1",
    createdAt: Date.now() - 2 * 86_400_000,
    updatedAt: Date.now() - 2 * 86_400_000,
  },
  {
    name: "release-checklist",
    description: "Cut a release.",
    addedBy: "member",
    addedById: "user-2",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const SKILL_MD = [
  "---",
  "name: release-checklist",
  "description: Cut a release.",
  "---",
  "",
  "# Release checklist",
  "",
  "Bump the version.",
].join("\n")

function renderList(
  overrides: Partial<React.ComponentProps<typeof SavedSkillList>> = {}
) {
  const props = {
    skills: SKILLS,
    copy: {
      emptyDescription: "Ask any chat to save what it worked out as a skill.",
      deleteDescription: "Chats on this canvas stop following it.",
    },
    memberName: (id: string) => (id === "user-2" ? "Maya" : undefined),
    readSkill: vi.fn(async () => ({ content: SKILL_MD, files: [] })),
    deleteSkill: vi.fn(async () => {}),
    ...overrides,
  }
  render(<SavedSkillList {...props} />)
  return props
}

describe("SavedSkillList", () => {
  it("lists each Skill with its description and who saved it", () => {
    renderList()
    expect(screen.getByText("checkout-copy")).toBeTruthy()
    expect(screen.getByText("House style for checkout copy.")).toBeTruthy()
    expect(screen.getByText("Saved by agent · 2d ago")).toBeTruthy()
    expect(screen.getByText("Added by Maya · just now")).toBeTruthy()
  })

  it("has no add, edit or upload controls", () => {
    renderList()
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "")
    expect(names.some((n) => /add|edit|upload|new/i.test(n))).toBe(false)
  })

  it("says how Skills get here when there are none", () => {
    renderList({ skills: [] })
    expect(screen.getByText("No skills yet")).toBeTruthy()
    expect(
      screen.getByText("Ask any chat to save what it worked out as a skill.")
    ).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("opens a Skill read-only, without its frontmatter", async () => {
    const { readSkill } = renderList()
    fireEvent.click(
      screen.getByRole("button", { name: "Open skill: release-checklist" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "release-checklist",
    })
    expect(readSkill).toHaveBeenCalledWith("release-checklist")
    await within(dialog).findByText("Bump the version.")
    expect(within(dialog).getByText("Cut a release.")).toBeTruthy()
    expect(within(dialog).queryByText(/name: release-checklist/)).toBeNull()
    expect(within(dialog).queryByRole("textbox")).toBeNull()
    // No files, no sidebar.
    expect(within(dialog).queryByText("SKILL.md")).toBeNull()
  })

  it("browses a Skill's supporting files in a sidebar", async () => {
    renderList({
      readSkill: vi.fn(async () => ({
        content: SKILL_MD,
        files: [
          { path: "changelog-template.md", content: "## vX.Y.Z" },
          { path: "scripts/tag.sh", content: 'git tag "v$1"' },
        ],
      })),
    })
    fireEvent.click(
      screen.getByRole("button", { name: "Open skill: release-checklist" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "release-checklist",
    })
    await within(dialog).findByText("Bump the version.")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "tag.sh" })
    )
    expect(within(dialog).getByText('git tag "v$1"')).toBeTruthy()
    fireEvent.click(
      within(dialog).getByRole("button", { name: "changelog-template.md" })
    )
    expect(within(dialog).getByRole("heading", { name: "vX.Y.Z" })).toBeTruthy()
    // Subfolders nest in the tree, open to start, and close.
    const folder = within(dialog).getByRole("button", { name: "scripts" })
    expect(folder.getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(folder)
    expect(within(dialog).queryByRole("button", { name: "tag.sh" })).toBeNull()
  })

  it("offers to try again when a Skill can't be read", async () => {
    const readSkill = vi
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce({ content: SKILL_MD, files: [] })
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderList({ readSkill })
    fireEvent.click(
      screen.getByRole("button", { name: "Open skill: release-checklist" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "release-checklist",
    })
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Try again" })
    )
    await within(dialog).findByText("Bump the version.")
  })

  it("deletes a Skill only after a confirm that names it", async () => {
    const { deleteSkill } = renderList()
    const more = screen.getByRole("button", {
      name: "More actions for skill: checkout-copy",
    })
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText("Delete “checkout-copy”?")).toBeTruthy()
    expect(deleteSkill).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }))
    await waitFor(() =>
      expect(deleteSkill).toHaveBeenCalledWith("checkout-copy")
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, renderHook } from "@testing-library/react"

import {
  useCanvasKeyboard,
  type CanvasKeyboardInputs,
} from "./use-canvas-keyboard"

function panel(collapsed = false) {
  let isCollapsed = collapsed
  return {
    isCollapsed: () => isCollapsed,
    expand: vi.fn(() => (isCollapsed = false)),
    collapse: vi.fn(() => (isCollapsed = true)),
  }
}

function setup({ commentsPanelOpen = false } = {}) {
  const sidebar = panel()
  const chat = panel()
  const selection = { clear: vi.fn(), deleteSelected: vi.fn(() => true) }
  const history = { undo: vi.fn(), redo: vi.fn() }
  const interaction = {
    escapeState: () => ({
      cursorChatOpen: false,
      editingDocumentLayerId: null,
      focusedIframeLayerId: null,
      createFlowIframeLayerId: null,
    }),
    setSpaceHeld: vi.fn(),
    isCursorChatOpen: () => false,
    openCursorChat: vi.fn(),
  }
  const commentsPanel = { isOpen: () => commentsPanelOpen, close: vi.fn() }
  const inputs = {
    toolMode: { current: () => "select", set: vi.fn(), toggle: vi.fn() },
    selection,
    reference: { newCommentPos: null, clearMode: vi.fn() },
    targeting: { isPickActive: () => false, cancel: vi.fn() },
    history,
    interaction,
    sidebarPanelRef: { current: sidebar },
    chatPanelRef: { current: chat },
    zoom: {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomTo100: vi.fn(),
      zoomToFit: vi.fn(),
    },
    openShortcutSheet: vi.fn(),
    commentsPanel,
  } as unknown as CanvasKeyboardInputs
  renderHook(() => useCanvasKeyboard(inputs))
  return { sidebar, chat, selection, history, interaction, commentsPanel }
}

/** Mount `html` and return the element marked `data-target`. */
function mount(html: string): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.appendChild(root)
  return root.querySelector<HTMLElement>("[data-target]") ?? root
}

function press(
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
  before?: (e: KeyboardEvent) => void
) {
  const e = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  before?.(e)
  target.dispatchEvent(e)
  return e
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

describe("canvas keys inside menus and dialogs", () => {
  it("Backspace in an open menu leaves the selected frame alone", () => {
    const { selection } = setup()
    const item = mount(
      '<div role="menu"><div role="menuitem" data-target tabindex="-1">Rename</div></div>'
    )
    press(item, "Backspace")
    expect(selection.deleteSelected).not.toHaveBeenCalled()
  })

  it("Backspace on the canvas still deletes the selection", () => {
    const { selection } = setup()
    press(document.body, "Backspace")
    expect(selection.deleteSelected).toHaveBeenCalledTimes(1)
  })

  it("tool keys and undo don't fire from a dialog", () => {
    const { history } = setup()
    const button = mount(
      '<div role="dialog"><button data-target>Save</button></div>'
    )
    press(button, "z", { metaKey: true })
    expect(history.undo).not.toHaveBeenCalled()
  })

  it("Escape that a menu already took doesn't also clear the selection", () => {
    const { selection } = setup()
    press(document.body, "Escape", {}, (e) => e.preventDefault())
    expect(selection.clear).not.toHaveBeenCalled()
  })

  it("Escape nobody took clears the selection", () => {
    const { selection } = setup()
    press(document.body, "Escape")
    expect(selection.clear).toHaveBeenCalledTimes(1)
  })

  it("Escape closes an open Comments panel before the selection", () => {
    const { selection, commentsPanel } = setup({ commentsPanelOpen: true })
    press(document.body, "Escape")
    expect(commentsPanel.close).toHaveBeenCalledTimes(1)
    expect(selection.clear).not.toHaveBeenCalled()
  })
})

describe("panel toggles", () => {
  it("⌘B toggles the sidebar on the canvas, and Ctrl+B does too", () => {
    const { sidebar } = setup()
    press(document.body, "b", { metaKey: true })
    expect(sidebar.collapse).toHaveBeenCalledTimes(1)
    press(document.body, "b", { ctrlKey: true })
    expect(sidebar.expand).toHaveBeenCalledTimes(1)
  })

  it("⌘B in a document is Bold, not the sidebar", () => {
    const { sidebar } = setup()
    const doc = mount('<div contenteditable="true" data-target></div>')
    press(doc, "b", { metaKey: true })
    expect(sidebar.collapse).not.toHaveBeenCalled()
  })

  it("⌘. in a text field types nothing on the canvas", () => {
    const { sidebar, chat } = setup()
    const input = mount("<input data-target />")
    press(input, ".", { metaKey: true })
    expect(sidebar.collapse).not.toHaveBeenCalled()
    expect(chat.collapse).not.toHaveBeenCalled()
  })

  it("⌘I in a document is Italic, but closes the chat from the composer", () => {
    const { chat } = setup()
    const doc = mount('<div contenteditable="true" data-target></div>')
    press(doc, "i", { metaKey: true })
    expect(chat.collapse).not.toHaveBeenCalled()
    const composer = mount(
      '<div contenteditable="true" data-composer data-target></div>'
    )
    press(composer, "i", { ctrlKey: true })
    expect(chat.collapse).toHaveBeenCalledTimes(1)
  })
})

describe("undo and redo", () => {
  it("accept Ctrl, including Ctrl+Shift+Z's capital Z", () => {
    const { history } = setup()
    press(document.body, "z", { ctrlKey: true })
    press(document.body, "Z", { ctrlKey: true, shiftKey: true })
    expect(history.undo).toHaveBeenCalledTimes(1)
    expect(history.redo).toHaveBeenCalledTimes(1)
  })
})

describe("Space", () => {
  it("pans from the canvas", () => {
    const { interaction } = setup()
    press(document.body, " ")
    expect(interaction.setSpaceHeld).toHaveBeenCalledWith(true)
  })

  it("presses a button focused from the keyboard instead of panning", () => {
    const { interaction } = setup()
    const button = mount("<button data-target>Zoom to fit</button>")
    const matches = button.matches.bind(button)
    vi.spyOn(button, "matches").mockImplementation((selector: string) =>
      selector === ":focus-visible" ? true : matches(selector)
    )
    const e = press(button, " ")
    expect(interaction.setSpaceHeld).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it("still pans when a clicked button kept focus", () => {
    const { interaction } = setup()
    const button = mount("<button data-target>Zoom to fit</button>")
    const matches = button.matches.bind(button)
    vi.spyOn(button, "matches").mockImplementation((selector: string) =>
      selector === ":focus-visible" ? false : matches(selector)
    )
    press(button, " ")
    expect(interaction.setSpaceHeld).toHaveBeenCalledWith(true)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import {
  hasModKey,
  isInComposer,
  isInOverlay,
  isTextEntry,
} from "@/lib/canvas/key-target"

function el(html: string): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.appendChild(root)
  return root.querySelector<HTMLElement>("[data-target]")!
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("isTextEntry", () => {
  it("is true for fields and anything inside a contenteditable", () => {
    expect(isTextEntry(el("<input data-target />"))).toBe(true)
    expect(isTextEntry(el("<textarea data-target></textarea>"))).toBe(true)
    expect(
      isTextEntry(el('<div contenteditable="true"><p data-target></p></div>'))
    ).toBe(true)
  })

  it("is false for buttons, the page and non-elements", () => {
    expect(isTextEntry(el("<button data-target></button>"))).toBe(false)
    expect(isTextEntry(document.body)).toBe(false)
    expect(isTextEntry(window)).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe("isInOverlay", () => {
  it("is true inside a menu, dialog, alert dialog or listbox", () => {
    for (const role of ["menu", "dialog", "alertdialog", "listbox"]) {
      expect(
        isInOverlay(el(`<div role="${role}"><span data-target></span></div>`))
      ).toBe(true)
    }
  })

  it("is false on the canvas and in the Comments panel region", () => {
    expect(isInOverlay(document.body)).toBe(false)
    expect(
      isInOverlay(el('<div role="region"><button data-target></button></div>'))
    ).toBe(false)
  })
})

describe("isInComposer", () => {
  it("is true only inside the chat composer", () => {
    expect(
      isInComposer(
        el(
          '<div contenteditable="true" data-composer><p data-target></p></div>'
        )
      )
    ).toBe(true)
    expect(
      isInComposer(el('<div contenteditable="true"><p data-target></p></div>'))
    ).toBe(false)
  })
})

describe("hasModKey", () => {
  it("takes ⌘ or Ctrl", () => {
    expect(hasModKey({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(hasModKey({ metaKey: false, ctrlKey: true })).toBe(true)
    expect(hasModKey({ metaKey: false, ctrlKey: false })).toBe(false)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import { neighbourRowButton } from "./row-focus"

afterEach(() => {
  document.body.innerHTML = ""
})

// The Canvas list's shape: flat rows, and a Group (header + members) in a
// menu-item. Each row's select button is a direct child; its … is a sibling.
function list() {
  document.body.innerHTML = `
    <div data-sidebar-row="row" id="a">
      <button data-sidebar="menu-button">A</button>
      <button data-sidebar="menu-action">…</button>
    </div>
    <div data-sidebar="menu-item">
      <div data-sidebar-row="group" id="g">
        <button data-sidebar="menu-button">Group</button>
        <button data-sidebar="menu-action">…</button>
      </div>
      <div data-sidebar="menu-sub">
        <div data-sidebar-row="row" id="g1">
          <button data-sidebar="menu-sub-button">G1</button>
          <button data-sidebar="menu-action">…</button>
        </div>
        <div data-sidebar-row="row" id="g2">
          <button data-sidebar="menu-sub-button">G2</button>
          <button data-sidebar="menu-action">…</button>
        </div>
      </div>
    </div>
    <div data-sidebar-row="row" id="b">
      <button data-sidebar="menu-button">B</button>
      <button data-sidebar="menu-action">…</button>
    </div>`
}

const menuOf = (id: string) =>
  document.querySelector(`#${id} > [data-sidebar=menu-action]`)!

describe("neighbourRowButton", () => {
  it("picks the next row's select button", () => {
    list()
    expect(neighbourRowButton(menuOf("a"))?.textContent).toBe("Group")
    expect(neighbourRowButton(menuOf("g1"))?.textContent).toBe("G2")
  })

  it("falls back to the previous row at the end", () => {
    list()
    expect(neighbourRowButton(menuOf("b"))?.textContent).toBe("G2")
  })

  it("skips a deleted Group's own members", () => {
    list()
    expect(neighbourRowButton(menuOf("g"))?.textContent).toBe("B")
  })

  it("is null for the only row", () => {
    document.body.innerHTML = `<div data-sidebar-row="row" id="a"><button data-sidebar="menu-button">A</button><button data-sidebar="menu-action">…</button></div>`
    expect(neighbourRowButton(menuOf("a"))).toBeNull()
  })
})

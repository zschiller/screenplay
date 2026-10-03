// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { commandOutput, highlight, languageFor, LogText } from "./tool-output"

afterEach(cleanup)

describe("languageFor", () => {
  it("maps a path's extension to its highlight.js language", () => {
    expect(languageFor("src/a.tsx")).toBe("typescript")
    expect(languageFor("README.md")).toBe("markdown")
    expect(languageFor("Makefile")).toBeNull()
    expect(languageFor(null)).toBeNull()
  })
})

describe("highlight", () => {
  it("wraps tokens in highlight.js classes, keeping the text", () => {
    const { container } = render(
      <pre>{highlight("const a = 1", "typescript")}</pre>
    )
    expect(container.textContent).toBe("const a = 1")
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe("const")
  })

  it("leaves text plain with no language", () => {
    expect(highlight("const a = 1", null)).toBe("const a = 1")
  })
})

describe("LogText", () => {
  it("colours ANSI output and drops the escape codes", () => {
    const { container } = render(
      <pre>
        <LogText text={"\u001b[31mfail\u001b[0m ok"} />
      </pre>
    )
    expect(container.textContent).toBe("fail ok")
    expect(container.querySelector("span")?.getAttribute("style")).toContain(
      "color"
    )
  })

  it("marks error lines in output without ANSI codes", () => {
    const { container } = render(
      <pre>
        <LogText text={"fine\nError: boom"} />
      </pre>
    )
    const spans = container.querySelectorAll("pre > span")
    expect(spans[0]?.getAttribute("style")).toBeNull()
    expect(spans[1]?.getAttribute("style")).toContain("color")
  })
})

describe("commandOutput", () => {
  it("drops a passing exit code and a lone stdout header", () => {
    expect(commandOutput("stdout:\nhello\n\nexit code: 0")).toBe("hello")
    expect(commandOutput("exit code: 0")).toBe("")
  })

  it("keeps a failing exit code and both headers when there's stderr", () => {
    expect(commandOutput("stdout:\na\n\nstderr:\nb\n\nexit code: 1")).toBe(
      "stdout:\na\n\nstderr:\nb\n\nexit code: 1"
    )
    expect(commandOutput("stdout:\na\n\nstderr:\nb\n\nexit code: 0")).toBe(
      "stdout:\na\n\nstderr:\nb"
    )
  })
})

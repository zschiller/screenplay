// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import { AgentMessageItem } from "./agent-message"
import { ChatMarkdown } from "./chat-markdown"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ChatMarkdown (issue #727)", () => {
  it("renders GFM tables, task lists, and strikethrough", () => {
    const { container } = render(
      <ChatMarkdown>
        {[
          "| File | Line |",
          "| --- | --- |",
          "| a.tsx | 4 |",
          "",
          "- [x] done",
          "- [ ] todo",
          "",
          "~~gone~~",
        ].join("\n")}
      </ChatMarkdown>
    )

    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getByRole("cell", { name: "a.tsx" })).toBeTruthy()
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ])
    expect(container.querySelector("del")?.textContent).toBe("gone")
    expect(container.textContent).not.toContain("| --- |")
    expect(container.textContent).not.toContain("[x]")
  })

  it("wraps a table in a horizontal scroller so it can't widen the panel", () => {
    render(<ChatMarkdown>{"| a |\n| --- |\n| b |"}</ChatMarkdown>)
    expect(
      screen
        .getByRole("table")
        .parentElement?.classList.contains("chat-markdown-scroll")
    ).toBe(true)
  })

  it("renders inline code without the backticks", () => {
    const { container } = render(
      <ChatMarkdown>{"run `pnpm lint`"}</ChatMarkdown>
    )
    expect(container.querySelector("code")?.textContent).toBe("pnpm lint")
    expect(container.textContent).toBe("run pnpm lint")
  })

  it("highlights a fenced block that names its language, and labels it", () => {
    const { container } = render(
      <ChatMarkdown>{"```ts\nconst a = 1\n```"}</ChatMarkdown>
    )
    expect(container.querySelector("pre .hljs-keyword")?.textContent).toBe(
      "const"
    )
    expect(
      container.querySelector(".chat-markdown-codeblock-header")?.textContent
    ).toBe("ts")
  })

  it("leaves an unlabelled fence unhighlighted", () => {
    const { container } = render(
      <ChatMarkdown>{"```\nconst a = 1\n```"}</ChatMarkdown>
    )
    expect(container.querySelector("pre [class^='hljs-']")).toBeNull()
  })

  it("copies a code block's text without its trailing newline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    render(<ChatMarkdown>{"```bash\nrg -n '640px' app\n```"}</ChatMarkdown>)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }))
    })

    expect(writeText).toHaveBeenCalledWith("rg -n '640px' app")
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy()
  })
})

describe("AgentMessageItem uses ChatMarkdown for every message kind", () => {
  const table = "| a |\n| --- |\n| b |"
  const kinds: Array<[string, AgentMessage, boolean]> = [
    ["assistant", { role: "assistant", content: table }, false],
    ["user", { role: "user", content: table }, false],
    ["reasoning", { role: "reasoning", content: table }, true],
    [
      "plan",
      {
        role: "plan",
        planId: "p1",
        content: table,
        status: "pending",
      } as AgentMessage,
      false,
    ],
  ]

  it.each(kinds)("%s", (_kind, message, expand) => {
    const { container } = render(
      <AgentMessageItem message={message} roomId="r" chatId="c" />
    )
    if (expand)
      fireEvent.click(screen.getByRole("button", { name: /reasoning/i }))
    expect(container.querySelector(".chat-markdown table")).toBeTruthy()
  })
})

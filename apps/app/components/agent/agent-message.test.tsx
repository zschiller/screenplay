// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import { AgentMessageItem } from "./agent-message"

afterEach(cleanup)

describe("AgentMessageItem — reasoning (ACP agent_thought_chunk)", () => {
  const reasoning: AgentMessage = {
    role: "reasoning",
    content: "First I weigh the options.",
  }

  it("renders reasoning in a collapsible slot, collapsed by default", () => {
    render(<AgentMessageItem message={reasoning} />)

    // The collapsible affordance is present (getByRole throws if it isn't)...
    expect(screen.getByRole("button", { name: /reasoning/i })).toBeTruthy()
    // ...but the thinking text is hidden until expanded.
    expect(screen.queryByText("First I weigh the options.")).toBeNull()
  })

  it("reveals the reasoning text when the slot is expanded", () => {
    render(<AgentMessageItem message={reasoning} />)

    fireEvent.click(screen.getByRole("button", { name: /reasoning/i }))

    expect(screen.getByText("First I weigh the options.")).toBeTruthy()
  })
})

function toolCall(
  partial: Partial<Extract<AgentMessage, { role: "tool_call" }>>
): AgentMessage {
  return {
    role: "tool_call",
    toolCallId: "call_1",
    title: "edit_file",
    kind: "edit",
    status: "pending",
    content: [],
    ...partial,
  }
}

describe("AgentMessageItem — ACP tool call (issue #377)", () => {
  it("shows a spinner while pending and in_progress, for any tool", () => {
    const { rerender } = render(
      <AgentMessageItem message={toolCall({ status: "pending" })} />
    )
    expect(screen.getByTestId("tool-call-spinner")).toBeTruthy()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "pending"
    )

    rerender(<AgentMessageItem message={toolCall({ status: "in_progress" })} />)
    expect(screen.getByTestId("tool-call-spinner")).toBeTruthy()
  })

  it("drops the spinner once completed and flags a failure", () => {
    const { rerender } = render(
      <AgentMessageItem message={toolCall({ status: "completed" })} />
    )
    expect(screen.queryByTestId("tool-call-spinner")).toBeNull()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "completed"
    )

    rerender(<AgentMessageItem message={toolCall({ status: "failed" })} />)
    expect(screen.queryByTestId("tool-call-spinner")).toBeNull()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "failed"
    )
  })

  it("renders a diff content block structurally (path + old/new), not flattened", () => {
    const diff: ToolCallContent = {
      type: "diff",
      path: "src/a.ts",
      oldText: "before",
      newText: "after",
    }
    render(
      <AgentMessageItem
        message={toolCall({ status: "completed", content: [diff] })}
      />
    )
    // Expand to reveal the structured content.
    fireEvent.click(screen.getByTestId("tool-call"))
    const diffEl = screen.getByTestId("tool-content-diff")
    expect(diffEl.textContent).toContain("src/a.ts")
    expect(diffEl.textContent).toContain("before")
    expect(diffEl.textContent).toContain("after")
  })

  it("renders a terminal content block as its own structural element", () => {
    const terminal: ToolCallContent = { type: "terminal", terminalId: "t_42" }
    render(
      <AgentMessageItem
        message={toolCall({
          title: "run_command",
          kind: "execute",
          status: "completed",
          content: [terminal],
        })}
      />
    )
    fireEvent.click(screen.getByTestId("tool-call"))
    expect(screen.getByTestId("tool-content-terminal").textContent).toContain(
      "t_42"
    )
  })

  // claude-code-acp forwards Claude Code's file-read decorations verbatim —
  // a <system-reminder> block, a ``` fence, and a `   N→` line-number gutter.
  // The expanded preview must strip all three and show just the file text.
  it("strips Claude Code read decorations from text content", () => {
    const readOutput: ToolCallContent = {
      type: "content",
      content: {
        type: "text",
        text: "<system-reminder>be careful</system-reminder>\n```ts\n     1→const a = 1\n     2→const b = 2\n```",
      },
    }
    render(
      <AgentMessageItem
        message={toolCall({
          title: "read_file",
          status: "completed",
          content: [readOutput],
        })}
      />
    )
    fireEvent.click(screen.getByTestId("tool-call"))
    const pre = screen.getByTestId("tool-content-text")
    expect(pre.textContent).toBe("const a = 1\nconst b = 2")
    expect(pre.textContent).not.toContain("system-reminder")
    expect(pre.textContent).not.toContain("```")
    expect(pre.textContent).not.toContain("→")
  })

  // A raw snake_case tool name with no hand-mapped label humanizes to
  // sentence case — "Search files", never Title Case "Search Files".
  it("humanizes an unmapped raw tool name to sentence case", () => {
    render(
      <AgentMessageItem
        message={toolCall({ title: "search_files", status: "completed" })}
      />
    )
    const text = screen.getByTestId("tool-call").textContent ?? ""
    expect(text).toContain("Search files")
    expect(text).not.toContain("Search Files")
  })

  // A generic ACP adapter (e.g. claude-code-acp) sends an already
  // human-readable, markdown-formatted title — not a raw snake_case name.
  // We must render it verbatim (no per-word re-casing) and honor its markdown.
  it("renders a human-readable ACP title verbatim, without re-casing", () => {
    render(
      <AgentMessageItem
        message={toolCall({ title: "Read file.ts", status: "completed" })}
      />
    )
    // Verbatim — not "Read File.Ts" from word-by-word title casing.
    expect(screen.getByTestId("tool-call").textContent).toContain("Read file.ts")
  })

  it("renders inline `code` in an ACP title as markdown, not literal backticks", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({ title: "Read `src/a.ts`", status: "completed" })}
      />
    )
    const code = container.querySelector("code")
    expect(code?.textContent).toBe("src/a.ts")
    // The literal backticks must not survive into the rendered text.
    expect(screen.getByTestId("tool-call").textContent).not.toContain("`")
  })

  // The title is NOT a full markdown document — only inline `code` is honored.
  // A full CommonMark parse silently mangles ordinary text a title carries:
  // `__init__.py` becomes bold "init" (losing the underscores) and `[a](b)`
  // collapses to a link that drops its URL. Both must render verbatim.
  it("renders non-code markdown characters in an ACP title verbatim", () => {
    render(
      <AgentMessageItem
        message={toolCall({ title: "Edit src/__init__.py", status: "completed" })}
      />
    )
    expect(screen.getByTestId("tool-call").textContent).toContain(
      "Edit src/__init__.py"
    )
  })

  it("keeps a link-like ACP title (and its URL) verbatim", () => {
    render(
      <AgentMessageItem
        message={toolCall({
          title: "Open [docs](http://x.com)",
          status: "completed",
        })}
      />
    )
    expect(screen.getByTestId("tool-call").textContent).toContain(
      "Open [docs](http://x.com)"
    )
  })

  it("renders multiple inline `code` spans in one ACP title", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({ title: "Edit `a.ts` and `b.ts`", status: "completed" })}
      />
    )
    const codes = Array.from(container.querySelectorAll("code")).map(
      (c) => c.textContent
    )
    expect(codes).toEqual(["a.ts", "b.ts"])
  })

  // A numbered read result, as the in-process engine formats it (`<n>\t…`).
  const readOf = (path: string, lines: number): ToolCallContent => ({
    type: "content",
    content: {
      type: "text",
      text: Array.from(
        { length: lines },
        (_, i) => `${String(i + 1).padStart(6)}\tline ${i + 1}`
      ).join("\n"),
    },
  })

  // A read leads with the line count it returned, then the path — derived from
  // the result + rawInput, not the tool's title.
  it("renders an in-process read as 'Read N lines' + path", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({
          title: "read_file",
          kind: "read",
          status: "completed",
          rawInput: { path: "src/foo.ts" },
          content: [readOf("src/foo.ts", 3)],
        })}
      />
    )
    const row = screen.getByTestId("tool-call")
    expect(row.textContent).toContain("Read 3 lines")
    expect(container.querySelector("code")?.textContent).toBe("src/foo.ts")
  })

  // The whole point: a generic adapter's prose "Read File" (with the path under
  // a different rawInput key, and a `→` gutter) renders identically to ours —
  // never the bare prose title.
  it("normalizes a generic-adapter read to the same 'Read N lines' + path", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({
          title: "Read File",
          kind: "read",
          status: "completed",
          rawInput: { abs_path: "src/foo.ts" },
          content: [
            {
              type: "content",
              content: { type: "text", text: "     1→a\n     2→b" },
            },
          ],
        })}
      />
    )
    const row = screen.getByTestId("tool-call")
    expect(row.textContent).toContain("Read 2 lines")
    expect(row.textContent).not.toContain("Read File")
    expect(container.querySelector("code")?.textContent).toBe("src/foo.ts")
  })

  // Before the result arrives (or for a non-numbered read) there's no count, so
  // it shows a plain "Read" + path — still the path, never the bare prose title.
  it("shows a read's path even with no line count yet", () => {
    render(
      <AgentMessageItem
        message={toolCall({
          title: "Read File",
          kind: "read",
          status: "in_progress",
          rawInput: { file_path: "a.ts" },
          content: [],
        })}
      />
    )
    const row = screen.getByTestId("tool-call")
    expect(row.textContent).toContain("Read")
    expect(row.textContent).not.toContain("lines")
    expect(row.textContent).not.toContain("Read File")
  })

  // Edits normalize the same way: a generic adapter's "Edit File" + path becomes
  // "Edit" + the path, matching the in-process `edit_file` rendering.
  it("normalizes a generic-adapter edit to 'Edit' + path", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({
          title: "Edit File",
          kind: "edit",
          status: "completed",
          rawInput: { path: "a.ts" },
        })}
      />
    )
    const row = screen.getByTestId("tool-call")
    expect(row.textContent).not.toContain("Edit File")
    expect(container.querySelector("code")?.textContent).toBe("a.ts")
  })

  // A `read_skill` is also `kind: "read"` but has no path — it must keep its
  // specific label and skill-name detail, never a spurious line count.
  it("keeps read_skill's label and detail, with no line count", () => {
    const { container } = render(
      <AgentMessageItem
        message={toolCall({
          title: "read_skill",
          kind: "read",
          status: "completed",
          rawInput: { name: "diagnose" },
          content: [readOf("x", 5)],
        })}
      />
    )
    const row = screen.getByTestId("tool-call")
    expect(row.textContent).toContain("Read skill")
    expect(row.textContent).not.toContain("lines")
    expect(container.querySelector("code")?.textContent).toBe("diagnose")
  })
})

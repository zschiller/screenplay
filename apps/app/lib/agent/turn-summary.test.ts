import { describe, expect, it } from "vitest"

import { foldFrameDrives, groupToolCalls } from "./group-tool-calls"
import { foldFinishedTurns, summarizeSteps } from "./turn-summary"
import type { AgentMessage } from "@/lib/agent/types"

type ToolCall = Extract<AgentMessage, { role: "tool_call" }>

function call(toolCallId: string, partial: Partial<ToolCall> = {}): ToolCall {
  return {
    role: "tool_call",
    toolCallId,
    title: "run_command",
    status: "completed",
    content: [],
    ...partial,
  }
}

const user = (content: string): AgentMessage => ({ role: "user", content })
const assistant = (content: string): AgentMessage => ({
  role: "assistant",
  content,
})

/** The fold, reduced to readable shapes: "user", "summary(n)", "assistant:…". */
function shape(messages: AgentMessage[], streaming = false): string[] {
  return foldFinishedTurns(groupToolCalls(messages), { streaming }).map(
    (item) =>
      item.kind === "turn-summary"
        ? `summary(${item.steps.length})`
        : item.entry.message.role === "assistant"
          ? `assistant:${item.entry.message.content}`
          : item.entry.message.role
  )
}

describe("foldFinishedTurns (issue #800)", () => {
  it("keeps a question card on screen in a folded turn (#1312)", () => {
    expect(
      shape([
        user("tidy the header"),
        call("t1"),
        assistant("Two ways to go."),
        call("q1", { title: "ask_question" }),
        user("Compact"),
      ])
    ).toEqual([
      "user",
      "summary(1)",
      "assistant:Two ways to go.",
      "tool_call",
      "user",
    ])
  })

  it("shows only a Coordinator wake's reply and task rows, never its message or steps, keeping its task rows (#897)", () => {
    const wake: AgentMessage = {
      role: "user",
      content: "Workspace finished its turn.",
      wakeFrom: "ws-a",
    }
    const send = call("s", {
      title: "send_to_workspace",
      rawInput: { workspace_id: "ws-b", message: "Go" },
    })
    // Quiet: nothing shows, not even its reads.
    expect(
      shape([
        user("hi"),
        assistant("Hello"),
        wake,
        call("r", { title: "read_workspace_chat" }),
      ])
    ).toEqual(["user", "assistant:Hello"])
    // A follow-up it sent still shows as a task row.
    expect(shape([wake, call("r", { title: "read_canvas" }), send])).toEqual([
      "tool_call",
    ])
    // A wake that answers shows its reply; its message never shows.
    expect(shape([wake, assistant("Checkout form is ready.")])).toEqual([
      "assistant:Checkout form is ready.",
    ])
    // Its reads stay hidden behind the reply, with no summary line.
    expect(
      shape([
        wake,
        assistant("Let me look."),
        call("r", { title: "read_workspace_chat" }),
        assistant("Checkout form is ready."),
      ])
    ).toEqual(["assistant:Checkout form is ready."])
    // Still running: its steps and narration stay hidden, the reply being
    // written shows, and task rows show as they're sent.
    expect(shape([wake, call("r")], true)).toEqual([])
    expect(shape([wake, assistant("Let me look."), call("r")], true)).toEqual(
      []
    )
    expect(shape([wake, call("r"), send], true)).toEqual(["tool_call"])
    expect(shape([wake, call("r"), assistant("Checkout")], true)).toEqual([
      "assistant:Checkout",
    ])
  })

  it("hides a wake's stored no-reply line, but not a user turn's (#1224)", () => {
    const wake: AgentMessage = {
      role: "user",
      content: "Workspace finished its turn.",
      wakeFrom: "ws-a",
    }
    expect(
      shape([
        user("hi"),
        assistant("Hello"),
        wake,
        call("r", { title: "read_workspace_chat" }),
        assistant("No response requested."),
      ])
    ).toEqual(["user", "assistant:Hello"])
    expect(shape([user("hi"), assistant("No response requested.")])).toEqual([
      "user",
      "assistant:No response requested.",
    ])
  })

  it("keeps Workspace task rows on screen (#896)", () => {
    const send = (id: string) =>
      call(id, {
        title: "send_to_workspace",
        rawInput: { workspace_id: `ws-${id}`, message: "Go" },
      })
    // Only task rows: nothing to fold, the narration stays.
    expect(
      shape([
        user("split it"),
        assistant("Starting"),
        send("a"),
        send("b"),
        assistant("Sent"),
      ])
    ).toEqual([
      "user",
      "assistant:Starting",
      "tool_call",
      "tool_call",
      "assistant:Sent",
    ])
    // With other work, the rows sit after the summary line.
    expect(
      shape([
        user("split it"),
        call("r", { title: "read_canvas" }),
        send("a"),
        assistant("Sent"),
      ])
    ).toEqual(["user", "summary(1)", "tool_call", "assistant:Sent"])
    // The message that started the chats stays over their cards (#1318).
    expect(
      shape([
        user("split it"),
        call("r", { title: "read_canvas" }),
        assistant("Looking"),
        call("r2", { title: "read_canvas" }),
        assistant("Starting two chats"),
        send("a"),
        send("b"),
        assistant("Sent"),
      ])
    ).toEqual([
      "user",
      "summary(3)",
      "assistant:Starting two chats",
      "tool_call",
      "tool_call",
      "assistant:Sent",
    ])
  })

  it("folds a finished turn's steps and narration, keeping the answer", () => {
    const messages = [
      user("fix it"),
      assistant("Looking"),
      call("a", { title: "read_file", rawInput: { path: "a.ts" } }),
      { role: "reasoning", content: "hmm" } as AgentMessage,
      call("b", { title: "edit_file", rawInput: { path: "a.ts" } }),
      assistant("Done"),
    ]
    expect(shape(messages)).toEqual(["user", "summary(4)", "assistant:Done"])
  })

  it("keeps the last assistant message even when a step follows it", () => {
    const messages = [
      user("ship it"),
      assistant("Opening the PR"),
      call("pr", { title: "create_pr" }),
    ]
    expect(shape(messages)).toEqual([
      "user",
      "summary(1)",
      "assistant:Opening the PR",
    ])
  })

  it("leaves plans, errors and the stopped marker on screen", () => {
    const messages: AgentMessage[] = [
      user("go"),
      call("a"),
      { role: "error", content: "boom" },
      call("b"),
      { role: "stopped" },
    ]
    expect(shape(messages)).toEqual(["user", "summary(2)", "error", "stopped"])
  })

  it("renders the streaming turn flat, and earlier turns folded", () => {
    const messages = [
      user("one"),
      call("a"),
      assistant("first"),
      user("two"),
      call("b"),
    ]
    expect(shape(messages, true)).toEqual([
      "user",
      "summary(1)",
      "assistant:first",
      "user",
      "tool_call",
    ])
  })

  it("leaves a turn with no tool calls alone, reasoning included", () => {
    const messages = [
      user("hi"),
      { role: "reasoning", content: "hmm" } as AgentMessage,
      assistant("hello"),
    ]
    expect(shape(messages)).toEqual(["user", "reasoning", "assistant:hello"])
  })

  it("folds a subagent group as one step", () => {
    const messages = [
      user("go"),
      call("task", { title: "Task" }),
      call("child", { parentToolCallId: "task" }),
      assistant("ok"),
    ]
    expect(shape(messages)).toEqual(["user", "summary(1)", "assistant:ok"])
  })
})

describe("summarizeSteps", () => {
  const summarize = (messages: AgentMessage[]) =>
    summarizeSteps(groupToolCalls(messages))

  it("names the Coordinator's reads, under a harness's MCP names too", () => {
    const { text } = summarize([
      call("1", { title: "mcp__screenplay__read_canvas", kind: "other" }),
      call("2", {
        title: "read_workspace_chat",
        rawInput: { workspaceId: "ws-a" },
      }),
      call("3", {
        title: "mcp__screenplay__read_workspace_diff",
        rawInput: { workspaceId: "ws-a" },
      }),
      call("4", { title: "Tool: screenplay/list_changes" }),
    ])
    expect(text).toBe("Read the canvas, checked 1 workspace, listed changes")
  })

  it("counts reads, edits and commands, each file once", () => {
    const { text, failures } = summarize([
      call("1", { title: "read_file", rawInput: { path: "a.ts" } }),
      call("2", { title: "read_file", rawInput: { path: "b.ts" } }),
      call("3", { title: "read_file", rawInput: { path: "a.ts" } }),
      call("4", { title: "edit_file", rawInput: { path: "a.ts" } }),
      call("5", { rawInput: { command: "pnpm", args: ["test"] } }),
      call("6", { rawInput: { command: "pnpm", args: ["lint"] } }),
    ])
    expect(text).toBe("Read 2 files, edited 1, ran 2 commands")
    expect(failures).toEqual([])
  })

  it("says a Coordinator's arrange and undo calls changed the canvas, not files", () => {
    const { text, failures } = summarize([
      call("1", { title: "remove", kind: "delete" }),
      call("2", { title: "move_group", kind: "move", status: "failed" }),
      call("3", { title: "undo_changes", kind: "edit" }),
    ])
    expect(text).toBe("Changed the canvas")
    expect(failures).toEqual(["Canvas change"])
  })

  it("counts a frame drive as one frame, its reads and steps alike (#1390)", () => {
    const { text, failures } = summarize([
      call("1", { title: "frame_start_driving", rawInput: { pace: "show" } }),
      call("2", { title: "mcp__screenplay__frame_elements" }),
      call("3", {
        title: "frame_click",
        rawInput: { target: { text: "Save" } },
      }),
      call("4", { title: "frame_type", status: "failed" }),
      call("5", { title: "frame_screenshot" }),
    ])
    expect(text).toBe("Viewed 1 frame, used 1 frame")
    expect(failures).toEqual(["Frame step"])
  })

  it("counts a folded frame drive the same as a flat one", () => {
    const steps = [
      call("1", { title: "frame_start_driving", rawInput: { pace: "show" } }),
      call("2", { title: "mcp__screenplay__frame_elements" }),
      call("3", {
        title: "frame_click",
        rawInput: { target: { text: "Save" } },
      }),
      call("4", { title: "frame_type", status: "failed" }),
      call("5", { title: "frame_screenshot" }),
    ]
    const folded = foldFrameDrives(groupToolCalls(steps))
    expect(folded).toHaveLength(1)
    expect(summarizeSteps(folded)).toEqual(summarize(steps))
  })

  it("reads an ACP adapter's calls by kind", () => {
    const { text } = summarize([
      call("1", {
        title: "Read File",
        kind: "read",
        rawInput: { file_path: "a" },
      }),
      call("2", {
        title: "`ls`",
        kind: "execute",
        rawInput: { command: "ls" },
      }),
      call("3", { title: "grep", kind: "search" }),
    ])
    expect(text).toBe("Read 1 file, ran 1 command, searched 1 time")
  })

  it("counts searches and listings as searches, even under a stored read kind (#1477)", () => {
    const { text } = summarize([
      call("1", {
        title: "search_code",
        kind: "read",
        rawInput: { workspaceId: "w", pattern: "foo", path: "src" },
      }),
      call("2", { title: "find_code_files", kind: "read", rawInput: {} }),
      call("3", {
        title: "list_files",
        kind: "read",
        rawInput: { path: "apps" },
      }),
      call("4", {
        title: "mcp__screenplay__read_code_file",
        rawInput: { workspaceId: "w", path: "a.ts" },
      }),
    ])
    expect(text).toBe("Read 1 file, searched 3 times")
  })

  it("names each failed call, a command by its first two words", () => {
    const { failures } = summarize([
      call("1", {
        status: "failed",
        rawInput: { command: "pnpm", args: ["lint", "--fix"] },
      }),
      call("2", {
        title: "edit_file",
        status: "failed",
        rawInput: { path: "a.ts" },
      }),
    ])
    expect(failures).toEqual(["pnpm lint", "Edit"])
  })

  it("names an adapter's failed command by its title, and finds a diff's file", () => {
    const { text, failures } = summarize([
      call("1", { title: "pnpm lint", kind: "execute", status: "failed" }),
      call("2", {
        title: "Edit a.ts",
        kind: "edit",
        content: [{ type: "diff", path: "a.ts", oldText: "a", newText: "b" }],
      }),
      call("3", { rawInput: { command: "ls" } }),
      // An edit still streaming its input names no file yet.
      call("4", { title: "Edit", kind: "edit" }),
    ])
    expect(text).toBe("Edited 2 files, ran 2 commands")
    expect(failures).toEqual(["pnpm lint"])
  })

  it("counts a failure inside a subagent", () => {
    const { text, failures } = summarize([
      call("task", { title: "Task" }),
      call("child", {
        parentToolCallId: "task",
        status: "failed",
        rawInput: { command: "make" },
      }),
    ])
    expect(text).toBe("Ran 1 subagent")
    expect(failures).toEqual(["make"])
  })

  it("joins commands and subagents under one verb", () => {
    const { text } = summarize([
      call("1", { rawInput: { command: "ls" } }),
      call("task", { title: "Task" }),
      call("child", { parentToolCallId: "task" }),
    ])
    expect(text).toBe("Ran 1 command and 1 subagent")
  })

  it("says 'other' only after something else", () => {
    expect(summarize([call("1", { title: "Fetch", kind: "fetch" })]).text).toBe(
      "Used 1 tool"
    )
    expect(
      summarize([
        call("1", { title: "read_file", rawInput: { path: "a" } }),
        call("2", { title: "Fetch", kind: "fetch" }),
      ]).text
    ).toBe("Read 1 file, used 1 other tool")
  })
})

describe("foldFinishedTurns — a run with a Steer (#1190)", () => {
  const steered: AgentMessage[] = [
    { role: "user", content: "Make it sticky" },
    { role: "assistant", content: "Pinning it." },
    {
      role: "tool_call",
      toolCallId: "t1",
      title: "Edit summary.tsx",
      kind: "edit",
      status: "completed",
      content: [],
    },
    { role: "user", content: "Keep the pay button in it" },
    { role: "assistant", content: "Moving it" },
  ]
  const kinds = (streaming: boolean, liveFrom?: number | null) =>
    foldFinishedTurns(groupToolCalls(steered), { streaming, liveFrom }).map(
      (i) => i.kind
    )

  it("keeps the part of the running turn before the Steer unfolded", () => {
    expect(kinds(true, 0)).toEqual([
      "message",
      "message",
      "message",
      "message",
      "message",
    ])
  })

  it("folds it once the run is over", () => {
    expect(kinds(false, null)).toContain("turn-summary")
  })
})

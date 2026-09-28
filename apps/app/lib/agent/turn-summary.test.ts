import { describe, expect, it } from "vitest"

import { groupToolCalls } from "./group-tool-calls"
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

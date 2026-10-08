import { describe, expect, it } from "vitest"

import {
  callIdentity,
  describeToolCall,
  driveName,
  readableFrameNames,
  relativePath,
  SCREENPLAY_TOOLS,
  toolKind,
  type ToolCallMessage,
} from "./tool-description"

const call = (partial: Partial<ToolCallMessage>): ToolCallMessage => ({
  role: "tool_call",
  toolCallId: "t",
  title: "run_command",
  status: "completed",
  content: [],
  ...partial,
})
const result = (text: string): ToolCallMessage["content"] => [
  { type: "content", content: { type: "text", text } },
]
const describe_ = (
  partial: Partial<ToolCallMessage>,
  titles: Record<string, string> = {}
) =>
  describeToolCall(call(partial), {
    workspaceTitle: (id) => titles[id] ?? null,
  })
const label = (
  partial: Partial<ToolCallMessage>,
  titles: Record<string, string> = {}
) => describe_(partial, titles).label

/** What a person sees of a call: everything but its name. */
const seen = (partial: Partial<ToolCallMessage>) => {
  const { name: _, ...rest } = describe_(partial)
  return rest
}

describe("callIdentity", () => {
  it("unwraps Codex’s MCP calls and their arguments", () => {
    expect(
      callIdentity(
        call({
          title: "mcp.screenplay.read_canvas",
          rawInput: {
            server: "screenplay",
            tool: "read_canvas",
            arguments: { a: 1 },
          },
        })
      )
    ).toEqual({ name: "read_canvas", input: { a: 1 } })
  })

  it("strips Claude Code’s namespace and keeps its input", () => {
    expect(
      callIdentity(
        call({ title: "mcp__screenplay__frame_click", rawInput: { a: 1 } })
      )
    ).toEqual({ name: "frame_click", input: { a: 1 } })
  })

  it("unwraps Antigravity’s call_mcp_tool and its arguments", () => {
    const antigravity = (Arguments: unknown) =>
      callIdentity(
        call({
          title: "Running read_canvas",
          rawInput: {
            ServerName: "screenplay",
            ToolName: "read_canvas",
            Arguments,
            toolSummary: "Reading the canvas",
          },
        })
      )
    expect(antigravity({ a: 1 })).toEqual({
      name: "read_canvas",
      input: { a: 1 },
    })
    expect(antigravity('{"a":1}')).toEqual({
      name: "read_canvas",
      input: { a: 1 },
    })
  })
})

describe("relativePath", () => {
  it("keeps the repo-relative tail an adapter’s title shows", () => {
    expect(relativePath("/Users/zack/code/app/src/a.ts", "Read src/a.ts")).toBe(
      "src/a.ts"
    )
  })

  it("falls back to the last three parts", () => {
    expect(relativePath("/Users/zack/code/app/src/a.ts", "Read")).toBe(
      "app/src/a.ts"
    )
    expect(relativePath("src/a.ts", "anything")).toBe("src/a.ts")
  })
})

describe("Screenplay’s own tools", () => {
  it("give every tool a verb, an icon and an ACP kind", () => {
    for (const [name, entry] of Object.entries(SCREENPLAY_TOOLS)) {
      const d = describe_({ title: name })
      expect(d.label.verb, name).toBeTruthy()
      expect(d.label.title, name).toBeUndefined()
      expect(d.icon, name).toBe(entry.icon)
      expect(toolKind(name), name).toBe(entry.kind)
    }
  })

  it("describe the code tools", () => {
    expect(
      describe_({
        title: "read_file",
        rawInput: { path: "src/a.ts" },
        content: result("1\tconst a = 1\n2\tconst b = 2"),
      })
    ).toMatchObject({
      label: { verb: "Read 2 lines", detail: "src/a.ts", as: "code" },
      icon: "file",
      output: "plain",
      readPath: "src/a.ts",
      category: "read",
      summaryKey: "src/a.ts",
      failure: "Read",
    })
    expect(
      describe_({ title: "write_file", rawInput: { path: "a.ts" } })
    ).toMatchObject({
      label: { verb: "Write", detail: "a.ts" },
      icon: "file",
      category: "edit",
    })
    expect(
      describe_({ title: "edit_file", rawInput: { path: "a.ts" } })
    ).toMatchObject({
      label: { verb: "Edit", detail: "a.ts" },
      icon: "edit",
      category: "edit",
      failure: "Edit",
    })
    expect(
      describe_({
        title: "run_command",
        rawInput: { command: "pnpm", args: ["lint", "--fix"] },
      })
    ).toMatchObject({
      label: { verb: "Run command", detail: "pnpm lint --fix" },
      icon: "terminal",
      output: "log",
      rewrite: "command-output",
      category: "run",
      failure: "pnpm lint",
    })
    expect(
      describe_({ title: "list_files", rawInput: { path: "src" } })
    ).toMatchObject({
      label: { verb: "List files", detail: "src" },
      icon: "folder",
      category: "search",
      readPath: null,
    })
    for (const title of ["grep", "search_code"]) {
      expect(
        describe_({ title, rawInput: { pattern: "useFoo", path: "src" } })
      ).toMatchObject({
        label: { verb: "Search", detail: "useFoo" },
        icon: "search",
        category: "search",
      })
    }
    for (const title of ["glob", "find_code_files"]) {
      expect(describe_({ title, rawInput: { pattern: "*.ts" } })).toMatchObject(
        {
          label: { verb: "Find files", detail: "*.ts" },
          icon: "folder",
          category: "search",
        }
      )
    }
    expect(
      describe_({ title: "read_skill", rawInput: { name: "tdd" } })
    ).toMatchObject({
      label: { verb: "Read skill", detail: "tdd" },
      output: "markdown",
      category: null,
      failure: "A step",
    })
    expect(describe_({ title: "read_dev_server_logs" }).output).toBe("log")
  })

  it("describe the document and Mockup tools", () => {
    expect(describe_({ title: "read_document" })).toMatchObject({
      output: "markdown",
      category: "readDoc",
    })
    expect(
      describe_({ title: "set_document_title", rawInput: { title: "Plan" } })
    ).toMatchObject({
      label: { verb: "Set title", detail: "Plan", as: "text" },
      category: "editDoc",
    })
    expect(
      describe_({
        title: "create_mockup",
        rawInput: { title: "Pricing" },
        content: result("Created Mockup [m1]."),
      })
    ).toMatchObject({
      label: { verb: "Create mockup", detail: "Pricing" },
      icon: "mockup",
      quiet: true,
    })
    expect(describe_({ title: "read_mockup" })).toMatchObject({
      label: { verb: "Read mockup" },
      output: "prose",
    })
  })

  it("says which memory a save went to, and what it saved (#1515)", () => {
    expect(
      label({
        title: "write_memory",
        rawInput: { scope: "account", action: "add", text: "Plain UI copy." },
      })
    ).toEqual({
      verb: "Save to account memory",
      detail: "Plain UI copy.",
      as: "text",
    })
    expect(
      label({
        title: "write_memory",
        rawInput: {
          scope: "canvas",
          action: "edit",
          id: "mem-1",
          text: "Use pnpm.",
        },
      })
    ).toEqual({ verb: "Edit canvas memory", detail: "Use pnpm.", as: "text" })
    expect(
      label({
        title: "write_memory",
        rawInput: { scope: "account", action: "remove", id: "mem-1" },
      })
    ).toEqual({ verb: "Remove from account memory" })
    expect(describe_({ title: "write_memory" })).toMatchObject({
      label: { verb: "Save to memory" },
      category: "memory",
    })
  })

  it("names a Workspace a Coordinator tool reads by its title", () => {
    expect(
      label(
        { title: "read_workspace_diff", rawInput: { workspaceId: "w1" } },
        { w1: "Checkout" }
      )
    ).toEqual({ verb: "Read changes in", detail: "Checkout", as: "text" })
    // Without a title, the plain verb.
    expect(
      label({ title: "read_workspace_diff", rawInput: { workspaceId: "w1" } })
    ).toEqual({ verb: "Read chat changes" })
    expect(
      describe_({
        title: "read_workspace_chat",
        rawInput: { workspaceId: "w1" },
      })
    ).toMatchObject({
      output: "markdown",
      category: "readWorkspace",
      summaryKey: "w1",
    })
  })

  it("shows a finished canvas change by what it did", () => {
    const done = describe_({
      title: "remove",
      content: result('Removed frame "Settings".\nid: f1'),
    })
    expect(done).toMatchObject({
      label: { verb: 'Removed frame "Settings"' },
      quiet: true,
      category: "canvas",
      failure: "Canvas change",
    })
    // Running, or refused, it keeps its verb and its result.
    expect(describe_({ title: "remove", status: "in_progress" })).toMatchObject(
      { label: { verb: "Remove" }, quiet: false }
    )
    expect(
      describe_({ title: "remove", content: result("Error: no such frame") })
    ).toMatchObject({ label: { verb: "Remove" }, quiet: false })
    expect(
      describe_({
        title: "open_pull_request",
        content: result("Opened PR #12."),
      }).label
    ).toEqual({ verb: "Opened PR #12" })
  })

  it("labels Frame Drive steps by what they acted on", () => {
    expect(
      label({
        title: "frame_click",
        rawInput: { target: { selector: "main > button.pay" } },
        content: result(
          'Did click on button "Pay now" in frame [f1] (/checkout).'
        ),
      })
    ).toMatchObject({ verb: "Click", detail: "Pay now" })
    expect(
      label({
        title: "frame_click",
        rawInput: { target: { selector: "main > button.pay" } },
      })
    ).toMatchObject({ verb: "Click", detail: "button.pay" })
    expect(
      label({
        title: "frame_click",
        rawInput: { target: { x: 412.2, y: 300 } },
      })
    ).toMatchObject({ detail: "at 412, 300" })
    expect(
      label({
        title: "frame_key",
        rawInput: { key: "Enter", modifiers: { shiftKey: true } },
      })
    ).toEqual({ verb: "Press", detail: "⇧ Enter", as: "key" })
    expect(label({ title: "frame_scroll", rawInput: { dy: 400 } })).toEqual({
      verb: "Scroll down",
    })
    expect(
      label({
        title: "frame_drag",
        rawInput: { target: { text: "Card" }, to: { x: 10, y: 20 } },
      })
    ).toEqual({ verb: "Drag", detail: "Card to 10, 20", as: "text" })
    expect(label({ title: "frame_type", rawInput: { text: "hi" } })).toEqual({
      verb: "Type",
      detail: "“hi”",
      as: "text",
    })
    expect(label({ title: "frame_elements" })).toEqual({
      verb: "Read the page",
    })
  })

  it("says which frame steps a drive folds, and on which frame", () => {
    const click = describe_({
      title: "frame_click",
      rawInput: { frameId: "f1" },
      content: result('Did click on button "Pay" in frame [f1] (/pay).'),
    })
    expect(click).toMatchObject({
      driveStep: true,
      gesture: true,
      frameId: "f1",
      quiet: true,
      rewrite: "frame-names",
      category: "drive",
      summaryKey: "f1",
      failure: "Frame step",
    })
    // A gesture whose result says more than it did opens onto it.
    expect(
      describe_({ title: "frame_click", content: result("No such element") })
        .quiet
    ).toBe(false)
    expect(describe_({ title: "frame_elements" })).toMatchObject({
      driveStep: true,
      gesture: false,
      frameId: "",
      summaryKey: "own frame",
    })
    expect(describe_({ title: "frame_open" })).toMatchObject({
      driveStep: false,
      category: "canvas",
    })
    expect(describe_({ title: "view_frame" }).driveStep).toBe(false)
  })
})

describe("a harness’s own tools", () => {
  it("reads Claude Code’s built-ins", () => {
    expect(
      describe_({
        title: "grep -n useFoo src",
        kind: "search",
        rawInput: { pattern: "useFoo" },
      })
    ).toMatchObject({
      label: { verb: "Search", detail: "useFoo" },
      icon: "search",
      category: "search",
    })
    expect(
      describe_({
        title: "Find `**/*.ts`",
        kind: "search",
        rawInput: { pattern: "**/*.ts" },
      })
    ).toMatchObject({
      label: { verb: "Find files", detail: "**/*.ts" },
      icon: "folder",
    })
    expect(
      describe_({ title: "Skill", kind: "read", rawInput: { skill: "tdd" } })
    ).toMatchObject({
      label: { verb: "Read skill", detail: "tdd" },
      icon: "skill",
      quiet: true,
      category: null,
    })
    expect(
      describe_({
        title: "Fetch",
        kind: "fetch",
        rawInput: { url: "https://acp.dev/spec" },
      })
    ).toMatchObject({
      label: { verb: "Fetch", detail: "acp.dev/spec" },
      icon: "globe",
      output: "markdown",
    })
    expect(
      describe_({
        title: "NotebookEdit",
        rawInput: { notebook_path: "a.ipynb" },
      }).label
    ).toEqual({ verb: "Edit notebook", detail: "a.ipynb", as: "code" })
  })

  it("reads OpenCode’s built-ins, whose titles change as they run (#1589)", () => {
    for (const title of ["skill", "Loaded skill: tidy-copy"]) {
      expect(
        describe_({ title, kind: "other", rawInput: { name: "tidy-copy" } })
      ).toMatchObject({
        label: { verb: "Read skill", detail: "tidy-copy" },
        icon: "skill",
        quiet: true,
      })
    }
    // A finished grep or glob is titled with its bare pattern.
    expect(
      describe_({
        title: "useFoo",
        kind: "search",
        rawInput: { pattern: "useFoo" },
      })
    ).toMatchObject({
      label: { verb: "Search", detail: "useFoo" },
      icon: "search",
      category: "search",
    })
    // A finished read or write is titled with the path; a command, with itself.
    expect(
      label({
        title: "src/a.ts",
        kind: "read",
        rawInput: { filePath: "/Users/zack/app/src/a.ts" },
      })
    ).toMatchObject({ verb: "Read", detail: "src/a.ts" })
    expect(
      label({
        title: "src/a.ts",
        kind: "edit",
        rawInput: { filePath: "src/a.ts", content: "x" },
      })
    ).toMatchObject({ verb: "Edit", detail: "src/a.ts" })
    expect(
      label({
        title: "ls -a",
        kind: "execute",
        rawInput: { command: "ls -a", description: "List files" },
      })
    ).toEqual({ verb: "Run command", detail: "ls -a", as: "code" })
    expect(label({ title: "screenplay_read_canvas" })).toEqual(
      label({ title: "read_canvas" })
    )
  })

  it("reads Codex’s prose titles", () => {
    expect(label({ title: "Read file 'src/a.ts'" })).toMatchObject({
      verb: "Read",
      detail: "src/a.ts",
    })
    expect(
      describe_({ title: "Search for 'useFoo' in src", kind: "search" })
    ).toMatchObject({
      label: { verb: "Search", detail: "useFoo" },
      icon: "search",
    })
    expect(describe_({ title: "Web search: acp spec" })).toMatchObject({
      label: { verb: "Search the web", detail: "acp spec" },
      icon: "globe",
    })
    expect(describe_({ title: "mcp__screenplay__startup" })).toMatchObject({
      label: { verb: "Screenplay’s tools didn’t start" },
      icon: "warning",
    })
    // Its command title is the command without the shell wrapper.
    expect(
      describe_({
        title: "pnpm test",
        kind: "execute",
        rawInput: { command: "/bin/zsh -lc 'pnpm test'" },
      })
    ).toMatchObject({
      label: { verb: "Run command", detail: "pnpm test" },
      output: "log",
      category: "run",
    })
  })

  it("falls back on a tool it doesn’t know", () => {
    // A PascalCase name reads as words.
    expect(describe_({ title: "NotebookRead" })).toMatchObject({
      label: { verb: "Notebook read" },
      icon: "terminal",
      category: null,
      failure: "A step",
    })
    // A prose title keeps every character, its code spans its subjects.
    expect(describe_({ title: "Open [docs](http://x.com)" })).toMatchObject({
      label: { verb: "Open [docs](http://x.com)", title: true },
      icon: "terminal",
    })
    // An unknown snake_case tool reads as words, by its kind's icon.
    expect(
      describe_({
        title: "search_files",
        kind: "search",
        rawInput: { path: "src" },
      })
    ).toMatchObject({
      label: { verb: "Search files", detail: "src" },
      icon: "search",
      category: "search",
    })
    // A read with nothing to name keeps its title, and isn't a file read.
    expect(describe_({ title: "Read File", kind: "read" })).toMatchObject({
      label: { verb: "Read File", title: true },
      icon: "file",
      category: null,
    })
  })
})

describe("the same action on every engine", () => {
  it("reads a file the same way", () => {
    const lines = result("1\tconst a = 1\n2\tconst b = 2")
    const arrowLines = result("     1→const a = 1\n     2→const b = 2")
    const inProcess = seen({
      title: "read_file",
      kind: "read",
      rawInput: { path: "src/a.ts" },
      content: lines,
    })
    const claudeCode = seen({
      title: "Read src/a.ts",
      kind: "read",
      rawInput: { file_path: "/Users/zack/app/src/a.ts" },
      content: arrowLines,
    })
    expect(claudeCode.label).toEqual(inProcess.label)
    expect(claudeCode).toMatchObject({
      icon: inProcess.icon,
      output: inProcess.output,
      category: inProcess.category,
      failure: inProcess.failure,
    })
  })

  it("edits and writes a file the same way", () => {
    const edit = seen({
      title: "edit_file",
      kind: "edit",
      rawInput: { path: "src/a.ts" },
    })
    expect(
      seen({
        title: "Edit `src/a.ts`",
        kind: "edit",
        rawInput: { file_path: "/Users/zack/app/src/a.ts" },
      })
    ).toMatchObject({
      label: edit.label,
      icon: edit.icon,
      output: edit.output,
      category: edit.category,
      failure: edit.failure,
    })
    const write = seen({
      title: "write_file",
      kind: "edit",
      rawInput: { path: "src/a.ts" },
    })
    expect(
      seen({
        title: "Write `src/a.ts`",
        kind: "edit",
        rawInput: { file_path: "/Users/zack/app/src/a.ts", content: "x" },
      })
    ).toMatchObject({
      label: write.label,
      icon: write.icon,
      category: write.category,
    })
  })

  it("runs a command the same way", () => {
    const inProcess = seen({
      title: "run_command",
      kind: "execute",
      rawInput: { command: "pnpm test" },
    })
    const claudeCode = seen({
      title: "`pnpm test`",
      kind: "execute",
      rawInput: { command: "pnpm test", description: "Run tests" },
    })
    expect(claudeCode).toMatchObject({
      label: inProcess.label,
      icon: inProcess.icon,
      output: inProcess.output,
      category: inProcess.category,
      failure: inProcess.failure,
    })
  })

  it("searches the same way", () => {
    const inProcess = seen({
      title: "grep",
      kind: "search",
      rawInput: { pattern: "useFoo" },
    })
    expect(
      seen({
        title: "grep useFoo",
        kind: "search",
        rawInput: { pattern: "useFoo" },
      })
    ).toMatchObject({
      label: inProcess.label,
      icon: inProcess.icon,
      category: inProcess.category,
    })
  })

  it("describes our tools identically when a harness calls them over MCP", () => {
    const cases: Partial<ToolCallMessage>[] = [
      { title: "read_canvas", content: result("# Canvas") },
      {
        title: "read_code_file",
        rawInput: { path: "src/a.ts", workspaceId: "w1" },
        content: result("1\tconst a = 1"),
      },
      {
        title: "frame_click",
        rawInput: { frameId: "f1", target: { text: "Pay" } },
        content: result('Did click on button "Pay" in frame [f1] (/pay).'),
      },
      { title: "remove", content: result('Removed frame "Settings".') },
    ]
    for (const c of cases) {
      const inProcess = seen({ ...c, kind: toolKind(c.title!) })
      expect(
        seen({ ...c, title: `mcp__screenplay__${c.title}`, kind: "other" }),
        c.title
      ).toEqual(inProcess)
      expect(
        seen({
          ...c,
          title: `mcp.screenplay.${c.title}`,
          kind: "other",
          rawInput: {
            server: "screenplay",
            tool: c.title,
            arguments: c.rawInput ?? {},
          },
        }),
        c.title
      ).toEqual(inProcess)
    }
  })
})

describe("driveName", () => {
  it("names the Workspace, else the route, else the Mockup", () => {
    expect(
      driveName([
        call({ content: [] }),
        call({
          content: result(
            'Did click on the page in frame [f1] (/checkout in Workspace "Checkout"). The page is at /checkout.'
          ),
        }),
      ])
    ).toBe("Checkout")
    expect(
      driveName([
        call({
          content: result("Did click on the page in frame [f1] (/pay)."),
        }),
      ])
    ).toBe("/pay")
    expect(
      driveName([
        call({
          content: result('Did click on the page in Mockup [m1] ("Pricing").'),
        }),
      ])
    ).toBe("Pricing")
    expect(driveName([call({})])).toBeNull()
  })
})

describe("readableFrameNames", () => {
  it("names frames and Mockups as a person would", () => {
    expect(
      readableFrameNames(
        'frame [f1] (/checkout in Workspace "Checkout polish") is at /checkout.'
      )
    ).toBe("Checkout polish /checkout is at /checkout.")
    expect(readableFrameNames("Did click in frame [f2] (/pay).")).toBe(
      "Did click in frame /pay."
    )
    expect(readableFrameNames('Mockup [m1] ("Pricing") and Mockup [m2]')).toBe(
      "Pricing and the mockup"
    )
  })
})

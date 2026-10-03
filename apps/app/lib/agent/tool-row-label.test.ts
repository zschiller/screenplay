import { describe, expect, it } from "vitest"

import {
  callIdentity,
  driveName,
  readableFrameNames,
  relativePath,
  rowLabel,
} from "./tool-row-label"
import type { AgentMessage } from "@/lib/agent/types"

type Call = AgentMessage & { role: "tool_call" }

const call = (partial: Partial<Call>): Call => ({
  role: "tool_call",
  toolCallId: "t",
  title: "run_command",
  status: "completed",
  content: [],
  ...partial,
})
const result = (text: string): Call["content"] => [
  { type: "content", content: { type: "text", text } },
]
const label = (partial: Partial<Call>, titles: Record<string, string> = {}) =>
  rowLabel(call(partial), (id) => titles[id] ?? null)

describe("callIdentity", () => {
  it("unwraps Codex's MCP calls and their arguments", () => {
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

  it("strips Claude Code's namespace and keeps its input", () => {
    expect(
      callIdentity(
        call({ title: "mcp__screenplay__frame_click", rawInput: { a: 1 } })
      )
    ).toEqual({ name: "frame_click", input: { a: 1 } })
  })
})

describe("relativePath", () => {
  it("keeps the repo-relative tail an adapter's title shows", () => {
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

describe("rowLabel", () => {
  it("names a search by its pattern on every engine", () => {
    expect(
      label({ title: "grep", rawInput: { pattern: "useFoo" } })
    ).toMatchObject({
      verb: "Search",
      detail: "useFoo",
    })
    expect(
      label({
        title: "grep -n useFoo src",
        kind: "search",
        rawInput: { pattern: "useFoo" },
      })
    ).toMatchObject({ verb: "Search", detail: "useFoo" })
    expect(label({ title: "Search for 'useFoo' in src" })).toMatchObject({
      verb: "Search",
      detail: "useFoo",
    })
  })

  it("reads Codex's prose titles", () => {
    expect(label({ title: "Read file 'src/a.ts'" })).toMatchObject({
      verb: "Read",
      detail: "src/a.ts",
    })
    expect(label({ title: "Web search: acp spec" })).toMatchObject({
      verb: "Search the web",
      detail: "acp spec",
    })
  })

  it("names a Workspace a Coordinator tool reads by its title", () => {
    expect(
      label(
        { title: "read_workspace_diff", rawInput: { workspaceId: "w1" } },
        { w1: "Checkout" }
      )
    ).toMatchObject({ verb: "Read changes in", detail: "Checkout" })
    // Without a title, the shipped label stays.
    expect(
      label({ title: "read_workspace_diff", rawInput: { workspaceId: "w1" } })
    ).toBeNull()
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
  })

  it("leaves a tool it doesn't know to the shipped label", () => {
    expect(label({ title: "read_file", rawInput: { path: "a.ts" } })).toBeNull()
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

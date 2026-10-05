import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { extractProse, extractUiStrings } from "./extract"
import { findCopyViolations, findProseViolations } from "./rules"

const appDir = fileURLToPath(new URL("../../", import.meta.url))

/**
 * Where user-facing copy lives. `app/api` answers other code, `lib/agent`
 * (but for `tool-description.ts`, the chat's tool rows)
 * and `lib/frame-drive`'s tools and prompt write prompts and tool
 * descriptions for the model, and tests (and the shared contract suite) quote
 * copy rather than render it — none of them is read by a person as UI.
 */
function uiSourceFiles(): string[] {
  return (
    execFileSync("git", ["ls-files", "app", "components", "hooks", "lib"], {
      cwd: appDir,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !f.startsWith("app/api/"))
      // The tool rows a chat shows are copy; the rest of lib/agent is prompts.
      .filter(
        (f) =>
          !f.startsWith("lib/agent/") || f === "lib/agent/tool-description.ts"
      )
      .filter(
        (f) =>
          ![
            "lib/frame-drive/tools.ts",
            "lib/frame-drive/prompt.ts",
            "lib/frame-drive/contract-suite.ts",
          ].includes(f)
      )
      .filter((f) => !f.startsWith("lib/ui-copy/"))
  )
}

describe("UI copy uses the glossary's UI labels", () => {
  it("no user-facing string carries a code-only term or ASCII `...`", () => {
    const problems: string[] = []
    for (const file of uiSourceFiles()) {
      const source = readFileSync(appDir + file, "utf8")
      for (const s of extractUiStrings(file, source)) {
        for (const v of findCopyViolations(s.text)) {
          problems.push(
            `${file}:${s.line} “${s.text}” — ${v.rule} (“${v.match}”)`
          )
        }
      }
    }
    // See lib/ui-copy/rules.ts for the labels, and CONTEXT.md for the glossary.
    expect(problems).toEqual([])
  })

  it("no prose says “workspace”: people know it as a chat", () => {
    const problems: string[] = []
    for (const file of uiSourceFiles()) {
      const source = readFileSync(appDir + file, "utf8")
      for (const s of extractProse(file, source)) {
        for (const v of findProseViolations(s.text)) {
          problems.push(`${file}:${s.line} “${s.text}” — ${v.rule}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe("findCopyViolations", () => {
  it.each([
    ["Remove repo?", "repo → repository"],
    ["Add project", "project → repository (or canvas)"],
    ["Each iframeLayer runs a live preview", "iframeLayer → frame"],
    ["Back to room", "room → canvas"],
    ["Search chats...", "use the … character"],
    ["Choose a workspace", "workspace → chat"],
    ["Workspace stopped", "workspace → chat"],
    ["Choose a branch", "branch → chat"],
    ["Drove Checkout", "drive → control (or use)"],
    ["Driving {}", "drive → control (or use)"],
  ])("flags %j", (text, rule) => {
    expect(findCopyViolations(text).map((v) => v.rule)).toContain(rule)
  })

  it.each([
    "Search chats…",
    "Choose a chat",
    "Also delete 2 branches on remote",
    "Choose the base branch",
    "Open branch on GitHub",
    "Rename branch…",
    "Search GitHub repositories…",
    "Restart sandbox",
    "No repositories found.",
    "Add repository",
    "Used Checkout",
    "Take control",
  ])("passes %j", (text) => {
    expect(findCopyViolations(text)).toEqual([])
  })
})

describe("findProseViolations", () => {
  it.each([
    "The workspace is still starting…",
    "Couldn’t reopen Workspace",
    "Unpushed work in 2 workspaces will be lost.",
  ])("flags %j", (text) => {
    expect(findProseViolations(text).map((v) => v.rule)).toEqual([
      "workspace → chat",
    ])
  })

  it.each([
    "has-[[data-slot=workspace-mention-end]]:hidden",
    "@workspace/ui/components/button",
    'use "workspace" or "coordinator".',
    "Still setting up the code…",
  ])("passes %j", (text) => {
    expect(findProseViolations(text)).toEqual([])
  })
})

describe("extractUiStrings", () => {
  const strings = (src: string) =>
    extractUiStrings("x.tsx", src).map((s) => `${s.kind} ${s.text}`)

  it("reads JSX text, reader-facing attributes, toasts and ternaries", () => {
    expect(
      strings(`
        const A = () => (
          <div title="Rename canvas" className="repo-row">
            Hello
            {busy ? "Saving…" : "Save"}
            <input placeholder={\`Comment on \${ref}…\`} />
          </div>
        )
        toast.error("Failed to delete canvas")
        const item = { id: "branch", label: "Chat & sandbox" }
      `)
    ).toEqual([
      "attr:title Rename canvas",
      "jsx-text Hello",
      "jsx-text Saving…",
      "jsx-text Save",
      "attr:placeholder Comment on {}…",
      "toast Failed to delete canvas",
      "prop:label Chat & sandbox",
    ])
  })

  it("reads copy staged in a local or a defaulted prop", () => {
    expect(
      strings(`
        function Composer({ placeholder = "Ask the agent…" }) {
          const emptyLabel = hasRepos ? "No active agents" : "No projects"
          const id = "not copy"
        }
      `)
    ).toEqual([
      "var:placeholder Ask the agent…",
      "var:emptyLabel No active agents",
      "var:emptyLabel No projects",
    ])
  })
})

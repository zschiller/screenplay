import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { extractUiStrings } from "./extract"
import { findCopyViolations } from "./rules"

const appDir = fileURLToPath(new URL("../../", import.meta.url))

/**
 * Where user-facing copy lives. `app/api` answers other code, `lib/agent`
 * writes prompts and tool descriptions for the model, and tests quote copy
 * rather than render it — none of them is read by a person as UI.
 */
function uiSourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "app", "components", "hooks", "lib"],
    {
      cwd: appDir,
      encoding: "utf8",
    }
  )
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !f.startsWith("app/api/") && !f.startsWith("lib/agent/"))
    .filter((f) => !f.startsWith("lib/ui-copy/"))
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
})

describe("findCopyViolations", () => {
  it.each([
    ["Remove repo?", "repo → repository"],
    ["Add project", "project → repository (or canvas)"],
    ["Each iframeLayer runs a live preview", "iframeLayer → frame"],
    ["Back to room", "room → canvas"],
    ["Search workspaces...", "use the … character"],
    ["Choose a branch", "branch → workspace"],
  ])("flags %j", (text, rule) => {
    expect(findCopyViolations(text).map((v) => v.rule)).toContain(rule)
  })

  it.each([
    "Search workspaces…",
    "Also delete 2 branches on remote",
    "Choose the base branch",
    "Open branch on GitHub",
    "Search GitHub repositories…",
    "Restart sandbox",
    "No repositories found.",
    "Add repository",
  ])("passes %j", (text) => {
    expect(findCopyViolations(text)).toEqual([])
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
        const item = { id: "branch", label: "Workspace & sandbox" }
      `)
    ).toEqual([
      "attr:title Rename canvas",
      "jsx-text Hello",
      "jsx-text Saving…",
      "jsx-text Save",
      "attr:placeholder Comment on {}…",
      "toast Failed to delete canvas",
      "prop:label Workspace & sandbox",
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

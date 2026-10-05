import { describe, expect, it } from "vitest"

import {
  buildAgentSystemPrompt,
  buildRoomSystemPrompt,
  buildSketchSystemPrompt,
} from "@/lib/agent/config"
import { MEMORY_PROMPT_LIMIT } from "@/lib/memory/entry"
import { CANVAS_VIEW_FOOTER_TOKEN } from "@/lib/agent/message-markers"
import { harnessToolNaming } from "@/lib/agent/harnesses"
import type { OriginTaggedSkill } from "@/lib/skills/sources"

const EMPTY_DIRECTORY = { documents: [] }

const APP_SKILLS: OriginTaggedSkill[] = [
  {
    name: "screenplay-add-knob",
    description: "Add interactive controls.",
    origin: "app",
  },
  {
    name: "screenplay-share-state",
    description: "Share state across artboards.",
    origin: "app",
  },
]

describe("buildAgentSystemPrompt — skills block", () => {
  it("lists every skill in the merged index by name and description", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("Skills available:")
    expect(prompt).toMatch(/- \*\*screenplay-add-knob\*\*:/)
    expect(prompt).toMatch(/- \*\*screenplay-share-state\*\*:/)
  })

  it("folds Repo Skills into the prompt alongside App Skills", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [
        ...APP_SKILLS,
        { name: "deploy", description: "Deploy this branch.", origin: "repo" },
      ],
    })

    expect(prompt).toMatch(/- \*\*deploy\*\*: Deploy this branch\./)
  })

  it("rolls a fresh prompt when the repo-skill index changes", () => {
    // The persisted system prompt is the cache key; embedding the merged Skill
    // metadata is what makes editing a Repo Skill on a branch roll a new prompt.
    const before = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })
    const after = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [
        ...APP_SKILLS,
        { name: "deploy", description: "Deploy this branch.", origin: "repo" },
      ],
    })

    expect(after).not.toEqual(before)
  })

  it("omits the skills block entirely when no skills are available", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [],
    })

    expect(prompt).not.toContain("Skills available:")
  })

  it("makes read_skill mandatory when the message carries a [skill: …] marker", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("[skill: <name>]")
    expect(prompt).toContain("MANDATORY")
    // The rule must tie the marker to a non-optional read_skill call before
    // any other action — that's what makes `/` invocation deterministic.
    expect(prompt).toMatch(/MUST call `read_skill`/)
  })

  it("appends repo system prompt after the skills block when provided", () => {
    const prompt = buildAgentSystemPrompt({
      repoSystemPrompt: "Targets apps/web.",
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })

    expect(prompt).toContain("Workspace context:")
    expect(prompt).toContain("Targets apps/web.")
    expect(prompt.indexOf("Skills available:")).toBeLessThan(
      prompt.indexOf("Workspace context:")
    )
  })
})

describe("tool names per engine (#1223)", () => {
  const ROOM_TOOLS = [
    "read_canvas",
    "read_document",
    "read_workspace_chat",
    "read_workspace_diff",
    "read_workspace_file",
    "view_frame",
    "undo_changes",
    "list_changes",
    "send_to_workspace",
    "create_workspaces",
    "stop_workspace",
    "open_pull_request",
    "remove_workspace",
    "read_skill",
    "write_memory",
  ]
  const room = (toolNaming?: ReturnType<typeof harnessToolNaming>) =>
    buildRoomSystemPrompt({
      canvasSummary: "",
      skills: [
        { name: "screenplay-try-variants", description: "Try variants." },
      ],
      toolNaming,
    })

  it("names the Coordinator’s tools bare on the in-process engine", () => {
    const prompt = room()
    for (const tool of ROOM_TOOLS) expect(prompt).toContain(`\`${tool}\``)
    expect(prompt).not.toContain("mcp__")
  })

  it("names every Coordinator tool as Claude Code exposes it", () => {
    const prompt = room(harnessToolNaming("claude-code", "screenplay"))
    for (const tool of ROOM_TOOLS) {
      expect(prompt).toContain(`\`mcp__screenplay__${tool}\``)
      expect(prompt).not.toContain(`\`${tool}\``)
    }
  })

  it("tells Codex where the Coordinator’s tools come from", () => {
    const prompt = room(harnessToolNaming("codex", "screenplay"))
    expect(prompt).toContain("`read_skill`")
    expect(prompt).toContain("MCP server `screenplay`")
  })

  it("names a Workspace’s dev server tools as Claude Code exposes them", () => {
    const opts = { layerDirectory: EMPTY_DIRECTORY, skills: APP_SKILLS }
    const bare = buildAgentSystemPrompt(opts)
    expect(bare).toContain("call read_dev_server_logs")
    expect(bare).toContain("restart_dev_server")
    expect(bare).not.toContain("mcp__")

    const claude = buildAgentSystemPrompt({
      ...opts,
      toolNaming: harnessToolNaming("claude-code", "screenplay"),
    })
    expect(claude).toContain("call mcp__screenplay__read_dev_server_logs")
    expect(claude).toContain("and mcp__screenplay__restart_dev_server to")
    expect(claude).toContain("call mcp__screenplay__restart_dev_server when")
    expect(claude).toContain("`mcp__screenplay__create_document`")
    expect(claude).toContain("`mcp__screenplay__replace_document_body`")
    // Served over MCP too (#1480), so named the same way.
    expect(claude).toContain("call `mcp__screenplay__read_skill`")
    expect(claude).toContain("call mcp__screenplay__create_pr")
    // A harness edits and commits with its own tools.
    expect(claude).not.toContain("run_command")
    expect(claude).not.toContain("submit_plan")
  })
})

describe("buildAgentSystemPrompt — Documents (#1314)", () => {
  const directory = {
    ...EMPTY_DIRECTORY,
    documents: [
      { id: "doc-1", title: "Rollout plan", ownerChatId: "chat-1" },
      { id: "doc-2", title: "Notes" },
    ],
  }

  it("tells the chat to write up plans in a Document it owns", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })
    expect(prompt).toContain("call `create_document`")
    expect(prompt).toContain("You can edit only the Documents you made")
  })

  it("marks the chat’s own Documents in the layer directory", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: directory,
      skills: APP_SKILLS,
      chatId: "chat-1",
    })
    expect(prompt).toContain("- doc-1: Rollout plan (yours)")
    expect(prompt).toMatch(/- doc-2: Notes$/m)
  })
})

describe("buildAgentSystemPrompt — one chat per Workspace (#1315)", () => {
  it("says only this chat changes its Workspace and others are read-only", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
    })
    expect(prompt).toContain("the only one that changes its code")
    expect(prompt).toContain("read their code with read_code_file")
  })

  it("names the code reads as a harness reaches them", () => {
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: APP_SKILLS,
      toolNaming: harnessToolNaming("claude-code", "screenplay"),
    })
    expect(prompt).toContain("mcp__screenplay__read_code_file")
    expect(prompt).toContain("mcp__screenplay__find_code_files")
  })
})

describe("the Canvas view footer", () => {
  it('tells both chat kinds what "this" means', () => {
    for (const prompt of [
      buildAgentSystemPrompt({ layerDirectory: EMPTY_DIRECTORY, skills: [] }),
      buildRoomSystemPrompt({ canvasSummary: "" }),
    ]) {
      expect(prompt).toContain(`\`${CANVAS_VIEW_FOOTER_TOKEN}\` footer`)
      expect(prompt).toContain(
        "read the footer of the message you’re answering"
      )
    }
  })
})

/**
 * Account memory (#1513): every kind's prompt carries the sender's account
 * memory as its own labeled block beside canvas memory, capped like it.
 */
describe("account memory in every kind’s system prompt", () => {
  const entry = (n: number) => ({
    id: `mem-${n}`,
    text: `Preference ${n}.`,
    source: "agent" as const,
    createdAt: n,
    updatedAt: n,
  })
  const accountMemory = [entry(1)]
  const memory = [{ ...entry(2), text: "Use pnpm, never npm." }]

  const prompts = {
    Workspace: (opts: { accountMemory?: typeof accountMemory }) =>
      buildAgentSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        skills: [],
        memory,
        ...opts,
      }),
    sketch: (opts: { accountMemory?: typeof accountMemory }) =>
      buildSketchSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        chatId: "chat-1",
        skills: [],
        memory,
        ...opts,
      }),
    Coordinator: (opts: { accountMemory?: typeof accountMemory }) =>
      buildRoomSystemPrompt({ canvasSummary: "", memory, ...opts }),
  }

  for (const [kind, build] of Object.entries(prompts)) {
    it(`gives a ${kind} chat the sender’s account memory as its own block`, () => {
      const prompt = build({ accountMemory })
      const account = prompt.indexOf("Account memory (")
      const canvas = prompt.indexOf("Canvas memory (")
      expect(account).toBeGreaterThan(-1)
      expect(canvas).toBeGreaterThan(account)
      expect(prompt.slice(account, canvas)).toContain("- [mem-1] Preference 1.")
      expect(prompt.slice(account, canvas)).not.toContain("pnpm")
    })

    it(`leaves the block out of a ${kind} chat’s prompt with no account memory`, () => {
      expect(build({})).not.toContain("Account memory (")
      expect(build({ accountMemory: [] })).not.toContain("Account memory (")
    })
  }

  it("keeps the newest entries past the prompt limit", () => {
    const many = Array.from({ length: MEMORY_PROMPT_LIMIT + 5 }, (_, i) =>
      entry(i + 1)
    )
    const prompt = buildAgentSystemPrompt({
      layerDirectory: EMPTY_DIRECTORY,
      skills: [],
      accountMemory: many,
    })
    expect(prompt).not.toContain("] Preference 5.\n")
    expect(prompt).toContain("- [mem-6] Preference 6.\n")
    expect(prompt).toContain(`] Preference ${MEMORY_PROMPT_LIMIT + 5}.`)
  })
})

/**
 * Every chat saves memory (#1515): each kind's prompt says when to save and
 * which scope a note belongs in, and a turn nobody sent saves to the canvas
 * only.
 */
describe("saving memory in every kind’s system prompt", () => {
  const prompts = {
    Workspace: (accountMemory?: null) =>
      buildAgentSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        skills: [],
        accountMemory,
      }),
    sketch: (accountMemory?: null) =>
      buildSketchSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        chatId: "chat-1",
        skills: [],
        accountMemory,
      }),
    Coordinator: (accountMemory?: null) =>
      buildRoomSystemPrompt({ canvasSummary: "", accountMemory }),
  }

  for (const [kind, build] of Object.entries(prompts)) {
    it(`tells a ${kind} chat to save preferences to account memory and canvas facts to canvas memory`, () => {
      const prompt = build()
      expect(prompt).toContain("`write_memory`")
      expect(prompt).toContain("go to `account` memory")
      expect(prompt).toContain("go to `canvas` memory")
      expect(prompt).not.toMatch(/Only you write it/)
    })

    it(`tells a ${kind} chat on a turn nobody sent to save to the canvas only`, () => {
      const prompt = build(null)
      expect(prompt).toContain("save to `canvas` only")
      expect(prompt).not.toContain("go to `account` memory")
    })
  }
})

/**
 * Account Files (#1521): each kind lists the sender's own files in a block
 * after Canvas files, and a turn nobody sent says it has none.
 */
describe("account files in every kind’s system prompt", () => {
  const file = (path: string) => ({
    id: `file-${path}`,
    path,
    kind: "file" as const,
    size: 12,
    mediaType: "text/markdown",
    addedBy: "agent" as const,
    addedById: "chat-1",
    blobKey: `account/ana/file-${path}`,
    createdAt: 1,
    updatedAt: 1,
  })
  type Opts = { accountFiles?: ReturnType<typeof file>[] | null }
  const files = [{ ...file("canvas-notes.md"), blobKey: "canvas/r/x" }]
  const prompts = {
    Workspace: (opts: Opts) =>
      buildAgentSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        skills: [],
        files,
        ...opts,
      }),
    sketch: (opts: Opts) =>
      buildSketchSystemPrompt({
        layerDirectory: EMPTY_DIRECTORY,
        chatId: "chat-1",
        skills: [],
        files,
        ...opts,
      }),
    Coordinator: (opts: Opts) =>
      buildRoomSystemPrompt({ canvasSummary: "", files, ...opts }),
  }

  for (const [kind, build] of Object.entries(prompts)) {
    it(`lists the sender’s account files after Canvas files in a ${kind} chat`, () => {
      const prompt = build({ accountFiles: [file("style/voice.md")] })
      const canvas = prompt.indexOf("Canvas files (")
      const account = prompt.indexOf("Account files (")
      expect(canvas).toBeGreaterThan(-1)
      expect(account).toBeGreaterThan(canvas)
      expect(prompt.slice(account)).toContain("- style/voice.md (12 B")
      expect(prompt.slice(account)).toContain('`scope: "account"`')
      expect(prompt.slice(canvas, account)).not.toContain("style/voice.md")
    })

    it(`says a ${kind} turn nobody sent has no account files`, () => {
      const prompt = build({ accountFiles: null })
      expect(prompt).toContain("Account files: nobody sent this turn")
      expect(prompt).not.toContain("Account files (")
    })

    it(`says a ${kind} sender with no account files has none yet`, () => {
      const prompt = build({ accountFiles: [] })
      const account = prompt.indexOf("Account files (")
      expect(prompt.slice(account)).toContain("(none yet)")
    })
  }

  it("caps the list and points at list_saved_files for the rest", () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      file(`n-${String(i).padStart(2, "0")}.md`)
    )
    const prompt = buildRoomSystemPrompt({
      canvasSummary: "",
      accountFiles: many,
    })
    expect(prompt).toContain("- n-49.md")
    expect(prompt).not.toContain("- n-50.md")
    expect(prompt).toContain(
      '- …and 5 more: call `list_saved_files` with `scope: "account"` for all of them.'
    )
  })
})

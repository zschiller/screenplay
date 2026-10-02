import { describe, expect, it } from "vitest"

import {
  buildAgentSystemPrompt,
  buildRoomSystemPrompt,
} from "@/lib/agent/config"
import { CANVAS_VIEW_FOOTER_TOKEN } from "@/lib/agent/message-markers"
import { harnessToolNaming } from "@/lib/agent/tool-name"
import type { OriginTaggedSkill } from "@/lib/skills/merged"

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

  it("names the Coordinator's tools bare on the in-process engine", () => {
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

  it("tells Codex where the Coordinator's tools come from", () => {
    const prompt = room(harnessToolNaming("codex", "screenplay"))
    expect(prompt).toContain("`read_skill`")
    expect(prompt).toContain("MCP server `screenplay`")
  })

  it("names a Workspace's dev server tools as Claude Code exposes them", () => {
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
    // The rest are the in-process engine's own tools, not served over MCP.
    expect(claude).toContain("call `read_skill`")
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

  it("marks the chat's own Documents in the layer directory", () => {
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
        "read the footer of the message you're answering"
      )
    }
  })
})

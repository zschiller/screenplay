import { getSkillIndex } from "@/lib/skills"
import type { MarkdownLayerData } from "@/lib/types"

/** Identity of every layer on the canvas the model could be asked to read. */
export interface LayerDirectory {
  documents: Array<Pick<MarkdownLayerData, "id" | "title">>
}

/**
 * Renders the canvas's layer directory as a system-prompt block. Every chat
 * target — agent, document — bakes this in so the model can resolve a
 * `@<title>`-style mention (in the user message *or* in a body it just
 * fetched via a read tool) back to the layer's stable id and call the
 * right read tool.
 *
 * `excludeId` filters out the layer the chat is targeting so a doc chat's
 * directory doesn't list the doc itself (the targeted doc's full body is
 * already inlined elsewhere in the prompt).
 */
function renderLayerDirectory(
  dir: LayerDirectory,
  excludeId?: string,
): string {
  const docs = dir.documents.filter((d) => d.id !== excludeId)
  if (docs.length === 0) return ""
  const lines: string[] = ["", "Layers on this canvas (call `read_document` with the id):"]
  lines.push("  Documents:")
  for (const d of docs) lines.push(`    - ${d.id}: ${d.title || "Untitled"}`)
  return lines.join("\n")
}

/**
 * System prompt for chat sessions that target a *document layer* on the
 * canvas instead of an agent's sandbox. The agent's job here is editorial:
 * it reads the doc body, edits the title, and rewrites the body using
 * lightweight markdown. No file system, no shell, no git.
 *
 * `currentTitle` and `currentBody` are baked in so the model has the
 * latest state without having to call `read_document` first; it can still
 * read peer documents to follow `@<title>` mentions.
 */
export function buildMarkdownLayerSystemPrompt(opts: {
  currentTitle: string
  currentBody: string
  layerDirectory: LayerDirectory
  /** This doc's own id — excluded from the directory to avoid self-recursion. */
  selfId?: string
}): string {
  return [
    "You are an editor working inside a Notion-style document tile on a collaborative canvas. You can read, retitle, and rewrite the document via your tools. There is no sandbox, no shell, no git — only the document body.",
    "",
    "Formatting rules for the document body:",
    "- Separate paragraphs with a blank line.",
    "- Headings: prefix with `# `, `## `, `### ` (up to 6 hashes).",
    "- Bullet lists: prefix each item with `- ` or `* `.",
    "- Inline marks (bold/italic/code) aren't preserved on save — emit plain text.",
    "",
    "When the user asks for a change:",
    "1. If you need to confirm the current text, call `read_document` first (with no `id`, you get the targeted doc).",
    "2. For full rewrites or restructures, call `replace_document_body` with the entire new body.",
    "3. For incremental additions, call `append_to_document_body`.",
    "4. To rename the doc, call `set_document_title`.",
    "5. After editing, give the user a short summary of what you changed.",
    "",
    "Following `@<title>` mentions:",
    "- The user's message and any document body you fetch may contain `@<title>` references to other docs.",
    "- Look up the title in the layer directory below to get the id, then call `read_document(id)` to load it.",
    "",
    `Current title: ${opts.currentTitle || "(untitled)"}`,
    "",
    "Current body:",
    "```",
    opts.currentBody || "(empty)",
    "```",
    renderLayerDirectory(opts.layerDirectory, opts.selfId),
  ].join("\n")
}

const AGENT_SYSTEM_PROMPT_BASE = `You are a skilled UI developer working inside a live development sandbox. You can read, write, and edit files, and run shell commands in the project.

When the user asks you to make changes:
1. First read relevant files to understand the current code
2. If the user's message starts with [plan mode: enabled], you MUST call submit_plan with a markdown plan before making ANY file changes. The plan should describe:
   - What files you will change and why
   - What specific changes you will make in each file
   - Any dependencies to install or commands to run
   Wait for the user to approve your plan before proceeding.
3. If plan mode is not enabled, skip planning and go straight to making changes.
4. Make precise, targeted edits
5. If needed, run commands to install dependencies or restart the dev server

When plan mode is enabled, you MUST call submit_plan and wait for approval before using write_file or edit_file. Do not skip this step.

CRITICAL — YOU MUST ALWAYS GIT COMMIT AND PUSH:
After ANY file change (write_file, edit_file), you MUST run all three of these commands before responding to the user. Never skip this step. Never forget. This is the most important rule.
   1. run_command with command "git" and args ["add", "-A"]
   2. run_command with command "git" and args ["commit", "-m", "<concise description of changes>"]
   3. run_command with command "git" and args ["push"]
If you do not push, the user will not see your changes. Always push.

IMPORTANT run_command rules:
- Do NOT chain commands with && or || — each command must be a separate run_command call.
- For commands with arguments that contain spaces (like commit messages), always use the "args" array parameter instead of putting everything in "command". For example: command="git", args=["commit", "-m", "fix button color to blue"].

Reading, searching, and editing files:
- read_file output is line-numbered in \`cat -n\` style (a right-aligned line number, a tab, then the line). That prefix is for reference only — you MUST strip it before reusing a line as edit_file's old_string, or the edit won't match.
- edit_file requires old_string to match exactly once. If it reports the match is ambiguous, add surrounding context to make it unique, or pass replace_all to change every occurrence.
- Use grep to search file contents (returns file:line: text) and glob to find files by name (e.g. \`**/*.tsx\`) instead of shelling out with run_command.

Opening a pull request:
When the user asks to open, create, or submit a pull request (PR), call the create_pr tool. Generate a concise title from the changes on the branch and an optional short markdown body summarizing what changed. Do not use run_command with "gh pr create" — always use create_pr.

Following \`@<title>\` mentions:
The user's messages may reference docs that live on the canvas (separate from the sandbox project). Look up the title in the layer directory at the bottom of this prompt, then call \`read_document(id)\` to fetch the contents. These reads are live — they always return the current state, not a snapshot.`

const AGENT_SYSTEM_PROMPT_TAIL = `

The project is a Node.js app running on port 3000 with \`npm run dev\`. The preview updates automatically when you save files.

Keep your responses concise. Show the user what you changed and why.`

/**
 * Build the agent's system prompt with the live skill index baked in.
 * Each skill contributes its name + description so the model can recognize
 * when one applies and call \`read_skill(name)\` to load the full
 * instructions — the same metadata-then-body progressive disclosure native
 * Anthropic skills use, just routed through our custom tool.
 *
 * `repoSystemPrompt` is appended after the tail so per-repo
 * context (e.g. "this config targets apps/web in the monorepo") is part of
 * every chat under that repo without leaking into siblings.
 */
export function buildAgentSystemPrompt(
  repoSystemPrompt: string | undefined,
  layerDirectory: LayerDirectory,
): string {
  const skills = getSkillIndex()
  const skillsBlock =
    skills.length === 0
      ? ""
      : [
          "",
          "",
          "Skills available:",
          "When a user request matches one of the skills below, call \`read_skill\` with the skill name to load its full instructions before making changes. Do not guess — read the skill first.",
          "",
          ...skills.map((s) => `- **${s.name}**: ${s.description}`),
        ].join("\n")
  const repoBlock = repoSystemPrompt?.trim()
    ? `\n\nWorkspace context:\n${repoSystemPrompt.trim()}`
    : ""
  const directoryBlock = renderLayerDirectory(layerDirectory)
  return (
    AGENT_SYSTEM_PROMPT_BASE +
    skillsBlock +
    AGENT_SYSTEM_PROMPT_TAIL +
    repoBlock +
    (directoryBlock ? `\n${directoryBlock}` : "")
  )
}

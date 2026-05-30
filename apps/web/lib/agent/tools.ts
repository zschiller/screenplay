import "server-only"

import { tool } from "ai"
import { z } from "zod"

import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"
import { createGitHubPr } from "@/lib/github-pr"
import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { getSkill, getSkillIndex } from "@/lib/skills"

/**
 * Everything a sandbox tool needs to act on behalf of the acting collaborator:
 * which VM to talk to, which room it belongs to, and whose GitHub token to
 * attribute git operations to. Passed once to `buildSandboxTools` and closed
 * over by every tool's `execute`.
 */
export interface ToolContext {
  sandboxName: string
  roomId: string
  userId: string
}

/** Max characters to keep from command stdout/stderr to avoid bloating session history */
const MAX_OUTPUT_LENGTH = 20_000

/**
 * The sandbox-backed toolset for an agent chat target. Each tool follows the
 * AI SDK grain: `tool({ description, inputSchema, execute })` with a zod schema
 * that hands `execute` typed, validated input — no `as unknown as` casts, and
 * bad arguments are rejected before `execute` runs.
 *
 * Output redaction is **not** done here: the assembly point (`toolsetFor`)
 * wraps every tool with `withRedactedOutput`, so secrets are scrubbed uniformly
 * regardless of which tool produced them. Per-tool `execute` only does its own
 * formatting (e.g. `run_command`'s framing + truncation).
 *
 * `submit_plan` intentionally has no `execute` — it's a human-in-the-loop tool.
 * When the model emits a `submit_plan` call, the loop halts via
 * `stopWhen: hasToolCall("submit_plan")` and the stream route persists an
 * `agent_pending_tool_call` row. `/api/agent/plan` resumes the loop later with
 * the user's approval/rejection as the tool result.
 */
export function buildSandboxTools(ctx: ToolContext) {
  return {
    read_file: tool({
      description:
        "Read the contents of a file from the project. Returns the full file content as text. Use this to understand existing code before making changes.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Path to the file relative to the project root, e.g. 'src/App.tsx'"),
      }),
      execute: async ({ path }) => {
        const sandbox = await getSandbox(ctx)
        const buf = await sandbox.readFileToBuffer({ path })
        if (!buf) return `File not found: ${path}`
        return buf.toString("utf-8") || "(empty file)"
      },
    }),

    write_file: tool({
      description:
        "Write content to a file, creating it if it doesn't exist or replacing it entirely. Use this for new files or complete rewrites.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        const sandbox = await getSandbox(ctx)
        await sandbox.writeFiles([{ path, content }])
        return `Written ${content.length} bytes to ${path}`
      },
    }),

    edit_file: tool({
      description:
        "Perform a find-and-replace edit in a file. The old_string must match exactly (including whitespace and indentation). Use this for targeted changes to existing files.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
      }),
      execute: async ({ path, old_string, new_string }) => {
        const sandbox = await getSandbox(ctx)
        const buf = await sandbox.readFileToBuffer({ path })
        if (!buf) return `File not found: ${path}`

        const content = buf.toString("utf-8")
        if (!content.includes(old_string)) {
          return `old_string not found in ${path}. Make sure it matches exactly including whitespace.`
        }

        const updated = content.replace(old_string, new_string)
        await sandbox.writeFiles([{ path, content: updated }])
        return `Edited ${path}: replaced ${old_string.length} chars with ${new_string.length} chars`
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in the project directory. Returns stdout, stderr, and exit code. Use for installing packages, running scripts, checking status, etc.",
      inputSchema: z.object({
        command: z.string(),
        args: z.array(z.string()).optional(),
      }),
      execute: async ({ command, args }) => runCommand(ctx, command, args),
    }),

    list_files: tool({
      description:
        "List files in the project directory. Returns file paths, useful for understanding project structure.",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
      }),
      execute: async ({ path, pattern }) => {
        const sandbox = await getSandbox(ctx)
        const args = [path || ".", "-maxdepth", "3", "-type", "f"]
        if (pattern) args.push("-name", pattern)
        // Exclude node_modules and .git
        args.push("!", "-path", "*/node_modules/*", "!", "-path", "*/.git/*")
        const result = await sandbox.runCommand("find", args)
        const stdout = await result.stdout()
        return stdout || "(no files found)"
      },
    }),

    create_pr: tool({
      description:
        "Open a GitHub pull request from this agent's branch into the workspace's default branch. Call this when the user asks to create, open, or submit a PR.",
      inputSchema: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
      }),
      execute: async ({ title, body }) => {
        try {
          const { url, number } = await createGitHubPr({
            userId: ctx.userId,
            roomId: ctx.roomId,
            sandboxName: ctx.sandboxName,
            title,
            body,
          })
          return `Created PR #${number}: ${url}`
        } catch (e) {
          return `Failed to create PR: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    read_skill: tool({
      description:
        "Load the full instructions for a skill listed in your skills index. Returns markdown — read it carefully before making changes.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const content = getSkill(name)
        if (content) return content
        const available = getSkillIndex()
          .map((s) => `- ${s.name}: ${s.description}`)
          .join("\n")
        return `Unknown skill: "${name}". Available skills:\n${available || "(none)"}`
      },
    }),

    // Human-in-the-loop: no execute. The loop halts on this tool call and
    // /api/agent/plan supplies the result after the user decides.
    submit_plan: tool({
      description:
        "Submit a plan for user approval before making any file changes. The plan should be markdown describing what files will change and why. You MUST call this and wait for approval before write_file or edit_file when plan mode is enabled.",
      inputSchema: z.object({ plan: z.string() }),
    }),
  }
}

export type SandboxTools = ReturnType<typeof buildSandboxTools>

async function getSandbox(ctx: ToolContext): Promise<SandboxInstance> {
  return sandboxProvider.get({ name: ctx.sandboxName })
}

/**
 * Look up the acting user's GitHub token and hand it to the next runCommand as
 * SCREENPLAY_GH_TOKEN. The in-sandbox credential helper feeds it to git, so
 * every push from this turn is attributed to whichever collaborator triggered
 * the command — not to whoever first provisioned the (shared) sandbox.
 */
async function buildAgentGitEnv(ctx: ToolContext): Promise<Record<string, string> | undefined> {
  try {
    const token = await getGitHubTokenForUser(ctx.userId)
    return token ? { SCREENPLAY_GH_TOKEN: token } : undefined
  } catch {
    return undefined
  }
}

/** Characters that indicate the command needs a shell to interpret it */
const SHELL_OPERATORS = /[&&|;><$`(){}]/

async function runCommand(
  ctx: ToolContext,
  command: string,
  inputArgs: string[] | undefined,
): Promise<string> {
  let cmd: string
  let args: string[]

  if (inputArgs && inputArgs.length > 0) {
    // Explicit args array — use as-is
    cmd = command
    args = inputArgs
  } else if (SHELL_OPERATORS.test(command)) {
    // Command contains shell operators (&&, |, etc.) — run through sh -c
    cmd = "sh"
    args = ["-c", command]
  } else {
    // Simple command string — parse respecting quotes
    const tokens = parseCommandString(command)
    cmd = tokens[0]
    args = tokens.slice(1)
  }

  const sandbox = await getSandbox(ctx)
  const gitEnv = await buildAgentGitEnv(ctx)
  const result = await sandbox.runCommand({
    cmd,
    args,
    ...(gitEnv ? { env: gitEnv } : {}),
  })
  // Redaction is applied uniformly at the assembly point (withRedactedOutput),
  // so this only frames and truncates; it never scrubs secrets itself.
  const parts: string[] = []
  let stdout = await result.stdout()
  let stderr = await result.stderr()
  if (stdout) {
    if (stdout.length > MAX_OUTPUT_LENGTH) {
      stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + `\n...(truncated ${stdout.length - MAX_OUTPUT_LENGTH} chars)`
    }
    parts.push(`stdout:\n${stdout}`)
  }
  if (stderr) {
    if (stderr.length > MAX_OUTPUT_LENGTH) {
      stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + `\n...(truncated ${stderr.length - MAX_OUTPUT_LENGTH} chars)`
    }
    parts.push(`stderr:\n${stderr}`)
  }
  parts.push(`exit code: ${result.exitCode}`)
  return parts.join("\n\n")
}

/**
 * Parse a command string respecting quoted substrings.
 * e.g. `git commit -m "fix button color"` → ["git", "commit", "-m", "fix button color"]
 */
function parseCommandString(command: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: string | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null
      } else {
        current += ch
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ""
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}
